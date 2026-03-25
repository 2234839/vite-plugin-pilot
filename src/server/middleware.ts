import type { IncomingMessage, ServerResponse } from 'http'
import { watch as fsWatch, watchFile, existsSync, type FSWatcher } from 'fs'
import { resolve } from 'path'
import type { ResolvedPilotOptions, ExecResult, ElementInfo } from '../types'
import { PILOT_ENDPOINTS } from '../constants'
import { FileBridge } from './file-bridge'
import type { InstanceType } from './file-bridge'
import { generateElementPrompt } from '../prompt/generator'
import { getCompactText } from './compact'
import { buildBridgeScript } from './bridge'
import { buildUserscript } from './userscript'

/** 等待者类型，决定 POST /result handler 的响应格式 */
type WaiterType = 'default' | 'run' | 'page' | 'snapshot'

/** 等待者选项（类型安全，替代 (res as any).__pilot_xxx） */
interface WaiterOptions {
  type: WaiterType
  withPage?: boolean
  withLogs?: boolean
  withSnapshot?: boolean
  compact?: boolean
  /** CLI 传入的原始代码（用于 runcode 显示，避免竞态导致显示错误的 result.code） */
  runCode?: string
}

/**
 * 创建 Pilot 中间件路由
 * 处理所有 /__pilot/* 端点请求
 * 通过 SSE + 文件通道实现浏览器通信（CLI 写 pending.js → fs.watch → SSE 推送 → exec → POST /result）
 * 支持多实例：每个浏览器 tab 通过随机 instance ID 自动隔离
 */
export function createMiddleware(options: ResolvedPilotOptions, pilotVersion?: string) {
  const bridge = new FileBridge(options)
  const serverStartedAt = Date.now()

  /** 启动时写入版本 ID（仅一次，供 AI 诊断和客户端对比） */
  if (pilotVersion) {
    bridge.writeVersion(pilotVersion)
  }

  /** 监控 version.txt 变化（pnpm build 后更新），推送 SSE reload 事件给浏览器
   *  使用 watchFile（polling-based）而非 fsWatch（inotify），WSL2 上 inotify 不可靠 */
  let lastReloadVersion = pilotVersion || ''
  try {
    const versionFile = resolve(options.pilotDir, 'version.txt')
    if (existsSync(versionFile)) {
      watchFile(versionFile, { interval: 500 }, (cur, prev) => {
        if (cur.mtimeMs === prev.mtimeMs) return
        const newVersion = bridge.readVersion()
        if (!newVersion || newVersion === lastReloadVersion) return
        lastReloadVersion = newVersion
        for (const connections of Object.values(sseConnections)) {
          for (const res of connections) {
            res.write('event: reload\ndata: 1\n\n')
          }
        }
      })
    }
  } catch { /* version.txt 不存在时忽略 */ }

  /** SSE 连接池（按实例隔离） */
  const sseConnections: Record<string, Array<ServerResponse>> = {}

  /** 每个实例最近一次通过 dispatchCode 广播的代码（用于防止 fs.watch 重复广播） */
  const lastDispatchedCode: Record<string, string> = {}

  /** 实例目录的 fs.watch 监听器（每个实例一个，多 SSE 连接共享） */
  const instanceWatchers: Record<string, FSWatcher> = {}

  /** 向指定实例的所有 SSE 连接广播代码 */
  function broadcastCode(instanceId: string, code: string): void {
    const connections = sseConnections[instanceId]
    if (!connections || connections.length === 0) return
    for (const res of connections) {
      res.write(`event: code\ndata: ${code}\n\n`)
    }
  }

  /** 写 pending.js 并通过 SSE 广播代码给浏览器（同时写文件供 CLI 文件通道使用）
   *  记录已广播的 code，防止 fs.watch 的 checkAndBroadcast 重复推送 */
  function dispatchCode(instanceId: string, code: string): void {
    bridge.clearExecResult(instanceId)
    bridge.clearExecDone(instanceId)
    lastBrowserActivity[instanceId] = Date.now()
    broadcastCode(instanceId, code)
    /** SSE 推送成功后清理 pending.js，避免过期文件残留 */
    bridge.clearPendingJs(instanceId)
  }

  /** 根据 locale 决定提示语言 */
  const isZh = options.locale !== 'en'

  /** 原生 DOM 操作模式 → 对应的 pilot 辅助函数提示（根据 locale 切换语言） */
  const DOM_HINTS: Array<{ pattern: RegExp; hintZh: string; hintEn: string }> = [
    { pattern: /document\.(querySelector|getElementById|getElementsBy)/, hintZh: '__pilot_findByText("text") → [{idx, tag, text}]', hintEn: '__pilot_findByText("text") → [{idx, tag, text}]' },
    { pattern: /\.click\(\)/, hintZh: '__pilot_clickByText("text") 或 __pilot_click(idx)', hintEn: '__pilot_clickByText("text") or __pilot_click(idx)' },
    { pattern: /\.value\s*=/, hintZh: '__pilot_typeByPlaceholder("placeholder", "value") 或 __pilot_setValue(i, v)', hintEn: '__pilot_typeByPlaceholder("ph", "value") or __pilot_setValue(i, v)' },
    { pattern: /dispatchEvent.*Mouse/, hintZh: '__pilot_clickByText / __pilot_dblclickByText', hintEn: '__pilot_clickByText / __pilot_dblclickByText' },
    { pattern: /setTimeout.*\d{3,}/, hintZh: '__pilot_waitFor("text") 比 setTimeout 更可靠', hintEn: '__pilot_waitFor("text") is more reliable than setTimeout' },
  ]

  /** 常见错误模式 → 修复建议（帮助 agent 快速定位和解决问题） */
  const ERROR_HINTS: Array<{ pattern: RegExp; hintZh: string; hintEn: string }> = [
    { pattern: /Cannot read propert.*null/i, hintZh: '元素未找到，使用 __pilot_findByText 或 __pilot_waitFor 确认元素存在', hintEn: 'Element not found. Use __pilot_findByText or __pilot_waitFor to confirm the element exists' },
    { pattern: /Cannot read propert.*undefined/i, hintZh: '返回值为 undefined，检查选择器或使用 __pilot_snapshot() 查看页面状态', hintEn: 'Result is undefined. Check selector or use __pilot_snapshot() to inspect page state' },
    { pattern: /is not a function/i, hintZh: '方法不存在，检查拼写或使用 `npx pilot help` 查看可用函数', hintEn: 'Method not found. Check spelling or use `npx pilot help` for available functions' },
    { pattern: /Element.*disconnected/i, hintZh: '元素已脱离 DOM，页面可能已更新，请重新获取元素', hintEn: 'Element disconnected from DOM. Page may have updated, re-fetch the element' },
    { pattern: /No element found/i, hintZh: '未找到匹配元素，使用 __pilot_findByText 查看可用元素', hintEn: 'No matching element. Use __pilot_findByText to list available elements' },
  ]

  /** 检测代码中的原生 DOM 操作并生成辅助函数提示
   *  只在代码不包含 __pilot_ 且匹配到原生 DOM 模式时才生成提示 */
  function buildApiHint(code: string): string {
    if (!code || code.includes('__pilot_')) return ''
    const matched: string[] = []
    for (const { pattern, hintZh, hintEn } of DOM_HINTS) {
      const hint = isZh ? hintZh : hintEn
      if (pattern.test(code) && !matched.includes(hint)) matched.push(hint)
    }
    if (matched.length === 0) return ''
    const title = isZh ? 'pilot 提供了辅助函数来操作 DOM:' : 'pilot has helper functions for common DOM operations:'
    return '\n--- hint ---\n' + title + '\n  ' + matched.join('\n  ')
  }

  /** 根据错误信息生成修复建议 */
  function buildErrorHint(error: string): string {
    if (!error) return ''
    for (const { pattern, hintZh, hintEn } of ERROR_HINTS) {
      if (pattern.test(error)) return isZh ? hintZh : hintEn
    }
    return ''
  }

  /** 是否已提示过辅助函数（一旦 agent 使用 __pilot_ 函数就停止提示，dev server 重启后重置） */
  let hintDismissed = false

  /** 格式化 run 请求的返回值（POST /result 和 GET /result-img 共用）
   *  输出结构：runcode → 返回值/ERROR → exec 日志 → 上下文日志 → 页面快照
   *  设计原则：agent 最关心的是「执行是否成功」和「返回了什么」，放在最前面 */
  function formatRunResult(result: ExecResult | null | undefined, opts: WaiterOptions): string {
    if (!result) return 'TIMEOUT'

    /** 优先使用 CLI 传入的原始代码，fallback 到客户端返回的 result.code */
    const codeSource = opts.runCode || (typeof result.code === 'string' ? result.code : '')
    const codePreview = codeSource.slice(0, 200).replace(/\n/g, ' ')
    const lines: string[] = []
    lines.push(`--- runcode --- ${codePreview}`)

    /** logs 按 "---" 分隔：客户端返回的顺序是 contextLogs, ---, execLogs */
    let execLogs: string[] = []
    let contextLogs: string[] = []
    if (opts.withLogs !== false && result.logs && result.logs.length > 0) {
      const sepIdx = result.logs.indexOf('---')
      if (sepIdx !== -1) {
        contextLogs = result.logs.slice(0, sepIdx)
        execLogs = result.logs.slice(sepIdx + 1)
      } else {
        execLogs = result.logs
      }
    }

    /** 返回值紧跟 runcode，是 agent 最关心的信息
     *  客户端 serializeResult 将 undefined 序列化为字符串 "undefined"，
     *  纯操作（如 __pilot_clickByText）执行成功但无返回值时 result 为 "undefined"，
     *  过滤为空避免噪音。有实际返回值时原样输出，null 保留（可能是有效的查询结果） */
    if (result.success) {
      const raw = String(result.result ?? '')
      if (raw && raw !== 'undefined') lines.push(raw)
    } else {
      const errorMsg = result.error || 'unknown'
      lines.push(`ERROR: ${errorMsg}`)
      /** 错误场景附加修复建议，帮助 agent 快速定位问题 */
      const errHint = buildErrorHint(errorMsg)
      if (errHint) lines.push(errHint)
    }

    /** exec 期间的日志放在返回值后面（仅在有返回值或日志时添加分隔） */
    if (execLogs.length > 0) {
      lines.push('--- exec logs ---')
      lines.push(...execLogs)
    }

    /** 上下文日志放在最后（仅在 exec 日志存在时才输出，避免纯操作场景的噪音） */
    if (contextLogs.length > 0 && execLogs.length > 0) {
      lines.push('--- context logs ---')
      lines.push(...contextLogs)
    }

    /** 附带页面快照：默认附带（withPage=true），exec 失败时即使 nopage 也附带（帮助 agent 诊断失败原因） */
    const shouldShowPage = opts.withPage || (!result.success && result.snapshotText)
    if (shouldShowPage && result.snapshotText) {
      lines.push('--- page snapshot ---')
      lines.push(result.snapshotText)
    }

    /** 智能方法提示：检测代码中是否使用了原生 DOM 操作，推荐 pilot 辅助函数
     *  一旦 agent 使用了 __pilot_ 函数就停止提示（已掌握 API）
     *  dev server 重启后重置（hintDismissed 是内存状态） */
    if (codeSource.includes('__pilot_')) {
      hintDismissed = true
    }
    if (!hintDismissed) {
      const hint = buildApiHint(codeSource)
      if (hint) lines.push(hint)
    }

    return lines.join('\n')
  }

  /** 每个实例最后的浏览器活动时间戳 */
  const lastBrowserActivity: Record<string, number> = {}

  /** exec 结果的等待者队列（按实例隔离） */
  const execWaiters: Record<string, Array<{ res: ServerResponse; timer: NodeJS.Timeout }>> = {}

  /** 等待者选项映射（类型安全，替代 (res as any).__pilot_xxx） */
  const waiterOptions = new WeakMap<ServerResponse, WaiterOptions>()

  /** 从请求中提取实例 ID（优先 header > query param > default） */
  function getInstanceId(req: IncomingMessage): string {
    const headerId = req.headers['x-pilot-instance'] as string
    if (headerId) return headerId
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const queryId = url.searchParams.get('instance')
      if (queryId) return queryId
    } catch { /* ignore */ }
    return FileBridge.toInstanceId('/')
  }

  return {
    bridge,

    /** connect 风格的中间件处理函数 */
    handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
      if (!req.url?.startsWith('/__pilot/')) {
        next()
        return
      }

      /** CORS preflight：GM_xmlhttpRequest POST 带 Content-Type: application/json 会触发 OPTIONS 预检 */
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Pilot-Instance, X-Pilot-Title',
          'Access-Control-Max-Age': '86400',
        })
        res.end()
        return
      }

      /** 所有响应添加 CORS header（支持 GM_xmlhttpRequest 跨域访问） */
      res.setHeader('Access-Control-Allow-Origin', '*')

      const endpoint = req.url.split('?')[0]
      const instanceId = getInstanceId(req)

      /** ---------- POST /__pilot/exec ---------- */
      if (endpoint === PILOT_ENDPOINTS.exec && req.method === 'POST') {
        /** 解析查询参数，支持 ?wait=1 同步等待结果，?snapshot=1 附带更新后 snapshot */
        const url = new URL(req.url, 'http://localhost')
        const shouldWait = url.searchParams.get('wait') !== null
        const withSnapshot = url.searchParams.get('snapshot') !== null
        const compactSnapshot = url.searchParams.get('compact') !== null

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          /** 支持 JSON string 或纯文本 */
          const code = parseExecCode(body)
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Empty code' }))
            return
          }

          /** 新代码入队时清除旧结果和完成标记，避免 AI 读到过期数据 */
          bridge.clearExecResult(instanceId)
          bridge.clearExecDone(instanceId)

          /** 通过 SSE 广播给浏览器 */
          dispatchCode(instanceId, code)

          if (shouldWait) {
            /** 快速失败：从未有浏览器连接时立即返回 503 */
            if (!lastBrowserActivity[instanceId]) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'No browser connected. Open the page first.', success: false }))
              return
            }
            /** 同步等待模式：等待客户端执行并返回结果 */
            enqueueWaiter(instanceId, res, { type: 'default', withSnapshot, compact: compactSnapshot }, 70_000, () => {
              res.writeHead(504, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Execution timeout', success: false }))
            })
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          }
        })
        return
      }

      /** ---------- GET /__pilot/sse ---------- */
      if (endpoint === PILOT_ENDPOINTS.sse && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost')
        const sseInstance = url.searchParams.get('instance') || instanceId
        const pageTitle = decodeURIComponent(url.searchParams.get('title') || '')

        lastBrowserActivity[sseInstance] = Date.now()

        /** 注册实例信息（跨域时 referer 丢失，优先用 query params 中的 path） */
        const queryPath = url.searchParams.get('path') || ''
        const referer = queryPath || req.headers.referer || '/'
        const clientType = (url.searchParams.get('type') as InstanceType) || 'vite'
        bridge.writeActiveInstance(sseInstance, referer, clientType, pageTitle)

        /** 版本检查在心跳和 fs.watch 中处理，SSE 连接时不做检查
         *  因为 injectScript 中的版本号是 configureServer 时固定的，build 后不匹配是正常的
         *  Console Bridge / Userscript 实例跳过版本检查（无法 reload，会丢失注入代码） */

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.write('event: ping\ndata: connected\n\n')

        if (!sseConnections[sseInstance]) sseConnections[sseInstance] = []
        sseConnections[sseInstance].push(res)

        /** 每 30s 发送心跳，防止代理/防火墙静默断开空闲 SSE 连接
         *  同时更新活跃时间，确保 CLI 的 30s 活跃检测不会误判 */
        const heartbeat = setInterval(() => {
          lastBrowserActivity[sseInstance] = Date.now()
          bridge.writeActiveInstance(sseInstance, referer, clientType)
          res.write('event: ping\ndata: 1\n\n')
        }, 30_000)

        /** 用 fs.watch 监听实例目录变化，CLI 写入 pending.js 时即时推送
         *  失败时 fallback 到 1s setInterval 轮询（网络文件系统、Docker 挂载等场景） */
        const instanceDir = bridge.getInstanceDir(sseInstance)
        /** 检查并推送 pending.js 代码（供 CLI 文件通道触发）
         *  跳过已被 dispatchCode 广播过的 code，防止双重推送导致客户端 exec lock 排队竞态 */
        const checkAndBroadcast = () => {
          const fileCode = bridge.peekPendingJs(sseInstance)
          if (!fileCode) return
          if (lastDispatchedCode[sseInstance] === fileCode) return
          bridge.clearExecResult(sseInstance)
          bridge.clearExecDone(sseInstance)
          lastBrowserActivity[sseInstance] = Date.now()
          broadcastCode(sseInstance, fileCode)
        }

        let cleanup: (() => void) | undefined
        if (!instanceWatchers[sseInstance]) {
          bridge.ensureInstanceDir(sseInstance)
          let watchFailed = false
          let watcher: FSWatcher | undefined
          try {
            watcher = fsWatch(instanceDir, (eventType) => {
              if (eventType !== 'rename' && eventType !== 'change') return
              checkAndBroadcast()
            })
            /** 捕获 fs.watch 底层错误（如 inotify 限额耗尽、不支持的平台） */
            watcher.on('error', () => {
              watchFailed = true
            })
            instanceWatchers[sseInstance] = watcher
          } catch {
            watchFailed = true
          }

          if (watchFailed) {
            /** fs.watch 不可用时 fallback 到 1s 轮询 */
            const pollTimer = setInterval(checkAndBroadcast, 1000)
            cleanup = () => clearInterval(pollTimer)
          }
        }

        req.on('close', () => {
          clearInterval(heartbeat)
          const conns = sseConnections[sseInstance]
          if (conns) {
            const idx = conns.indexOf(res)
            if (idx !== -1) conns.splice(idx, 1)
          }
          if (cleanup) {
            cleanup()
            cleanup = undefined
          } else if (conns && conns.length === 0 && instanceWatchers[sseInstance]) {
            instanceWatchers[sseInstance].close()
            delete instanceWatchers[sseInstance]
          }
        })
        return
      }

      /** ---------- POST /__pilot/result ---------- */
      if (endpoint === PILOT_ENDPOINTS.result && req.method === 'POST') {
        lastBrowserActivity[instanceId] = Date.now()
        /** POST /result 时同步更新 title（SPA 场景下 title 可能动态变化） */
        const clientTitle = decodeURIComponent((req.headers['x-pilot-title'] as string) || '')
        if (clientTitle) {
          bridge.updateInstanceTitle(instanceId, clientTitle)
        }
        handlePost<ExecResult>(req, res, (result) => {
          /** 分离 snapshot，生成 compact 文本后附加到 result 中 */
          const clientSnapshot = result.snapshot
          delete result.snapshot
          /** 检查 snapshot 是否包含可见元素（页面未加载完成时 els 为空） */
          const snapshotEls = clientSnapshot
            ? (clientSnapshot as Record<string, unknown>).visibleElements ?? (clientSnapshot as Record<string, unknown>).els
            : null
          const hasVisibleEls = Array.isArray(snapshotEls) && snapshotEls.length > 0
          /** file-driven exec 核心：每次 exec 后自动写入 compact-snapshot.txt，
           *  并在 exec-result.json 中包含 snapshotText，agent 一次 cat 即可获取结果 + 页面状态 */
          if (hasVisibleEls) {
            const { fullText } = getCompactText(clientSnapshot as unknown as Record<string, unknown>)
            bridge.writeCompactSnapshot(fullText, instanceId)
            result.snapshotText = fullText
          }
          /** 将 exec 期间产生的控制台日志写入 recent-logs.txt，供 AI 用 cat + grep 搜索 */
          if (result.logs && result.logs.length > 0) {
            bridge.writeRecentLogs(result.logs, instanceId)
          }
          /** 截断 code 字段（agent 已知道自己写了什么），节省 token */
          if (typeof result.code === 'string' && result.code.length > 120) {
            result.code = result.code.slice(0, 120) + '...'
          }
          bridge.writeExecResult(result, instanceId)
          bridge.writeResultTxt(result, instanceId)
          bridge.writeExecDone(instanceId)
          /** exec 完成后清除已广播标记，允许后续相同 code 的请求被正常推送 */
          delete lastDispatchedCode[instanceId]
          /** 通知队首等待者 */
          notifyWaiter(instanceId, result, clientSnapshot)
          return { success: true }
        })
        return
      }

      /** ---------- GET /__pilot/result ---------- */
      if (endpoint === PILOT_ENDPOINTS.result && req.method === 'GET') {
        const result = bridge.readExecResult(instanceId)
        if (result) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } else {
          res.writeHead(204)
          res.end()
        }
        return
      }

      /** ---------- POST /__pilot/inspect ---------- */
      if (endpoint === PILOT_ENDPOINTS.inspect && req.method === 'POST') {
        handlePost<ElementInfo>(req, res, (info) => {
          bridge.writeSelectedElement(info, instanceId)
          const prompt = generateElementPrompt(info, options.pilotDir.replace(/\/\.pilot$/, ''))
          return { success: true, prompt }
        })
        return
      }

      /** ---------- GET /__pilot/snapshot (Agent 读取) ---------- */
      if (endpoint === PILOT_ENDPOINTS.snapshot && req.method === 'GET') {
        /**
         * ?fresh=1 时通过 exec 通道请求实时采集，超时后降级读 compact-snapshot.txt
         * non-fresh 直接读 compact-snapshot.txt 缓存
         */
        const url = new URL(req.url, 'http://localhost')
        const fresh = url.searchParams.get('fresh') !== null
        const compact = url.searchParams.get('compact') !== null

        if (fresh) {
          const snapshotCode = 'JSON.stringify(window.__pilot_snapshot && window.__pilot_snapshot())'
          dispatchCode(instanceId, snapshotCode)
          enqueueWaiter(instanceId, res, { type: 'snapshot', compact }, 5000, () => {
            respondWithCachedSnapshot(instanceId, res)
          })
        } else {
          respondWithCachedSnapshot(instanceId, res)
        }
        return
      }

      /** ---------- GET /__pilot/logs (Agent 读取最近 exec 的日志) ---------- */
      if (endpoint === PILOT_ENDPOINTS.logs && req.method === 'GET') {
        const logs = bridge.readRecentLogs(instanceId)
        if (logs) {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end(logs)
        } else {
          res.writeHead(204)
          res.end('NO_LOGS')
        }
        return
      }

      /** ---------- GET /__pilot/page (纯文本 compact snapshot)
       *  agent 一次 curl 即可获取当前页面快照
       *  ?fresh=1 实时采集（默认读缓存），?instance=default 指定实例
       *  无浏览器连接时返回 NO_BROWSER，无缓存时返回 NO_SNAPSHOT */
      if (endpoint === '/__pilot/page' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost')
        const fresh = url.searchParams.get('fresh') !== null
        const pageInstance = url.searchParams.get('instance') || instanceId

        if (!lastBrowserActivity[pageInstance] || Date.now() - lastBrowserActivity[pageInstance] > 60_000) {
          res.writeHead(503, { 'Content-Type': 'text/plain' })
          res.end('NO_BROWSER')
          return
        }

        if (fresh) {
          const snapshotCode = 'JSON.stringify(window.__pilot_snapshot && window.__pilot_snapshot())'
          dispatchCode(pageInstance, snapshotCode)
          enqueueWaiter(pageInstance, res, { type: 'page' }, 5000, () => {
            respondWithCachedSnapshot(pageInstance, res)
          })
        } else {
          const text = bridge.readCompactSnapshot(pageInstance)
          if (text) {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end(text)
          } else {
            res.writeHead(504, { 'Content-Type': 'text/plain' })
            res.end('NO_SNAPSHOT')
          }
        }
        return
      }

      /** ---------- GET /__pilot/run (一站式 exec + 等待 + 返回纯文本结果)
       *  agent 一次 curl 即可执行代码并获取结果，无需文件轮询
       *  ?code=xxx — 要执行的 JS 代码（URL 编码）
       *  ?page=1 — 附带更新后的 compact snapshot（用 --- 分隔）
       *  ?logs=1 — 成功时也附带控制台日志
       *  ?instance=default — 目标实例 ID（默认 default）
       *  返回纯文本：成功 → result 值，失败 → ERROR: xxx，超时 → TIMEOUT，无浏览器 → NO_BROWSER */
      if (endpoint === '/__pilot/run' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost')
        const code = url.searchParams.get('code')
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('ERROR: missing code parameter')
          return
        }
        const runInstance = url.searchParams.get('instance') || instanceId
        const withPage = url.searchParams.get('page') !== null
        const withLogs = url.searchParams.get('logs') !== null

        /** 快速失败：从未有浏览器连接或浏览器超过 60s 不活跃时立即返回 */
        const lastSeen = lastBrowserActivity[runInstance]
        if (!lastSeen || Date.now() - lastSeen > 60_000) {
          res.writeHead(503, { 'Content-Type': 'text/plain' })
          res.end('NO_BROWSER')
          return
        }

        bridge.clearExecResult(runInstance)
        bridge.clearExecDone(runInstance)

        /** 通过 SSE 广播给浏览器 */
        dispatchCode(runInstance, code)

        /** 同步等待结果，超时后返回 TIMEOUT */
        enqueueWaiter(runInstance, res, { type: 'run', withPage, withLogs, runCode: code }, 70_000, () => {
          res.writeHead(504, { 'Content-Type': 'text/plain' })
          res.end('TIMEOUT')
        })
        return
      }

      /** ---------- GET /__pilot/bridge.js (Console Bridge 脚本) ----------
       *  返回一段自包含的 JS 代码，用户粘贴到任意浏览器控制台执行
       *  执行后建立 SSE 连接到 dev server，之后 pilot CLI 可操控该页面 */
      if (endpoint === '/__pilot/bridge.js' && req.method === 'GET') {
        /** 使用请求的 Host header 构建 origin（CLI 通过 localhost 访问，自动适配端口） */
        const host = req.headers.host || 'localhost'
        const serverOrigin = `http://${host}`
        const bridgeScript = buildBridgeScript(options, pilotVersion || String(Date.now()), serverOrigin)
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache',
        })
        res.end(bridgeScript)
        return
      }

      /** ---------- GET /__pilot/userscript.js (Tampermonkey Userscript) ----------
       *  返回完整的 Tampermonkey/Greasemonkey 兼容脚本
       *  用户安装后自动在所有页面运行，用 GM_xmlhttpRequest 轮询接收代码 */
      if (endpoint === '/__pilot/userscript.js' && req.method === 'GET') {
        const host = req.headers.host || 'localhost'
        const serverOrigin = `http://${host}`
        const script = buildUserscript(options, pilotVersion || String(Date.now()), serverOrigin)
        res.writeHead(200, {
          'Content-Type': 'text/javascript',
          'Cache-Control': 'no-cache',
        })
        res.end(script)
        return
      }

      /** ---------- GET /__pilot/has-code (Userscript 轮询端点) ----------
       *  返回 pending.js 中的待执行代码（读取并删除，消费语义） */
      if (endpoint === '/__pilot/has-code' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost')
        const hasCodeInstance = url.searchParams.get('instance') || instanceId
        const code = bridge.readPendingJs(hasCodeInstance)
        if (code) {
          bridge.clearExecResult(hasCodeInstance)
          bridge.clearExecDone(hasCodeInstance)
          lastBrowserActivity[hasCodeInstance] = Date.now()
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end(code)
        } else {
          res.writeHead(204)
          res.end()
        }
        return
      }

      /** ---------- GET /__pilot/register (Userscript 实例注册) ----------
       *  userscript 启动时注册实例信息，供 CLI status 查看和实例选择 */
      if (endpoint === '/__pilot/register' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost')
        const registerInstanceId = url.searchParams.get('instance') || instanceId
        const pageUrl = url.searchParams.get('path') || '/'
        const pageTitle = decodeURIComponent(url.searchParams.get('title') || '')
        bridge.writeActiveInstance(registerInstanceId, pageUrl, 'userscript', pageTitle)
        lastBrowserActivity[registerInstanceId] = Date.now()
        lastBrowserActivity[instanceId] = Date.now()
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        return
      }

      /** ---------- GET /__pilot/result-img (Image GET 发送结果，绕过 CORS/POST 限制) ---------- */
      if (endpoint === '/__pilot/result-img' && req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost')
        const imgInstance = url.searchParams.get('instance') || instanceId
        const data = url.searchParams.get('d')
        lastBrowserActivity[imgInstance] = Date.now()
        if (data) {
          try {
            const result = JSON.parse(decodeURIComponent(escape(atob(data)))) as ExecResult
            /** 复用 POST /result 的结果处理逻辑 */
            const clientSnapshot = result.snapshot
            delete result.snapshot
            const snapshotEls = clientSnapshot
              ? (clientSnapshot as Record<string, unknown>).visibleElements ?? (clientSnapshot as Record<string, unknown>).els
              : null
            const hasVisibleEls = Array.isArray(snapshotEls) && snapshotEls.length > 0
            if (hasVisibleEls) {
              const { fullText } = getCompactText(clientSnapshot as unknown as Record<string, unknown>)
              bridge.writeCompactSnapshot(fullText, imgInstance)
              result.snapshotText = fullText
            }
            if (result.logs && result.logs.length > 0) {
              bridge.writeRecentLogs(result.logs, imgInstance)
            }
            if (typeof result.code === 'string' && result.code.length > 120) {
              result.code = result.code.slice(0, 120) + '...'
            }
            bridge.writeExecResult(result, imgInstance)
            bridge.writeResultTxt(result, imgInstance)
            bridge.writeExecDone(imgInstance)
            /** 通知队首等待者 */
            notifyWaiter(imgInstance, result, clientSnapshot)
          } catch { /* ignore malformed data */ }
        }
        /** 返回 1x1 透明 GIF（Image 加载成功） */
        const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
        res.end(gif)
        return
      }

      /** ---------- GET /__pilot/status (连接状态诊断) ---------- */
      if (endpoint === '/__pilot/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          pendingCode: (execWaiters[instanceId]?.length ?? 0) > 0,
          snapshot: !!bridge.readCompactSnapshot(instanceId),
          lastActivity: lastBrowserActivity[instanceId],
          serverUptime: Date.now() - serverStartedAt,
          instances: bridge.listInstances(),
          activeInstance: bridge.readActiveInstance(),
        }))
        return
      }

      next()
    },
  }

  /**
   * 通用等待函数：注册到 execWaiters 队列，超时后自动清理并发送响应
   * 所有 waitFor* 函数的统一实现，通过 opts 控制超时行为和响应格式
   */
  function enqueueWaiter(
    instanceId: string,
    res: ServerResponse,
    opts: WaiterOptions,
    timeout: number,
    onTimeout: () => void,
  ): void {
    if (!execWaiters[instanceId]) execWaiters[instanceId] = []

    const timer = setTimeout(() => {
      const idx = execWaiters[instanceId].findIndex(w => w.res === res)
      if (idx !== -1) execWaiters[instanceId].splice(idx, 1)
      onTimeout()
    }, timeout)

    execWaiters[instanceId].push({ res, timer })
    waiterOptions.set(res, opts)
  }

  /**
   * 降级：读取 compact-snapshot.txt 缓存
   */
  function respondWithCachedSnapshot(instanceId: string, res: ServerResponse): void {
    const cached = bridge.readCompactSnapshot(instanceId)
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(cached)
    } else {
      res.writeHead(504, { 'Content-Type': 'text/plain' })
      res.end('NO_SNAPSHOT')
    }
  }

  /** 通知队首等待者执行完成（POST /result 和 GET /result-img 共用）
   *  根据 waiter 选项决定响应格式：纯文本（run）、JSON（default/snapshot）或 compact（page） */
  function notifyWaiter(
    targetId: string,
    result: ExecResult,
    snapshot: unknown,
  ): void {
    const waiters = execWaiters[targetId]
    if (!waiters || waiters.length === 0) return
    const waiter = waiters.shift()!
    clearTimeout(waiter.timer)
    const wRes = waiter.res
    const wOpts = waiterOptions.get(wRes)

    if (wOpts?.withSnapshot && result) {
      /** POST /exec?wait=1&snapshot=1：返回 JSON 结果附带 snapshot */
      const response = { ...result, snapshot: snapshot ?? undefined }
      wRes.writeHead(200, { 'Content-Type': 'application/json' })
      wRes.end(JSON.stringify(response))
    } else if (wOpts?.type === 'run') {
      wRes.writeHead(200, { 'Content-Type': 'text/plain' })
      wRes.end(formatRunResult(result, wOpts))
    } else if (wOpts?.type === 'page') {
      /** GET /__pilot/page?fresh=1 请求：返回纯文本 compact snapshot */
      if (result?.success && typeof result.result === 'string') {
        try {
          const data = JSON.parse(typeof JSON.parse(result.result) === 'string' ? JSON.parse(result.result) : result.result)
          const rawEls = data.els ?? data.visibleElements
          if (Array.isArray(rawEls) && rawEls.length > 0) {
            const { fullText } = getCompactText(data)
            bridge.writeCompactSnapshot(fullText, targetId)
            wRes.writeHead(200, { 'Content-Type': 'text/plain' })
            wRes.end(fullText)
          }
        } catch {
          wRes.writeHead(200, { 'Content-Type': 'text/plain' })
          wRes.end(result.result)
        }
      } else {
        const cached = bridge.readCompactSnapshot(targetId)
        wRes.writeHead(200, { 'Content-Type': 'text/plain' })
        wRes.end(cached || 'NO_SNAPSHOT')
      }
    } else if (wOpts?.type === 'snapshot' && result?.success && typeof result.result === 'string') {
      /** GET /snapshot?fresh=1 请求：解包双层序列化的 snapshot */
      try {
        const inner = JSON.parse(result.result)
        const data = typeof inner === 'string' ? JSON.parse(inner) : inner
        if (wOpts.compact) {
          const { meta, text, fullText } = getCompactText(data)
          bridge.writeCompactSnapshot(fullText, targetId)
          wRes.writeHead(200, { 'Content-Type': 'application/json' })
          wRes.end(JSON.stringify({ ...meta, text }))
        } else {
          wRes.writeHead(200, { 'Content-Type': 'application/json' })
          wRes.end(JSON.stringify(data))
        }
      } catch {
        wRes.writeHead(200, { 'Content-Type': 'application/json' })
        wRes.end(result.result)
      }
    } else if (result) {
      /** 非 snapshot 模式：移除客户端附带的 snapshot，避免不必要的数据传输 */
      delete result.snapshot
      wRes.writeHead(200, { 'Content-Type': 'application/json' })
      wRes.end(JSON.stringify(result))
    } else {
      wRes.writeHead(504, { 'Content-Type': 'application/json' })
      wRes.end(JSON.stringify({ error: 'Execution timeout', success: false }))
    }
  }
}

/**
 * 解析 exec 请求的代码
 * 支持 JSON string（"1+1"）和纯文本（1+1）
 */
function parseExecCode(raw: string): string | null {
  if (!raw.trim()) return null
  /** 尝试 JSON 解析（可能包裹在引号中） */
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed.trim()
    return null
  } catch {
    /** 非 JSON，当作纯文本代码 */
    return raw.trim()
  }
}

/**
 * 通用 POST 请求处理（JSON body）
 */
function handlePost<T>(req: IncomingMessage, res: ServerResponse, handler: (body: T) => unknown) {
  let body = ''
  req.on('data', (chunk: Buffer) => { body += chunk.toString() })
  req.on('end', () => {
    let parsed: T
    try {
      parsed = JSON.parse(body) as T
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }
    const result = handler(parsed)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  })
}
