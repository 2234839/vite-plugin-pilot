import type { IncomingMessage, ServerResponse } from 'http'
import { watch as fsWatch, type FSWatcher } from 'fs'
import type { ResolvedPilotOptions, ExecResult, ElementInfo } from '../types'
import { PILOT_ENDPOINTS } from '../constants'
import { FileBridge } from './file-bridge'
import { generateElementPrompt } from '../prompt/generator'
import { getCompactText } from './compact'

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

  /** 向指定实例的所有 SSE 连接发送 reload 指令 */
  function broadcastReload(instanceId: string): void {
    const connections = sseConnections[instanceId]
    if (!connections || connections.length === 0) return
    for (const res of connections) {
      res.write(`event: reload\ndata: 1\n\n`)
    }
  }

  /** 通过 SSE 广播代码给浏览器（清除旧结果，更新活跃时间） */
  function dispatchCode(instanceId: string, code: string): void {
    bridge.clearExecResult(instanceId)
    bridge.clearExecDone(instanceId)
    lastBrowserActivity[instanceId] = Date.now()
    broadcastCode(instanceId, code)
  }

  /** HTTP API 代码分发队列（POST /exec、GET /run 推送的代码暂存于此） */
  const pendingCodeQueues: Record<string, string[]> = {}

  /** 每个实例最后的浏览器活动时间戳 */
  const lastBrowserActivity: Record<string, number> = {}

  /** exec 结果的等待者队列（按实例隔离） */
  const execWaiters: Record<string, Array<{ res: ServerResponse; timer: NodeJS.Timeout }>> = {}

  /** 等待者选项映射（类型安全，替代 (res as any).__pilot_xxx） */
  const waiterOptions = new WeakMap<ServerResponse, WaiterOptions>()

  /** 从请求中提取实例 ID（优先用 X-Pilot-Instance header，fallback 用 default） */
  function getInstanceId(req: IncomingMessage): string {
    return (req.headers['x-pilot-instance'] as string) || FileBridge.toInstanceId('/')
  }

  return {
    bridge,

    /** connect 风格的中间件处理函数 */
    handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
      if (!req.url?.startsWith('/__pilot/')) {
        next()
        return
      }

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

          if (!pendingCodeQueues[instanceId]) pendingCodeQueues[instanceId] = []
          pendingCodeQueues[instanceId].push(code)

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
            waitForResult(instanceId, res, withSnapshot, compactSnapshot)
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

        lastBrowserActivity[sseInstance] = Date.now()

        /** 注册实例信息 */
        const referer = req.headers.referer
        if (referer) {
          try {
            const urlObj = new URL(referer)
            bridge.writeActiveInstance(sseInstance, urlObj.pathname)
          } catch { /* ignore */ }
        }

        /** 版本不匹配时立即返回 reload 指令然后关闭连接 */
        if (clientVersion && pilotVersion && clientVersion !== pilotVersion) {
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
          /** 通知队首等待者（FIFO 匹配 pendingCodeQueue） */
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
              /** GET /__pilot/run 请求：返回纯文本结果
               *  成功：只返回结果（?page=1 附带 snapshot，?logs=1 附带日志）
               *  失败：附带控制台日志，帮助 agent 调试 */
              let output: string
              if (!result) {
                output = 'TIMEOUT'
              } else if (result.success) {
                /** 过滤 undefined 返回值（链式操作最后一个 __pilot_wait 的返回值），减少 CLI 噪音 */
                const raw = result.result != null ? String(result.result) : ''
                output = raw === 'undefined' ? '' : raw
                if (wOpts.withPage && result.snapshotText) {
                  output += '\n---\n' + result.snapshotText
                }
                if (wOpts.withLogs && result.logs && result.logs.length > 0) {
                  output += '\n---\n' + result.logs.join('\n')
                }
              } else {
                output = `ERROR: ${result.error || 'unknown'}`
                /** 失败时也附带日志和 snapshot（?page=1 ?logs=1），帮助 agent 一次 tool call 完成调试 */
                if (wOpts.withLogs && result.logs && result.logs.length > 0) {
                  output += '\n---\n' + result.logs.join('\n')
                }
                if (wOpts.withPage && result.snapshotText) {
                  output += '\n---\n' + result.snapshotText
                }
              }
              wRes.writeHead(200, { 'Content-Type': 'text/plain' })
              wRes.end(output)
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
         * 直接读取文件缓存（客户端每 5s 自动上报）
         * ?fresh=1 时通过 exec 通道请求实时采集，超时后降级读文件
         * ?compact=1 时过滤只保留交互元素和 section 标题，节省 ~40% token
         */
        const url = new URL(req.url, 'http://localhost')
        const fresh = url.searchParams.get('fresh') !== null
        const compact = url.searchParams.get('compact') !== null

        if (fresh) {
          const snapshotCode = 'JSON.stringify(window.__pilot_snapshot && window.__pilot_snapshot())'
          if (!pendingCodeQueues[instanceId]) pendingCodeQueues[instanceId] = []
          pendingCodeQueues[instanceId].push(snapshotCode)
          waitForExecSnapshot(instanceId, res, compact)
        } else {
          respondWithCachedSnapshot(instanceId, res, compact)
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
          if (!pendingCodeQueues[pageInstance]) pendingCodeQueues[pageInstance] = []
          pendingCodeQueues[pageInstance].push(snapshotCode)
          waitForPageResult(pageInstance, res)
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

        if (!pendingCodeQueues[runInstance]) pendingCodeQueues[runInstance] = []
        pendingCodeQueues[runInstance].push(code)

        /** 通过 SSE 广播给浏览器 */
        dispatchCode(runInstance, code)

        /** 同步等待结果，超时后返回 TIMEOUT */
        waitForRunResult(runInstance, res, withPage, withLogs)
        return
      }

      /** ---------- GET /__pilot/status (连接状态诊断) ---------- */
      if (endpoint === '/__pilot/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          pendingCode: (pendingCodeQueues[instanceId]?.length ?? 0) > 0,
          snapshot: !!bridge.readSnapshot(instanceId),
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
   * 同步等待执行结果
   * 超时后返回 504，AI 可根据错误信息决定下一步
   */
  function waitForResult(instanceId: string, res: ServerResponse, withSnapshot?: boolean, compact?: boolean): void {
    /** 服务端等待超时 70s，覆盖浏览器后台 tab 轮询限流（~60s） */
    const timeout = 70_000

    if (!execWaiters[instanceId]) execWaiters[instanceId] = []

    const timer = setTimeout(() => {
      /** 超时：从队列中移除该等待者并返回 504 */
      const idx = execWaiters[instanceId].findIndex(w => w.res === res)
      if (idx !== -1) execWaiters[instanceId].splice(idx, 1)
      res.writeHead(504, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Execution timeout', success: false }))
    }, timeout)

    execWaiters[instanceId].push({ res, timer })
    waiterOptions.set(res, { type: 'default', withSnapshot, compact })
  }

  /**
   * 同步等待执行结果（纯文本模式，供 GET /__pilot/run 使用）
   * 成功返回 result 值，失败返回 ERROR: xxx，超时返回 TIMEOUT
   * withPage=true 时附带 compact snapshot（用 --- 分隔）
   * withLogs=true 时成功也附带控制台日志
   */
  function waitForRunResult(instanceId: string, res: ServerResponse, withPage?: boolean, withLogs?: boolean): void {
    const timeout = 70_000

    if (!execWaiters[instanceId]) execWaiters[instanceId] = []

    const timer = setTimeout(() => {
      const idx = execWaiters[instanceId].findIndex(w => w.res === res)
      if (idx !== -1) execWaiters[instanceId].splice(idx, 1)
      res.writeHead(504, { 'Content-Type': 'text/plain' })
      res.end('TIMEOUT')
    }, timeout)

    /** 标记为 run 模式，POST /result handler 会返回纯文本 */
    execWaiters[instanceId].push({ res, timer })
    waiterOptions.set(res, { type: 'run', withPage, withLogs })
  }

  /**
   * 等待 fresh snapshot 结果（纯文本模式，供 GET /__pilot/page?fresh=1 使用）
   * 超时后降级读文件缓存
   */
  function waitForPageResult(instanceId: string, res: ServerResponse): void {
    const timeout = 5000
    let resolved = false

    if (!execWaiters[instanceId]) execWaiters[instanceId] = []

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        const idx = execWaiters[instanceId].findIndex(w => w.res === res)
        if (idx !== -1) execWaiters[instanceId].splice(idx, 1)
        const text = bridge.readCompactSnapshot(instanceId)
        if (text) {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end(text)
        } else {
          res.writeHead(504, { 'Content-Type': 'text/plain' })
          res.end('NO_SNAPSHOT')
        }
      }
    }, timeout)

    execWaiters[instanceId].push({ res, timer })
    waiterOptions.set(res, { type: 'page' })
  }

  /**
   * 通过 exec 轮询通道等待快照结果
   * 客户端执行 JSON.stringify(window.__pilot_snapshot()) 后结果通过 POST /result 回传
   */
  function waitForExecSnapshot(instanceId: string, res: ServerResponse, compact?: boolean): void {
    const timeout = 5000
    let resolved = false

    if (!execWaiters[instanceId]) execWaiters[instanceId] = []

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        const idx = execWaiters[instanceId].findIndex(w => w.res === res)
        if (idx !== -1) execWaiters[instanceId].splice(idx, 1)
        respondWithCachedSnapshot(instanceId, res, compact)
      }
    }, timeout)

    /** 注册到等待者队列，result POST 时会按 FIFO 通知 */
    execWaiters[instanceId].push({ res, timer })
    waiterOptions.set(res, { type: 'snapshot', compact })
  }

  /**
   * 降级：读取文件缓存的快照
   */
  function respondWithCachedSnapshot(instanceId: string, res: ServerResponse, compact?: boolean) {
    const cached = bridge.readSnapshot(instanceId)
    if (cached) {
      if (compact) {
        const { meta, text, fullText } = getCompactText(cached as unknown as Record<string, unknown>)
        bridge.writeCompactSnapshot(fullText, instanceId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ...meta, text }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(cached))
      }
    } else {
      res.writeHead(504, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Snapshot timeout. Ensure browser page is open.' }))
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
