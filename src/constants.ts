/** 插件名称 */
export const PLUGIN_NAME = 'vite-plugin-pilot'

/** 端点路径前缀 */
export const PILOT_PREFIX = '/__pilot'

/** 所有端点路径 */
export const PILOT_ENDPOINTS = {
  /** POST - 接收日志 */
  logs: `${PILOT_PREFIX}/logs`,
  /** POST - 直接执行 JS */
  exec: `${PILOT_PREFIX}/exec`,
  /** GET - 轮询待执行代码 */
  check: `${PILOT_PREFIX}/check`,
  /** POST - 回传执行结果 */
  result: `${PILOT_PREFIX}/result`,
  /** POST - 上报元素信息 */
  inspect: `${PILOT_PREFIX}/inspect`,
  /** GET - 获取页面快照 */
  snapshot: `${PILOT_PREFIX}/snapshot`,
  /** POST - 标记执行完成（浏览器通知 AI） */
  done: `${PILOT_PREFIX}/done`,
  /** GET - SSE 推送待执行代码 */
  sse: `${PILOT_PREFIX}/sse`,
} as const

/** .pilot 目录下的文件名 */
export const PILOT_FILES = {
  dir: '.pilot',
  /** 实例目录（多 tab 隔离） */
  instancesDir: 'instances',
  /** 默认实例 ID（agent 不指定 instance 时的 fallback） */
  defaultInstance: 'default',
  /** 日志文件 */
  logs: 'latest-errors.log',
  /** 待执行的 JS 文件 */
  pendingJs: 'pending.js',
  /** 执行结果文件 */
  execResult: 'exec-result.json',
  /** 选中元素信息文件 */
  selectedElement: 'selected-element.json',
  /** 页面快照文件 */
  snapshot: 'snapshot.json',
  /** compact 格式快照文件（AI 直接 cat 读取，无需 curl） */
  compactSnapshot: 'compact-snapshot.txt',
  /** 最近一次 exec 产生的控制台日志（grep-friendly 纯文本格式） */
  recentLogs: 'recent-logs.txt',
  /** 执行完成标记文件 */
  execDone: 'exec-done',
  /** 客户端版本文件（服务端写入，客户端对比） */
  version: 'version.txt',
  /** 活跃实例映射文件（记录 URL path → instance ID） */
  activeInstance: 'active-instance.json',
  /** 纯文本执行结果（agent 直接 cat 即可获取 result） */
  resultTxt: 'result.txt',
} as const

/** 默认配置 */
export const DEFAULT_OPTIONS = {
  logLevels: ['info', 'warn', 'error'] as const,
  maxBufferSize: 200,
  flushInterval: 1000,
  execTimeout: 15000,
  maxResultSize: 100 * 1024,
} as const
