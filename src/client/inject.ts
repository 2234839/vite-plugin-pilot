import type { ResolvedPilotOptions } from '../types'
import { logCollectorCode } from './log-collector'
import { wsClientCode } from './ws-client'
import { snapshotCode } from './snapshot'
import { elementInspectorCode } from './element-inspector'

/** 语言包：element-inspector UI 文本 */
const LOCALES = {
  zh: {
    selected: '选中元素',
    text: '文本',
    empty: '(空)',
    placeholder: '描述你想对这个元素做什么（如：把这个按钮改成蓝色、修改这段文字的内容...）',
    sendToClaude: '发送给 Claude',
    copyPrompt: '复制提示词',
    close: '关闭',
    closeIn: 's 后关闭',
    copied: '已复制!',
    copyManual: '请手动 Ctrl+C 复制',
    sending: '发送中...',
    sent: '已发送!',
    sendFailed: '发送失败',
    notConnected: '未连接',
    elementInfo: '--- 选中元素信息 ---',
    tag: '标签',
    component: '组件',
    source: '源码',
    domPath: 'DOM路径',
    position: '位置',
    textContent: '文本',
    style: '样式',
  },
  en: {
    selected: 'Selected',
    text: 'Text',
    empty: '(empty)',
    placeholder: 'Describe what you want to do with this element (e.g. change button color, modify text...)',
    sendToClaude: 'Send to Claude',
    copyPrompt: 'Copy Prompt',
    close: 'Close',
    closeIn: 's to close',
    copied: 'Copied!',
    copyManual: 'Ctrl+C to copy',
    sending: 'Sending...',
    sent: 'Sent!',
    sendFailed: 'Failed',
    notConnected: 'Not connected',
    elementInfo: '--- Element Info ---',
    tag: 'Tag',
    component: 'Component',
    source: 'Source',
    domPath: 'DOM Path',
    position: 'Position',
    textContent: 'Text',
    style: 'Style',
  },
} as const

/**
 * 组装所有客户端模块，生成注入脚本字符串
 * 替换配置占位符为实际值
 */
export function buildInjectScript(options: ResolvedPilotOptions, pilotVersion?: string): string {
  const version = pilotVersion || String(Date.now())
  const locale = LOCALES[options.locale] ?? LOCALES.zh

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

        .replace(/__PILOT_VERSION__/g, version)
        .replace(/__LOCALE_SELECTED__/g, locale.selected)
        .replace(/__LOCALE_TEXT__/g, locale.text)
        .replace(/__LOCALE_EMPTY__/g, locale.empty)
        .replace(/__LOCALE_PLACEHOLDER__/g, locale.placeholder)
        .replace(/__LOCALE_SEND_TO_CLAUDE__/g, locale.sendToClaude)
        .replace(/__LOCALE_COPY_PROMPT__/g, locale.copyPrompt)
        .replace(/__LOCALE_CLOSE__/g, locale.close)
        .replace(/__LOCALE_CLOSE_IN__/g, locale.closeIn)
        .replace(/__LOCALE_COPIED__/g, locale.copied)
        .replace(/__LOCALE_COPY_MANUAL__/g, locale.copyManual)
        .replace(/__LOCALE_SENDING__/g, locale.sending)
        .replace(/__LOCALE_SENT__/g, locale.sent)
        .replace(/__LOCALE_SEND_FAILED__/g, locale.sendFailed)
        .replace(/__LOCALE_NOT_CONNECTED__/g, locale.notConnected)
        .replace(/__LOCALE_ELEMENT_INFO__/g, locale.elementInfo)
        .replace(/__LOCALE_TAG__/g, locale.tag)
        .replace(/__LOCALE_COMPONENT__/g, locale.component)
        .replace(/__LOCALE_SOURCE__/g, locale.source)
        .replace(/__LOCALE_DOM_PATH__/g, locale.domPath)
        .replace(/__LOCALE_POSITION__/g, locale.position)
        .replace(/__LOCALE_TEXT_CONTENT__/g, locale.textContent)
        .replace(/__LOCALE_STYLE__/g, locale.style)
      return `  /* === ${name} === */\n  ${resolved.trim()}`
    })
    .join('\n\n')

  return `<script>
var __PILOT_VERSION__ = "${version}";
var __PILOT_HIGHLIGHT__ = ${options.highlight};
/** 实例 ID 持久化到 sessionStorage，同一 tab 刷新后复用（不同 tab 天然隔离） */
var __pilot_instanceId = sessionStorage.getItem('__pilot_instanceId') || Math.random().toString(16).slice(2, 10);
sessionStorage.setItem('__pilot_instanceId', __pilot_instanceId);
(function() {
${body}
})();
</script>`
}
