import type { Plugin } from 'vite'
import { resolve } from 'path'
import type { PilotOptions, ResolvedPilotOptions } from './types'
import { DEFAULT_OPTIONS, PILOT_FILES } from './constants'
import { createMiddleware } from './server/middleware'
import { createSourceLocator } from './server/source-locator'
import { buildInjectScript } from './client/inject'

/**
 * Vite Plugin Pilot — AI Agent 驾驶浏览器的导航工具
 *
 * 打通 浏览器运行时 → Dev Server → 源码 → IDE 的完整链路
 */
export function pilot(userOptions: PilotOptions = {}): Plugin {
  /** .pilot 目录始终基于 process.cwd()（用户运行命令的位置） */
  const cwd = process.cwd()
  let resolvedOptions: ResolvedPilotOptions

  function resolveOptions(): ResolvedPilotOptions {
    return {
      logLevels: userOptions.logLevels ? [...userOptions.logLevels] : [...DEFAULT_OPTIONS.logLevels],
      maxBufferSize: userOptions.maxBufferSize ?? DEFAULT_OPTIONS.maxBufferSize,
      flushInterval: userOptions.flushInterval ?? DEFAULT_OPTIONS.flushInterval,
      execTimeout: userOptions.execTimeout ?? DEFAULT_OPTIONS.execTimeout,
      maxResultSize: userOptions.maxResultSize ?? DEFAULT_OPTIONS.maxResultSize,
      inspector: userOptions.inspector ?? DEFAULT_OPTIONS.inspector,
      pilotDir: resolve(cwd, PILOT_FILES.dir),
    }
  }

  let injectScript = ''

  return {
    name: 'vite-plugin-pilot',
    /** 仅在开发环境激活，生产构建不参与 */
    apply: 'serve',
    /** 在 @vitejs/plugin-vue 之前执行 transform，确保拿到原始 SFC 源码 */
    enforce: 'pre',

    configResolved() {
      resolvedOptions = resolveOptions()
      injectScript = buildInjectScript(resolvedOptions)
    },

    configureServer(server) {
      if (!resolvedOptions) {
        resolvedOptions = resolveOptions()
      }

      /** 生成统一版本 ID，注入脚本和文件用同一个值 */
      const pilotVersion = String(Date.now())
      injectScript = buildInjectScript(resolvedOptions, pilotVersion)

      const { handler, bridge } = createMiddleware(resolvedOptions, pilotVersion)

      /** 直接注册，在 Vite 内部中间件之前处理 /__pilot/* 请求 */
      server.middlewares.use(handler)

      /** 端口绑定后将实际端口号写入 .pilot/port.txt，供 agent 探测 */
      if (server.httpServer) {
        server.httpServer.on('listening', () => {
          const addr = server.httpServer!.address()
          if (addr && typeof addr === 'object') {
            bridge.writePort(addr.port)
          }
        })
      }
    },

    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('</body>', injectScript + '</body>')
      },
    },

    /** 使用 AST 处理 .vue 文件，正则处理 .html 文件 */
    async transform(code, id) {
      if (!resolvedOptions) return null
      if (!id.endsWith('.vue') && !id.endsWith('.html')) return null

      const { transform } = createSourceLocator(cwd, resolvedOptions)
      return transform(code, id)
    },
  }
}
