import type { IncomingMessage, ServerResponse } from 'http'
import { watch as fsWatch, type FSWatcher } from 'fs'
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

  /** SSE 连接池（按实例隔离） */
  const sseConnections: Record<string, Array<ServerResponse>> = {}

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

  /** 通过 SSE 广播代码给浏览器（同时写 pending.js 供轮询 fallback 使用） */
  function dispatchCode(instanceId: string, code: string): void {
    bridge.clearExecResult(instanceId)
    bridge.clearExecDone(instanceId)
    lastBrowserActivity[instanceId] = Date.now()
    bridge.writePendingJs(code, instanceId)
    broadcastCode(instanceId, code)
  }

  /** 格式化 run 请求的返回值（POST /result 和 GET /result-img 共用） */
  function formatRunResult(result: ExecResult | null | undefined, opts: WaiterOptions): string {
    if (!result) return 'TIMEOUT'

    const codePreview = typeof result.code === 'string' ? result.code.slice(0, 20).replace(/\n/g, ' ') : ''
    const lines: string[] = []
    lines.push(`--- runcode --- ${codePreview}`)

    if (result.success) {
      const raw = result.result != null ? String(result.result) : ''
      if (raw !== 'undefined') lines.push(raw)
    } else {
      lines.push(`ERROR: ${result.error || 'unknown'}`)
    }

    if (result.logs && result.logs.length > 0) {
      lines.push('--- logs ---')
      lines.push(...result.logs)
    }

    if (opts.withPage && result.snapshotText) {
      lines.push('--- page snapshot ---')
      lines.push(result.snapshotText)
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
        const clientVersion = url.searchParams.get('version')
        const pageTitle = url.searchParams.get('title') || ''

        lastBrowserActivity[sseInstance] = Date.now()

        /** 注册实例信息（跨域时 referer 丢失，优先用 query params 中的 path） */
        const queryPath = url.searchParams.get('path') || ''
        const referer = queryPath || req.headers.referer || '/'
        const clientType = (url.searchParams.get('type') as InstanceType) || 'vite'
        bridge.writeActiveInstance(sseInstance, referer, clientType, pageTitle)

        /** 版本不匹配时立即返回 reload 指令然后关闭连接
         *  Console Bridge / Userscript 实例跳过版本检查（无法 reload，会丢失注入代码） */
        if (clientVersion && pilotVersion && clientVersion !== pilotVersion && clientType === 'vite') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.write('event: reload\ndata: 1\n\n')
          res.end()
          return
        }

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
        /** 检查并推送 pending.js 代码的公共逻辑 */
        const checkAndBroadcast = () => {
          const fileCode = bridge.readPendingJs(sseInstance)
          if (!fileCode) return
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
        const clientTitle = (req.headers['x-pilot-title'] as string) || ''
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
          /** 通知队首等待者 */
          const waiters = execWaiters[instanceId]
          if (waiters && waiters.length > 0) {
            const waiter = waiters.shift()!
            clearTimeout(waiter.timer)
            const wRes = waiter.res
            const wOpts = waiterOptions.get(wRes)

            if (wOpts?.withSnapshot && result) {
              /** POST /exec?wait=1&snapshot=1：返回 JSON 结果附带 snapshot */
              const response = { ...result, snapshot: clientSnapshot ?? undefined }
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
                    bridge.writeCompactSnapshot(fullText, instanceId)
                    wRes.writeHead(200, { 'Content-Type': 'text/plain' })
                    wRes.end(fullText)
                  }
                } catch {
                  wRes.writeHead(200, { 'Content-Type': 'text/plain' })
                  wRes.end(result.result)
                }
              } else {
                const cached = bridge.readCompactSnapshot(instanceId)
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
                  bridge.writeCompactSnapshot(fullText, instanceId)
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

        if (!lastBrowserActivity[pageInstance]) {
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

        /** 快速失败：从未有浏览器连接时立即返回 */
        if (!lastBrowserActivity[runInstance]) {
          res.writeHead(503, { 'Content-Type': 'text/plain' })
          res.end('NO_BROWSER')
          return
        }

        bridge.clearExecResult(runInstance)
        bridge.clearExecDone(runInstance)

        /** 通过 SSE 广播给浏览器 */
        dispatchCode(runInstance, code)

        /** 同步等待结果，超时后返回 TIMEOUT */
        enqueueWaiter(runInstance, res, { type: 'run', withPage, withLogs }, 70_000, () => {
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
        const pageTitle = url.searchParams.get('title') || ''
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
            const waiters = execWaiters[imgInstance]
            if (waiters && waiters.length > 0) {
              const waiter = waiters.shift()!
              clearTimeout(waiter.timer)
              const wRes = waiter.res
              const wOpts = waiterOptions.get(wRes)
              if (wOpts?.type === 'run') {
                wRes.writeHead(200, { 'Content-Type': 'text/plain' })
                wRes.end(formatRunResult(result, wOpts))
              } else if (result) {
                wRes.writeHead(200, { 'Content-Type': 'application/json' })
                wRes.end(JSON.stringify(result))
              }
            }
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
