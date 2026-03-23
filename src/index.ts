import type { Plugin } from 'vite'
import { resolve, join } from 'path'
import { writeFileSync } from 'fs'
import type { PilotOptions, ResolvedPilotOptions } from './types'
import { DEFAULT_OPTIONS, PILOT_FILES } from './constants'
import { createMiddleware } from './server/middleware'
import { createSourceLocator } from './server/source-locator'
import { buildInjectScript } from './client/inject'
import { buildBridgeScript } from './server/bridge'

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
      locale: userOptions.locale ?? DEFAULT_OPTIONS.locale,
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

    configResolved(config) {
      resolvedOptions = resolveOptions()
      injectScript = buildInjectScript(resolvedOptions)
      /** Console Bridge 需要跨域访问 dev server，自动开启 CORS */
      if (config.server.cors !== true) {
        config.server.cors = true
      }
    },

    configureServer(server) {
      if (!resolvedOptions) {
        resolvedOptions = resolveOptions()
      }

      /** 生成统一版本 ID，注入脚本和文件用同一个值 */
      const pilotVersion = String(Date.now())
      injectScript = buildInjectScript(resolvedOptions, pilotVersion)

      const { handler, bridge } = createMiddleware(resolvedOptions, pilotVersion)

      /** 直接注册 middleware（在 configureServer 阶段，早于 Vite 内部中间件） */
      server.middlewares.use(handler)

      /** 端口绑定后将实际端口号写入 .pilot/port.txt，并自动生成 bridge.js */
      if (server.httpServer) {
        server.httpServer.on('listening', () => {
          const addr = server.httpServer!.address()
          if (addr && typeof addr === 'object') {
            bridge.writePort(addr.port)
            /** 自动生成 bridge.js 到 .pilot/ 目录，方便用户在 IDE 中直接打开复制
             *  使用 localhost 作为 origin（本机浏览器控制台执行，localhost 最通用） */
            const origin = `http://localhost:${addr.port}`
            const script = buildBridgeScript(resolvedOptions, pilotVersion, origin)
            writeFileSync(join(resolvedOptions.pilotDir, 'bridge.js'), script, 'utf-8')
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
