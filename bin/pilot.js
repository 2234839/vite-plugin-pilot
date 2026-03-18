#!/usr/bin/env node
/**
 * pilot — vite-plugin-pilot 的 agent 友好 CLI
 * 纯文件 I/O，不依赖 HTTP 接口
 *
 * 用法:
 *   npx pilot run '1+1'            执行 JS 并获取结果
 *   npx pilot run 'code' page logs 执行并附带页面快照+日志
 *   npx pilot page                 读取页面快照（默认实时采集）
 *   npx pilot page cached          读取缓存的页面快照
 *   npx pilot logs                 读取最近 exec 的控制台日志
 *   npx pilot status               连接状态诊断
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'

const PILOT_FILES = {
  dir: '.pilot',
  instancesDir: 'instances',
  pendingJs: 'pending.js',
  resultTxt: 'result.txt',
  compactSnapshot: 'compact-snapshot.txt',
  recentLogs: 'recent-logs.txt',
  execDone: 'exec-done',
}

/**
 * 查找 .pilot 目录（向上搜索 cwd 和 playground 子目录）
 */
function findPilotDir() {
  const candidates = [
    process.cwd(),
    join(process.cwd(), 'playground', 'vue'),
    join(process.cwd(), 'playground', 'react'),
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, PILOT_FILES.dir, 'port.txt'))) {
      return join(dir, PILOT_FILES.dir)
    }
  }
  /** fallback：即使 port.txt 不存在也尝试 cwd 下的 .pilot */
  const cwdPilot = join(process.cwd(), PILOT_FILES.dir)
  if (existsSync(cwdPilot)) return cwdPilot
  return null
}

/**
 * 获取实例目录路径
 */
function getInstanceDir(pilotDir, instanceId) {
  return resolve(pilotDir, PILOT_FILES.instancesDir, instanceId)
}

/**
 * 轮询等待文件出现（最多 waitMs 毫秒）
 */
function waitForFile(filePath, waitMs = 30000) {
  const start = Date.now()
  const interval = 100
  return new Promise((resolve) => {
    function check() {
      if (existsSync(filePath)) {
        resolve(true)
        return
      }
      if (Date.now() - start >= waitMs) {
        resolve(false)
        return
      }
      setTimeout(check, interval)
    }
    check()
  })
}

/**
 * 安全读取文件，不存在返回 null
 */
function readFileSafe(filePath) {
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8')
    return content.trim() || null
  } catch {
    return null
  }
}

/**
 * 安全读取 JSON 文件，解析失败返回 null
 */
function readJsonSafe(filePath) {
  const content = readFileSafe(filePath)
  if (!content) return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * 写入待执行代码（清除旧的 exec-done 和 result）
 */
function writePendingJs(pilotDir, instanceId, code) {
  const dir = getInstanceDir(pilotDir, instanceId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const name of [PILOT_FILES.execDone, PILOT_FILES.resultTxt]) {
    const f = join(dir, name)
    if (existsSync(f)) unlinkSync(f)
  }

  writeFileSync(join(dir, PILOT_FILES.pendingJs), code, 'utf-8')
}

/**
 * 列出所有实例
 */
function listInstances(pilotDir) {
  const dir = resolve(pilotDir, PILOT_FILES.instancesDir)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const command = args[0] || 'help'
  const rest = args.slice(1)
  const flags = { page: false, logs: false, fresh: false, cached: false }
  const positional = []

  for (const arg of rest) {
    if (arg === 'page') flags.page = true
    else if (arg === 'logs') flags.logs = true
    else if (arg === 'fresh') flags.fresh = true
    else if (arg === 'cached') flags.cached = true
    else positional.push(arg)
  }

  return { command, flags, positional }
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2))
  const pilotDir = findPilotDir()

  /** 解析 instance ID：default 自动选最近活跃的实例，否则用指定的 UUID */
  let instanceId = process.env.PILOT_INSTANCE
  if (!instanceId || instanceId === 'default') {
    const activeFile = join(pilotDir, 'active-instance.json')
    const activeData = readJsonSafe(activeFile)
    if (activeData) {
      let bestTime = 0
      for (const [id, info] of Object.entries(activeData)) {
        if (info.lastSeen > bestTime) {
          instanceId = id
          bestTime = info.lastSeen
        }
      }
    }
    instanceId = instanceId || 'default'
  }

  switch (command) {
    case 'run': {
      const code = positional[0]
      if (!code) {
        console.error('用法: pilot run <code> [page] [logs]')
        process.exit(1)
      }
      if (!pilotDir) {
        console.error('ERROR: 未找到 .pilot 目录，请先启动 dev server')
        process.exit(1)
      }

      writePendingJs(pilotDir, instanceId, code)

      const doneFile = join(getInstanceDir(pilotDir, instanceId), PILOT_FILES.execDone)
      const ok = await waitForFile(doneFile, 30000)
      if (!ok) {
        console.error('TIMEOUT')
        process.exit(1)
      }

      const instanceDir = getInstanceDir(pilotDir, instanceId)
      let output = readFileSafe(join(instanceDir, PILOT_FILES.resultTxt)) || ''

      if (flags.page) {
        /** 优先从 exec-result.json 读取 snapshotText（与 exec-done 同步写入），
         *  fallback 到 compact-snapshot.txt（可能在 exec-done 后才更新） */
        const execResult = readJsonSafe(join(instanceDir, 'exec-result.json'))
        const snapshot = execResult?.snapshotText || readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
        if (snapshot) output += '\n---\n' + snapshot
      }
      if (flags.logs) {
        const logs = readFileSafe(join(instanceDir, PILOT_FILES.recentLogs))
        if (logs) output += '\n---\n' + logs
      }

      console.log(output)
      break
    }

    case 'page': {
      if (!pilotDir) {
        console.error('NO_BROWSER')
        process.exit(1)
      }

      const instanceDir = getInstanceDir(pilotDir, instanceId)

      if (!flags.cached) {
        /** 默认 fresh：写入 snapshot 采集代码，等待浏览器执行 */
        const snapshotCode = 'JSON.stringify(window.__pilot_snapshot && window.__pilot_snapshot())'
        writePendingJs(pilotDir, instanceId, snapshotCode)

        const doneFile = join(instanceDir, PILOT_FILES.execDone)
        const ok = await waitForFile(doneFile, 10000)
        if (!ok) {
          /** 超时降级到缓存 */
          const cached = readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
          console.log(cached || 'NO_SNAPSHOT')
          break
        }
      }

      const snapshot = readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
      /** page 命令的 snapshot 代码执行会污染 result.txt（写入 JSON snapshot），
       *  删除 result.txt 避免 run 命令读到过期数据 */
      const resultFile = join(instanceDir, PILOT_FILES.resultTxt)
      if (existsSync(resultFile)) unlinkSync(resultFile)
      console.log(snapshot || 'NO_SNAPSHOT')
      break
    }

    case 'logs': {
      if (!pilotDir) {
        console.error('NO_LOGS')
        process.exit(1)
      }

      const logs = readFileSafe(join(getInstanceDir(pilotDir, instanceId), PILOT_FILES.recentLogs))
      console.log(logs || 'NO_LOGS')
      break
    }

    case 'status': {
      if (!pilotDir) {
        console.log(JSON.stringify({ error: 'No .pilot directory found', instances: [] }, null, 2))
        process.exit(1)
      }

      const activeFile = join(pilotDir, 'active-instance.json')
      const activeData = readJsonSafe(activeFile) || {}
      /** 只显示最近活跃的实例，每个 label 只显示最近一个（避免同页面多 tab 重复） */
      const recentThreshold = Date.now() - 60 * 1000
      const seenLabels = {}
      const instanceDetails = Object.entries(activeData)
        .filter(([, info]) => info.lastSeen > recentThreshold)
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .filter(([, info]) => {
          if (seenLabels[info.label]) return false
          seenLabels[info.label] = true
          return true
        })
        .map(([id, info]) => {
          return `${id.slice(0, 8)} (${info.label})`
        })
      const instanceDir = getInstanceDir(pilotDir, instanceId)
      const hasSnapshot = existsSync(join(instanceDir, PILOT_FILES.compactSnapshot))
      const hasResult = existsSync(join(instanceDir, PILOT_FILES.resultTxt))
      const hasPending = existsSync(join(instanceDir, PILOT_FILES.pendingJs))

      console.log(JSON.stringify({
        pilotDir,
        instance: instanceId,
        instances: instanceDetails,
        hasSnapshot,
        hasResult,
        hasPending,
      }, null, 2))
      break
    }

    case 'help':
    default:
      console.log(`pilot — vite-plugin-pilot CLI (文件 I/O 模式)

用法: pilot <command> [args]

命令:
  run <code> [page] [logs]  执行 JS，可选附带页面快照和日志
  page [cached]              读取页面快照（默认实时采集，cached=读缓存）
  logs                     最近一次 exec 的控制台日志
  status                   文件系统状态诊断
  help                     显示此帮助信息

环境变量: PILOT_INSTANCE
目录探测: cwd

--- 浏览器端辅助函数 (在 run 中执行) ---

文本匹配（推荐）:
  __pilot_clickByText(text, nth?)      按文本点击元素
  __pilot_typeByPlaceholder(ph, value) 在输入框输入（触发 input 事件）
  __pilot_setValueByPlaceholder(ph, value, nth?) 设置输入框值
  __pilot_selectValueByText(text, nth?)  选择下拉框选项
  __pilot_checkByText(text, nth?)      勾选复选框
  __pilot_findByText(text)             查找元素 → [{idx, tag, text}]
  __pilot_waitFor(text, timeout?, disappear?)  等待文本出现/消失
  __pilot_waitEnabled(text, timeout?)  等待禁用元素变为可用

按索引（compact 中的 #N）:
  __pilot_click(i)        点击元素
  __pilot_setValue(i, v)  设置值
  __pilot_type(i, v)      输入值
  __pilot_dblclick(i)     双击元素
  __pilot_hover(i)        悬停元素

其他:
  __pilot_wait(ms)                      等待毫秒
  __pilot_snapshot()                    获取完整 JSON 快照
  __pilot_scrollIntoView(i)             滚动到元素
  __pilot_getRect(i)                    获取元素位置
  __pilot_checkMultipleByText([t1,t2])  勾选多个复选框
  __pilot_uncheckByText(text, nth?)     取消勾选
  __pilot_keydownByText(text, key)      在元素上触发按键

compact snapshot 格式: tag#idx[val=V][check=N][type=T][ph=P][disabled] text`)
      break
  }
}

main()
