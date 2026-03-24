import type { ResolvedPilotOptions } from '../types'
import { logCollectorCode } from '../client/log-collector'
import { wsClientCode } from '../client/ws-client'
import { snapshotCode } from '../client/snapshot'

/**
 * 生成 Console Bridge 脚本
 * 用户将这段 JS 粘贴到任意浏览器控制台执行，即可建立 SSE 连接到 dev server
 * 之后 pilot CLI 的 run/page/logs 命令就能操控该页面
 *
 * 与 inject.ts 的区别：
 * - 不依赖 Vite HMR，独立运行
 * - 使用 type 字段标识运行环境，与 Vite 注入的 tab 区分
 * - 包含完整的 log-collector + snapshot + ws-client 逻辑
 * - 注入 __PILOT_SERVER_ORIGIN__ 使 SSE/fetch 指向 dev server（跨域场景必需）
 */
export function buildBridgeScript(options: ResolvedPilotOptions, pilotVersion: string, serverOrigin: string): string {
  const modules = [
    { name: 'Log Collector', code: logCollectorCode },
    { name: 'SSE Client', code: wsClientCode },
    { name: 'Page Snapshot', code: snapshotCode },
  ]

  /** 替换占位符（与 inject.ts 相同的占位符） */
  const body = modules
    .map(({ name, code }) => {
      const resolved = code
        .replace(/__MAX_BUFFER_SIZE__/g, String(options.maxBufferSize))
        .replace(/__FLUSH_INTERVAL__/g, String(options.flushInterval))
        .replace(/__EXEC_TIMEOUT__/g, String(options.execTimeout))
        .replace(/__MAX_RESULT_SIZE__/g, String(options.maxResultSize))
        .replace(/__PILOT_VERSION__/g, pilotVersion)
        .replace(/__LOCALE_SELECTED__/g, '')
        .replace(/__LOCALE_TEXT__/g, '')
        .replace(/__LOCALE_EMPTY__/g, '')
        .replace(/__LOCALE_PLACEHOLDER__/g, '')
        .replace(/__LOCALE_SEND_TO_CLAUDE__/g, '')
        .replace(/__LOCALE_COPY_PROMPT__/g, '')
        .replace(/__LOCALE_CLOSE__/g, '')
        .replace(/__LOCALE_CLOSE_IN__/g, '')
        .replace(/__LOCALE_COPIED__/g, '')
        .replace(/__LOCALE_SENDING__/g, '')
        .replace(/__LOCALE_SENT__/g, '')
        .replace(/__LOCALE_SEND_FAILED__/g, '')
        .replace(/__LOCALE_NOT_CONNECTED__/g, '')
        .replace(/__LOCALE_ELEMENT_INFO__/g, '')
        .replace(/__LOCALE_TAG__/g, '')
        .replace(/__LOCALE_COMPONENT__/g, '')
        .replace(/__LOCALE_SOURCE__/g, '')
        .replace(/__LOCALE_DOM_PATH__/g, '')
        .replace(/__LOCALE_POSITION__/g, '')
        .replace(/__LOCALE_TEXT_CONTENT__/g, '')
        .replace(/__LOCALE_STYLE__/g, '')
        .replace(/__PILOT_INSTANCE_TYPE__/g, "'console'")
      return `  /* === ${name} === */\n  ${resolved.trim()}`
    })
    .join('\n\n')

  return `// [Pilot] Console Bridge — 粘贴到浏览器控制台执行，连接到 dev server
// 连接后即可使用 pilot CLI 操控此页面: npx pilot run/page/logs
(function() {
  if (window.__pilot_bridge_active) {
    console.log('[Pilot] Bridge already active (instance: ' + window.__pilot_instanceId + ')');
    return;
  }
  window.__pilot_bridge_active = true;

  /** dev server 地址（SSE/fetch 使用绝对 URL，支持跨域连接） */
  window.__PILOT_SERVER_ORIGIN__ = "${serverOrigin}";
  var __PILOT_VERSION__ = "${pilotVersion}";
  window.__pilot_instanceId = sessionStorage.getItem('__pilot_instanceId') || Math.random().toString(16).slice(2, 10);
  sessionStorage.setItem('__pilot_instanceId', window.__pilot_instanceId);

  console.log("[Pilot] Console Bridge starting... (instance: " + window.__pilot_instanceId + ")");
  console.log("[Pilot] Connecting to " + window.__PILOT_SERVER_ORIGIN__);

${body}

  console.log("[Pilot] Bridge ready! Use: npx pilot run 'your code' (PILOT_INSTANCE=" + window.__pilot_instanceId + ")");
})();`
}
