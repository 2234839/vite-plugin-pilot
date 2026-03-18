import { appendFileSync, writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import type { ResolvedPilotOptions, LogEntry, ExecResult, ElementInfo, SnapshotData } from '../types'
import { PILOT_FILES } from '../constants'

/** 实例注册信息 */
interface InstanceInfo {
  path: string
  label: string
  lastSeen: number
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

    const instancesDir = this.getInstancesDir()
    if (existsSync(instancesDir)) {
      /** 启动时清理所有旧实例目录（浏览器 tab 会重新连接创建新实例） */
      for (const name of readdirSync(instancesDir)) {
        rmSync(join(instancesDir, name), { recursive: true, force: true })
      }
    } else {
      mkdirSync(instancesDir, { recursive: true })
    }

    /** 清理旧的实例注册信息 */
    const activeFile = resolve(this.pilotDir, PILOT_FILES.activeInstance)
    if (existsSync(activeFile)) {
      unlinkSync(activeFile)
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

  /** 确保实例目录存在 */
  private ensureInstanceDir(instanceId: string) {
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

  /** 注册/更新实例信息（每次 /check 请求时调用） */
  writeActiveInstance(instanceId: string, urlPath: string) {
    const map = this.readActiveInstance()
    const label = FileBridge.toInstanceId(urlPath)
    map[instanceId] = { path: urlPath, label, lastSeen: Date.now() }
    writeFileSync(resolve(this.pilotDir, PILOT_FILES.activeInstance), JSON.stringify(map, null, 2), 'utf-8')
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

  /** 追加日志到文件 */
  appendLogs(logs: LogEntry[], instanceId: string) {
    this.ensureInstanceDir(instanceId)
    const formatted = this.formatLogs(logs)
    appendFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.logs), formatted, 'utf-8')
  }

  /** 格式化日志条目 — 每条一行，便于 grep 搜索 */
  private formatLogs(logs: LogEntry[]): string {
    return logs.map(log => {
      const parts = [
        `[${log.timestamp}]`,
        `[${log.type.toUpperCase()}]`,
      ]
      if (log.source) {
        parts.push(`[${log.source}:${log.line ?? '?'}:${log.col ?? '?'}]`)
      }
      parts.push(log.message)
      const line = parts.join(' ')
      if (log.stack) {
        return line + '\n  ' + log.stack.split('\n').join('\n  ')
      }
      return line
    }).join('\n') + '\n'
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

  /** 写入页面快照 */
  writeSnapshot(data: SnapshotData, instanceId: string) {
    this.ensureInstanceDir(instanceId)
    writeFileSync(join(this.getInstanceDir(instanceId), PILOT_FILES.snapshot), JSON.stringify(data, null, 2), 'utf-8')
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

  /** 读取页面快照 */
  readSnapshot(instanceId: string): SnapshotData | null {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.snapshot)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8'))
  }

  /** 读取日志文件内容 */
  readLogs(instanceId: string): string | null {
    const file = join(this.getInstanceDir(instanceId), PILOT_FILES.logs)
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
