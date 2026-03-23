#!/usr/bin/env node
/**
 * pilot — vite-plugin-pilot 的 agent 友好 CLI
 *
 * 双模式运行：
 * 1. HTTP 模式（优先）：通过 curl 一步获取结果，延迟更低
 * 2. 文件通道模式（fallback）：通过文件 I/O 等待结果，不依赖 HTTP
 *
 * 用法:
 *   npx pilot run '1+1'            执行 JS 并获取结果+日志+页面快照
 *   npx pilot run 'code' nopage    执行但不附带页面快照
 *   npx pilot run 'code' nologs    执行但不附带日志
 *   npx pilot page                 读取页面快照（默认实时采集）
 *   npx pilot page cached          读取缓存的页面快照
 *   npx pilot logs                 读取最近 exec 的控制台日志
 *   npx pilot status               连接状态诊断
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, watch as fsWatch } from 'fs'
import { dirname, join, resolve } from 'path'
import { createRequire } from 'module'

/** 通过 require 读取 package.json 中的版本号（npm 安装后路径可靠） */
const require = createRequire(import.meta.url)
const CURRENT_VERSION = require('../package.json').version
import http from 'http'
import https from 'https'

/** 实例活跃判定阈值（秒），超过此时间视为不活跃 */
const INSTANCE_ACTIVE_THRESHOLD = 90

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
 * 从 .pilot/port.txt 读取 dev server 端口
 */
function getServerPort(pilotDir) {
  const portFile = join(pilotDir, 'port.txt')
  const content = readFileSafe(portFile)
  return content ? parseInt(content, 10) : 0
}

/**
 * 通过 HTTP API 发送请求（bypass 代理，自动携带 instance header）
 * 返回 { status, body } 或 null（连接失败）
 */
function httpGet(path, port, instanceId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy()
      resolve(null)
    }, timeoutMs)

    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path,
      headers: { 'X-Pilot-Instance': instanceId },
      timeout: timeoutMs,
    }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        clearTimeout(timer)
        resolve({ status: res.statusCode, body })
      })
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    req.on('timeout', () => {
      clearTimeout(timer)
      req.destroy()
      resolve(null)
    })
  })
}

/**
 * 查找 .pilot 目录（向上搜索 cwd 和 playground 子目录）
 */
function findPilotDir() {
  const candidates = [
    process.cwd(),
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
 * 通过 fs.watch 事件驱动等待文件出现（即时响应，零轮询）
 * fs.watch 不可用时 fallback 到 100ms 轮询
 */
function waitForFile(filePath, waitMs = 30000) {
  return new Promise((resolve) => {
    const parentDir = dirname(filePath)

    /** 确保 parent 目录存在 */
    if (!existsSync(parentDir)) {
      resolve(false)
      return
    }

    /** 文件可能在我们设置 watch 之前就已存在 */
    if (existsSync(filePath)) {
      resolve(true)
      return
    }

    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        watcher?.close()
        resolve(false)
      }
    }, waitMs)

    let watcher
    try {
      watcher = fsWatch(parentDir, (eventType, filename) => {
        if (settled) return
        if (!filename || filename !== filePath.split('/').pop()) return
        if (existsSync(filePath)) {
          settled = true
          clearTimeout(timeout)
          watcher.close()
          resolve(true)
        }
      })
      watcher.on('error', () => {
        if (settled) return
        watcher.close()
        fallbackPoll()
      })
    } catch {
      fallbackPoll()
    }

    /** fs.watch 不可用时 fallback 到 100ms 轮询 */
    function fallbackPoll() {
      if (settled) return
      const start = Date.now()
      const poll = setInterval(() => {
        if (settled) { clearInterval(poll); return }
        if (existsSync(filePath)) {
          settled = true
          clearTimeout(timeout)
          clearInterval(poll)
          resolve(true)
        } else if (Date.now() - start >= waitMs) {
          settled = true
          clearInterval(poll)
          resolve(false)
        }
      }, 100)
    }
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
  const flags = { page: false, logs: false, fresh: false, cached: false, nopage: false, nologs: false }
  const positional = []

  for (const arg of rest) {
    if (arg === 'page') flags.page = true
    else if (arg === 'logs') flags.logs = true
    else if (arg === 'nopage') flags.nopage = true
    else if (arg === 'nologs') flags.nologs = true
    else if (arg === 'fresh') flags.fresh = true
    else if (arg === 'cached') flags.cached = true
    else if (arg.startsWith('instance:')) flags.instance = arg.slice(9)
    else positional.push(arg)
  }

  return { command, flags, positional }
}

/**
 * 构建实例信息提示（附在输出末尾，帮助 agent 选择正确的实例）
 */
function buildInstanceHint(activeData, currentInstanceId) {
  const recentThreshold = Date.now() - INSTANCE_ACTIVE_THRESHOLD * 1000
  const now = Date.now()
  const recent = Object.entries(activeData)
    .filter(([, info]) => info.lastSeen >= recentThreshold)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .map(([id, info]) => {
      const isCurrent = id === currentInstanceId ? '← ' : '  '
      /** console: 前缀实例显示完整 ID，普通实例显示前 8 位 */
      const displayId = id.startsWith('console:') ? id : id.slice(0, 8)
      const title = info.title ? ` [${info.title}]` : ''
      const agoSec = Math.round((now - info.lastSeen) / 1000)
      const agoStr = agoSec < 60 ? `${agoSec}s` : `${Math.round(agoSec / 60)}m`
      return `${isCurrent}${displayId} (${info.label}${title}) ${agoStr} ago`
    })

  if (recent.length <= 1) return ''
  const lines = recent.join('\n')
  return '\n--- instances ---\n' + lines + '\nswitch: npx pilot <cmd> instance:xxxxxxxx'
}

/**
 * 异步检查 npm 新版本（每天最多一次，3s 超时，非阻塞）
 * 结果写入 .pilot/npm-check.json：{ date, latest }
 */
function checkNpmUpdate(pilotDir) {
  const checkFile = join(pilotDir, 'npm-check.json')
  const today = new Date().toISOString().slice(0, 10)

  /** 已经检测过今天就不重复检测 */
  try {
    const cached = JSON.parse(readFileSync(checkFile, 'utf-8'))
    if (cached.date === today) return
  } catch { /* 文件不存在或格式错误，继续检测 */ }

  const timer = setTimeout(() => req.destroy(), 3000)
  const req = https.get('https://registry.npmjs.org/vite-plugin-pilot/latest', (res) => {
    clearTimeout(timer)
    let body = ''
    res.on('data', (c) => { body += c })
    res.on('end', () => {
      try {
        const data = JSON.parse(body)
        if (data.version) {
          writeFileSync(checkFile, JSON.stringify({ date: today, latest: data.version }), 'utf-8')
        }
      } catch { /* ignore */ }
    })
  })
  req.on('error', () => { clearTimeout(timer) })
  req.on('timeout', () => { clearTimeout(timer); req.destroy() })
}

/**
 * 比较两个 semver 版本号，返回 latest > current 时为 true
 * 用数字比较替代字符串比较，避免 "0.10.0" > "0.9.0" 返回 false 的 bug
 */
function isNewerVersion(latest, current) {
  const l = latest.split('.').map(Number)
  const c = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true
    if ((l[i] || 0) < (c[i] || 0)) return false
  }
  return false
}

/**
 * 构建新版本提示（从缓存文件读取，有新版本时返回提示文本）
 */
function buildUpdateHint(pilotDir) {
  const checkFile = join(pilotDir, 'npm-check.json')
  try {
    const cached = JSON.parse(readFileSync(checkFile, 'utf-8'))
    if (cached.latest && isNewerVersion(cached.latest, CURRENT_VERSION)) {
      return `\n--- update ---\nNew version: vite-plugin-pilot@${cached.latest} (current: ${CURRENT_VERSION})\nnpx npm i -g vite-plugin-pilot`
    }
  } catch { /* ignore */ }
  return ''
}

/** 构建附加提示信息（实例列表 + 新版本提示） */
function buildHints(pilotDir, activeData, instanceId) {
  return buildInstanceHint(activeData, instanceId) + buildUpdateHint(pilotDir)
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2))
  const pilotDir = findPilotDir()

  /** 异步检查 npm 新版本（非阻塞，每天一次） */
  if (pilotDir) checkNpmUpdate(pilotDir)

  /** 解析 instance ID：命令行参数 > 环境变量 > 自动选最近活跃的实例 */
  let instanceId = flags.instance || process.env.PILOT_INSTANCE
  const activeFile = join(pilotDir, 'active-instance.json')
  const activeData = readJsonSafe(activeFile) || {}
  if (!instanceId || instanceId === 'default') {
    let bestTime = 0
    for (const [id, info] of Object.entries(activeData)) {
      if (info.lastSeen > bestTime) {
        instanceId = id
        bestTime = info.lastSeen
      }
    }
    instanceId = instanceId || 'default'
  }

  /** 检查实例是否活跃（90 秒内有连接，3 个心跳周期的容错） */
  const instanceInfo = activeData[instanceId]
  const recentThreshold = Date.now() - INSTANCE_ACTIVE_THRESHOLD * 1000
  if (!instanceInfo || instanceInfo.lastSeen < recentThreshold) {
    const available = Object.entries(activeData)
      .filter(([, info]) => info.lastSeen >= recentThreshold)
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
      .map(([id, info]) => {
        const displayId = id.startsWith('console:') ? id : id.slice(0, 8)
        const title = info.title ? ` [${info.title}]` : ''
        return `  ${displayId} (${info.label}${title})`
      })
    if (available.length > 0) {
      const currentDisplay = instanceId.startsWith('console:') ? instanceId : instanceId.slice(0, 8)
      console.error(`WARNING: 实例 ${currentDisplay} 不活跃，可用实例:\n${available.join('\n')}\n提示: npx pilot ${command} instance:xxxxxxxx`)
    }
  }

  switch (command) {
    case 'run': {
      const code = positional[0]
      if (!code) {
        console.error('用法: pilot run <code> [nopage] [nologs]')
        process.exit(1)
      }
      if (!pilotDir) {
        console.error('ERROR: 未找到 .pilot 目录，请先启动 dev server')
        process.exit(1)
      }

      const showLogs = !flags.nologs
      const showPage = !flags.nopage

      /** 优先尝试 HTTP API（一步获取结果，延迟更低） */
      const port = getServerPort(pilotDir)
      if (port) {
        const params = new URLSearchParams({ code, instance: instanceId })
        if (showPage) params.set('page', '1')
        if (showLogs) params.set('logs', '1')
        const result = await httpGet(`/__pilot/run?${params}`, port, instanceId, 35000)
        if (result && result.status === 200) {
          console.log(result.body + buildHints(pilotDir, activeData, instanceId))
          break
        }
        /** HTTP 返回 NO_BROWSER/TIMEOUT 时 fallback 到文件通道 */
        if (result && (result.status === 503 || result.status === 504)) {
          /** 503=无浏览器，直接退出不 fallback */
          if (result.status === 503) {
            console.error(result.body)
            process.exit(1)
          }
          /** 504=超时，输出已有日志 */
          const instanceDir = getInstanceDir(pilotDir, instanceId)
          const logs = readFileSafe(join(instanceDir, PILOT_FILES.recentLogs))
          if (logs) console.error('TIMEOUT\n---\n' + logs)
          else console.error('TIMEOUT')
          process.exit(1)
        }
      }

      /** 文件通道 fallback */
      writePendingJs(pilotDir, instanceId, code)

      const doneFile = join(getInstanceDir(pilotDir, instanceId), PILOT_FILES.execDone)
      const ok = await waitForFile(doneFile, 30000)
      if (!ok) {
        const instanceDir = getInstanceDir(pilotDir, instanceId)
        const logs = readFileSafe(join(instanceDir, PILOT_FILES.recentLogs))
        if (logs) console.error('TIMEOUT\n---\n' + logs)
        else console.error('TIMEOUT')
        process.exit(1)
      }

      const instanceDir = getInstanceDir(pilotDir, instanceId)
      let output = readFileSafe(join(instanceDir, PILOT_FILES.resultTxt)) || ''

      if (showLogs) {
        const logs = readFileSafe(join(instanceDir, PILOT_FILES.recentLogs))
        if (logs) output += '\n--- logs ---\n' + logs
      }
      if (showPage) {
        const execResult = readJsonSafe(join(instanceDir, 'exec-result.json'))
        const snapshot = execResult?.snapshotText || readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
        if (snapshot) output += '\n--- page snapshot ---\n' + snapshot
      }

      console.log(output + buildHints(pilotDir, activeData, instanceId))
      break
    }

    case 'page': {
      if (!pilotDir) {
        console.error('NO_BROWSER')
        process.exit(1)
      }

      /** 优先尝试 HTTP API */
      const port = getServerPort(pilotDir)
      if (port && !flags.cached) {
        const params = new URLSearchParams({ fresh: '1', instance: instanceId })
        const result = await httpGet(`/__pilot/page?${params}`, port, instanceId, 10000)
        if (result && result.status === 200) {
          console.log(result.body + buildHints(pilotDir, activeData, instanceId))
          break
        }
        /** 504=超时，降级到缓存 */
        if (result && result.status === 504) {
          const instanceDir = getInstanceDir(pilotDir, instanceId)
          const cached = readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
          console.log((cached || 'NO_SNAPSHOT') + buildHints(pilotDir, activeData, instanceId))
          break
        }
        /** 503=无浏览器，降级到文件通道尝试 */
      }

      /** 文件通道 fallback */
      const instanceDir = getInstanceDir(pilotDir, instanceId)

      if (!flags.cached) {
        const snapshotCode = 'JSON.stringify(window.__pilot_snapshot && window.__pilot_snapshot())'
        writePendingJs(pilotDir, instanceId, snapshotCode)

        const doneFile = join(instanceDir, PILOT_FILES.execDone)
        const ok = await waitForFile(doneFile, 10000)
        if (!ok) {
          const cached = readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
          console.log(cached || 'NO_SNAPSHOT')
          break
        }
      }

      const snapshot = readFileSafe(join(instanceDir, PILOT_FILES.compactSnapshot))
      const resultFile = join(instanceDir, PILOT_FILES.resultTxt)
      if (existsSync(resultFile)) unlinkSync(resultFile)
      console.log((snapshot || 'NO_SNAPSHOT') + buildHints(pilotDir, activeData, instanceId))
      break
    }

    case 'logs': {
      if (!pilotDir) {
        console.error('NO_LOGS')
        process.exit(1)
      }

      /** 优先尝试 HTTP API */
      const port = getServerPort(pilotDir)
      if (port) {
        const params = new URLSearchParams({ instance: instanceId })
        const result = await httpGet(`/__pilot/logs?${params}`, port, instanceId, 5000)
        if (result && result.status === 200) {
          console.log(result.body)
          break
        }
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
      /** 只显示最近活跃的实例（按 lastSeen 降序） */
      const recentThreshold = Date.now() - INSTANCE_ACTIVE_THRESHOLD * 1000
      const now = Date.now()
      const instanceDetails = Object.entries(activeData)
        .filter(([, info]) => info.lastSeen > recentThreshold)
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .map(([id, info]) => {
          const title = info.title ? ` [${info.title}]` : ''
          /** 活跃时间距现在的秒数 */
          const agoSec = Math.round((now - info.lastSeen) / 1000)
          const agoStr = agoSec < 60 ? `${agoSec}s ago` : `${Math.round(agoSec / 60)}m ago`
          return { id: id.slice(0, 8), label: info.label, title: info.title || '', lastSeen: agoStr }
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

    case 'bridge': {
      if (!pilotDir) {
        console.error('ERROR: 未找到 .pilot 目录，请先启动 dev server')
        process.exit(1)
      }
      const port = getServerPort(pilotDir)
      if (!port) {
        console.error('ERROR: 未找到 port.txt，请先启动 dev server')
        process.exit(1)
      }
      const result = await httpGet('/__pilot/bridge.js', port, 'console:dummy', 5000)
      if (result && result.status === 200) {
        console.log(result.body)
      } else {
        console.error('ERROR: 无法获取 bridge.js，请确认 dev server 正在运行')
        process.exit(1)
      }
      break
    }

    case 'userscript': {
      if (!pilotDir) {
        console.error('ERROR: 未找到 .pilot 目录，请先启动 dev server')
        process.exit(1)
      }
      const port = getServerPort(pilotDir)
      if (!port) {
        console.error('ERROR: 未找到 port.txt，请先启动 dev server')
        process.exit(1)
      }
      const result = await httpGet('/__pilot/userscript.js', port, 'userscript:dummy', 5000)
      if (result && result.status === 200) {
        console.log(result.body)
      } else {
        console.error('ERROR: 无法获取 userscript.js，请确认 dev server 正在运行')
        process.exit(1)
      }
      break
    }

    case 'help':
    default:
      console.log(`pilot — vite-plugin-pilot CLI (HTTP 优先，文件通道 fallback)

用法: pilot <command> [args]

命令:
  run <code> [nopage] [nologs] [instance:xxx]  执行 JS，默认附带日志+页面快照
  page [cached] [instance:xxx]                  读取页面快照（默认实时采集，cached=读缓存）
  logs [instance:xxx]                           最近一次 exec 的控制台日志
  status                                        文件系统状态诊断
  bridge                                        输出 Console Bridge 脚本（粘贴到任意浏览器控制台）
  userscript                                    输出 Tampermonkey 脚本（安装后自动在所有页面运行）
  help                                          显示此帮助信息

实例选择: instance:xxxxxxxx 或环境变量 PILOT_INSTANCE
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
