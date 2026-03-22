import type { ResolvedPilotOptions } from '../types'
import { logCollectorCode } from './log-collector'
import { wsClientCode } from './ws-client'
import { snapshotCode } from './snapshot'
import { elementInspectorCode } from './element-inspector'

/**
 * 组装所有客户端模块，生成注入脚本字符串
 * 替换配置占位符为实际值
 */
export function buildInjectScript(options: ResolvedPilotOptions, pilotVersion?: string): string {
  const version = pilotVersion || String(Date.now())

  const scripts = [
    { name: 'Log Collector', code: logCollectorCode },
    { name: 'SSE Client', code: wsClientCode },
    { name: 'Page Snapshot', code: snapshotCode },
    ...(options.inspector ? [{ name: 'Element Inspector', code: elementInspectorCode }] : []),
  ]

  /** 替换占位符 */
  const body = scripts
    .map(({ name, code }) => {
      const resolved = code
        .replace(/__MAX_BUFFER_SIZE__/g, String(options.maxBufferSize))
        .replace(/__FLUSH_INTERVAL__/g, String(options.flushInterval))
        .replace(/__EXEC_TIMEOUT__/g, String(options.execTimeout))
        .replace(/__MAX_RESULT_SIZE__/g, String(options.maxResultSize))
        .replace(/__PILOT_VERSION__/g, version)
      return `  /* === ${name} === */\n  ${resolved.trim()}`
    })
    .join('\n\n')

  return `<script>
var __PILOT_VERSION__ = "${version}";
/** 生成短实例 ID（8 位随机 hex），每个 tab 独立标识，避免同 URL 多 tab 冲突 */
var __pilot_instanceId = Math.random().toString(16).slice(2, 10);
(function() {
${body}
})();
</script>`
}
