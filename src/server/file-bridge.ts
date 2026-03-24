import { appendFileSync, writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import type { ResolvedPilotOptions, ExecResult, ElementInfo } from '../types'
import { PILOT_FILES } from '../constants'

/** 实例运行环境类型 */
export type InstanceType = 'vite' | 'console' | 'userscript'

/** 实例注册信息 */
export interface InstanceInfo {
  path: string
  label: string
  lastSeen: number
  title: string
  type: InstanceType
}

/**
 * 文件系统桥接层
 * 管理 .pilot/ 目录，提供日志追加、代码读取、结果写入等操作
 * 支持多实例：每个浏览器 tab 有独立的文件目录
 */
export class FileBridge {
  private readonly pilotDir: string

  constructor(private readonly options: ResolvedPilotOptions) {
    this.pilotDir = options.pilotDir
    this.initDir()
  }

  /** 确保 .pilot 目录和 instances 子目录存在，启动时清理旧数据 */
  private initDir() {
    if (!existsSync(this.pilotDir)) {
      mkdirSync(this.pilotDir, { recursive: true })
    }

    /** 启动时清理旧的活跃实例记录（浏览器 tab 会重新连接创建新记录） */
    const activeFile = resolve(this.pilotDir, PILOT_FILES.activeInstance)
    if (existsSync(activeFile)) {
      writeFileSync(activeFile, '{}', 'utf-8')
    }

    const instancesDir = this.getInstancesDir()
    if (existsSync(instancesDir)) {
      /** 启动时清理所有旧实例目录（浏览器 tab 会重新连接创建新实例） */
      for (const name of readdirSync(instancesDir)) {
        rmSync(join(instancesDir, name), { recursive: true, force: true })
      }
    } else {
      mkdirSync(instancesDir, { recursive: true })
    }
  }

  private getInstancesDir() {
    return resolve(this.pilotDir, PILOT_FILES.instancesDir)
  }

  /** 获取实例目录路径 */
  getInstanceDir(instanceId: string) {
    return resolve(this.getInstancesDir(), instanceId)
  }

  /** 列出所有现有实例 */
  listInstances(): string[] {
    const dir = this.getInstancesDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
  }

  /** 根据 URL path 生成 instance ID（同一路径 = 同一实例） */
  static toInstanceId(urlPath: string): string {
    if (!urlPath || urlPath === '/') return PILOT_FILES.defaultInstance
    /** 去掉首尾斜杠，空路径用 default */
    const cleaned = urlPath.replace(/^\/+|\/+$/g, '')
    return cleaned || PILOT_FILES.defaultInstance
  }

  /** 从 URL 生成简短标签（hostname 或 pathname） */
  static toLabel(fullUrl: string): string {
    if (!fullUrl || fullUrl === '/') return PILOT_FILES.defaultInstance
    try {
      const urlObj = new URL(fullUrl)
      if (urlObj.hostname && urlObj.hostname !== 'localhost') return urlObj.hostname
    } catch { /* 非 URL 格式，fallback 到 pathname 处理 */ }
    const cleaned = fullUrl.replace(/^\/+|\/+$/g, '')
    return cleaned || PILOT_FILES.defaultInstance
  }

  /** 确保实例目录存在（供 fs.watch 使用，需要目录提前存在） */
  ensureInstanceDir(instanceId: string) {
    const dir = this.getInstanceDir(instanceId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  /** 读取所有实例注册信息 {instanceId: {path, label, lastSeen}} */
  readActiveInstance(): Record<string, InstanceInfo> {
    const file = resolve(this.pilotDir, PILOT_FILES.activeInstance)
    if (!existsSync(file)) return {}
    try {
      return JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      return {}
    }
  }

  /** 注册/更新实例信息（path/label 只在有实际值时写入，heartbeat 的 '/' 不覆盖） */
  writeActiveInstance(instanceId: string, fullUrl: string, type: InstanceType = 'vite', title?: string) {
    const map = this.readActiveInstance()
    const existing = map[instanceId]
    /** path/label：fullUrl 为 '/' 时不覆盖已有值（SSE heartbeat 跨域无 referer） */
    const hasRealUrl = fullUrl && fullUrl !== '/'
    const path = hasRealUrl ? fullUrl : (existing?.path || '/')
    const label = hasRealUrl ? FileBridge.toLabel(fullUrl) : (existing?.label || FileBridge.toLabel(fullUrl))
    const currentType = existing?.type || type
    map[instanceId] = { path, label, lastSeen: Date.now(), title: title || existing?.title, type: currentType }

    /** 清理超过 5 分钟未活跃的实例目录（保留活跃实例，不限制数量） */
    const staleThreshold = Date.now() - 5 * 60 * 1000
    for (const [id, info] of Object.entries(map)) {
      if (info.lastSeen < staleThreshold) {
        const dir = this.getInstanceDir(id)
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
        delete map[id]
      }
    }

    writeFileSync(resolve(this.pilotDir, PILOT_FILES.activeInstance), JSON.stringify(map, null, 2), 'utf-8')
  }

  /** 仅更新实例的 title（SPA 场景下 title 可能动态变化，POST /result 时调用） */
  updateInstanceTitle(instanceId: string, title: string) {
    const map = this.readActiveInstance()
    if (map[instanceId]) {
      map[instanceId].title = title
      writeFileSync(resolve(this.pilotDir, PILOT_FILES.activeInstance), JSON.stringify(map, null, 2), 'utf-8')
    }
  }

  /** 获取最近活跃的实例 ID（没有指定时自动选择用户最后操作的 tab） */
  getLatestInstance(): string | null {
    const map = this.readActiveInstance()
    let best: string | null = null
    let bestTime = 0
    for (const [id, info] of Object.entries(map)) {
      if (info.lastSeen > bestTime) {
        best = id
        bestTime = info.lastSeen
      }
    }
    return best
  }

  /** 读取并删除待执行的 JS 代码（文件驱动通道） */
  readPendingJs(instanceId: string): string | null {
    this.ensureInstanceDir(instanceId)
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.pendingJs)
    if (!existsSync(file)) return null

    const code = readFileSync(file, 'utf-8').trim()
    unlinkSync(file)
    return code
  }

  /** 写入待执行的 JS 代码（文件驱动通道），同时清除旧的 exec-done 标记 */
  writePendingJs(code: string, instanceId: string) {
    this.ensureInstanceDir(instanceId)
    this.clearExecDone(instanceId)
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.pendingJs), code, 'utf-8')
  }

  /** 写入执行结果（JSON 格式） */
  writeExecResult(result: ExecResult, instanceId: string) {
    this.ensureInstanceDir(instanceId)
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.execResult), JSON.stringify(result, null, 2), 'utf-8')
  }

  /** 写入纯文本执行结果（agent 直接 cat 即可获取） */
  writeResultTxt(result: ExecResult, instanceId: string) {
    this.ensureInstanceDir(instanceId)
    let text = ''
    if (result.success) {
      /** 过滤 undefined 返回值（链式操作最后一个 __pilot_wait 的返回值），减少 CLI 噪音 */
      const raw = result.result != null ? String(result.result) : ''
      text = raw === 'undefined' ? '' : raw
    } else {
      text = `ERROR: ${result.error || 'unknown'}`
    }
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.resultTxt), text, 'utf-8')
  }

  /** 读取执行结果 */
  readExecResult(instanceId: string): ExecResult | null {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.execResult)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8'))
  }

  /** 写入选中元素信息 */
  writeSelectedElement(info: ElementInfo, instanceId: string) {
    this.ensureInstanceDir(instanceId)
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.selectedElement), JSON.stringify(info, null, 2), 'utf-8')
  }

  /** 读取选中元素信息 */
  readSelectedElement(instanceId: string): ElementInfo | null {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.selectedElement)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8'))
  }

  /** 写入 compact 格式快照（供 AI 直接 cat 读取） */
  writeCompactSnapshot(text: string, instanceId: string) {
    this.ensureInstanceDir(instanceId)
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.compactSnapshot), text, 'utf-8')
  }

  /** 读取 compact 格式快照 */
  readCompactSnapshot(instanceId: string): string | null {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.compactSnapshot)
    if (!existsSync(file)) return null
    const content = readFileSync(file, 'utf-8')
    return content.trim() || null
  }

  /** 写入最近一次 exec 的控制台日志（grep-friendly 纯文本，每条一行） */
  writeRecentLogs(logs: string[], instanceId: string) {
    this.ensureInstanceDir(instanceId)
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.recentLogs)
    writeFileSync(file, logs.join('\n') + '\n', 'utf-8')
  }

  /** 读取最近一次 exec 的控制台日志 */
  readRecentLogs(instanceId: string): string | null {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.recentLogs)
    if (!existsSync(file)) return null
    const content = readFileSync(file, 'utf-8')
    return content.trim() || null
  }

  /** 写入执行完成标记（供 AI 轮询检测） */
  writeExecDone(instanceId: string) {
    this.ensureInstanceDir(instanceId)
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.execDone), '', 'utf-8')
  }

  /** 清除旧的执行结果文件（新代码分发时调用，避免 AI 读到过期结果） */
  clearExecResult(instanceId: string): void {
    const dir = this.getInstanceDir(instanceId)
    for (const name of [PILOT_FILES.execResult, PILOT_FILES.resultTxt]) {
      const file = join(dir, name)
      if (existsSync(file)) unlinkSync(file)
    }
  }

  /** 检查并清除执行完成标记 */
  clearExecDone(instanceId: string): boolean {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.execDone)
    if (!existsSync(file)) return false
    unlinkSync(file)
    return true
  }

  /** 读取服务端版本 ID */
  readVersion(): string {
    const file = resolve(this.pilotDir, PILOT_FILES.version)
    if (!existsSync(file)) return ''
    return readFileSync(file, 'utf-8').trim()
  }

  /** 写入服务端版本 ID */
  writeVersion(version: string) {
    const file = resolve(this.pilotDir, PILOT_FILES.version)
    writeFileSync(file, version)
  }

  /** 写入 dev server 端口号，供 agent 探测 */
  writePort(port: number) {
    const file = resolve(this.pilotDir, 'port.txt')
    writeFileSync(file, String(port))
  }
}
