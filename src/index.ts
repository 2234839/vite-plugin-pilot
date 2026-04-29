import type { Plugin } from 'vite'
import { resolve, join } from 'path'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import type { PilotOptions, ResolvedPilotOptions } from './types'
import { DEFAULT_OPTIONS, PILOT_FILES } from './constants'
import { createMiddleware } from './server/middleware'
import { createSourceLocator } from './server/source-locator'
import { buildInjectScript } from './client/inject'
import { buildBridgeScript } from './server/bridge'
import { buildUserscript } from './server/userscript'

/** 导出供独立 server 和 bin 使用 */
export { createMiddleware } from './server/middleware'
export { buildInjectScript } from './client/inject'
export { buildBridgeScript } from './server/bridge'
export { buildUserscript } from './server/userscript'
export { DEFAULT_OPTIONS, PILOT_FILES } from './constants'
export type { PilotOptions, ResolvedPilotOptions } from './types'
export type { InstanceInfo, InstanceType } from './server/file-bridge'

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

      inspector: userOptions.inspector ?? DEFAULT_OPTIONS.inspector,
      highlight: userOptions.highlight ?? DEFAULT_OPTIONS.highlight,
      locale: userOptions.locale ?? DEFAULT_OPTIONS.locale,
      checkUpdate: userOptions.checkUpdate ?? DEFAULT_OPTIONS.checkUpdate,
      pilotDir: resolve(cwd, PILOT_FILES.dir),
    }
  }

  /** 注入脚本文件路径（每次 transformIndexHtml 从文件读取，确保 build 后 reload 加载最新代码） */
  let injectBundlePath = ''

  return {
    name: 'vite-plugin-pilot',
    /** 仅在开发环境激活，生产构建不参与 */
    apply: 'serve',
    /** 在 @vitejs/plugin-vue 之前执行 transform，确保拿到原始 SFC 源码 */
    enforce: 'pre',

    configResolved(config) {
      resolvedOptions = resolveOptions()
      /** Console Bridge 需要跨域访问 dev server，自动开启 CORS */
      if (config.server.cors !== true) {
        config.server.cors = true
      }
    },

    configureServer(server) {
      if (!resolvedOptions) {
        resolvedOptions = resolveOptions()
      }

      /** 写入插件配置供 CLI 读取（checkUpdate 等） */
      if (!existsSync(resolvedOptions.pilotDir)) {
        mkdirSync(resolvedOptions.pilotDir, { recursive: true })
      }
      writeFileSync(
        join(resolvedOptions.pilotDir, 'pilot-config.json'),
        JSON.stringify({ checkUpdate: resolvedOptions.checkUpdate }),
        'utf-8',
      )

      /** 生成统一版本 ID，注入脚本和文件用同一个值 */
      const pilotVersion = String(Date.now())
      const script = buildInjectScript(resolvedOptions, pilotVersion)

      /** 注入脚本文件路径（transformIndexHtml 每次从此文件读取）
       *  仅在文件不存在时写入（首次启动），后续由 pnpm build 的脚本更新 */
      injectBundlePath = join(resolvedOptions.pilotDir, 'inject-bundle.txt')
      if (!existsSync(injectBundlePath)) {
        writeFileSync(injectBundlePath, script, 'utf-8')
      }

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
            const bridgeScript = buildBridgeScript(resolvedOptions, pilotVersion, origin)
            writeFileSync(join(resolvedOptions.pilotDir, 'bridge.js'), bridgeScript, 'utf-8')
            /** 自动生成 userscript.js 到 .pilot/ 目录，方便用户安装到 Tampermonkey */
            const userscript = buildUserscript(resolvedOptions, pilotVersion, origin)
            writeFileSync(join(resolvedOptions.pilotDir, 'userscript.user.js'), userscript, 'utf-8')
          }
        })
      }
    },

    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        /** playground 内的 demo 展示页面不需要注入 pilot 客户端 */
        const isPlaygroundDemo = ctx.filename?.includes('/playground/demo/') ||
          ctx.filename?.includes('\\playground\\demo\\')
        if (isPlaygroundDemo) return html
        /** 每次从文件读取注入脚本，确保 build 后浏览器 reload 加载最新代码 */
        if (injectBundlePath && existsSync(injectBundlePath)) {
          const script = readFileSync(injectBundlePath, 'utf-8')
          return html.replace('</body>', script + '</body>')
        }
        return html
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
