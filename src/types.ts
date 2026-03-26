/** 插件配置选项 */
export interface PilotOptions {
  /** 日志级别过滤，默认收集所有级别 */
  logLevels?: LogLevel[]
  /** 日志缓冲区最大条数，默认 200 */
  maxBufferSize?: number
  /** 日志上报间隔（ms），默认 1000 */
  flushInterval?: number
  /** 远程执行超时时间（ms），默认 5000 */
  execTimeout?: number
  /** 执行结果最大字节数，默认 100KB */
  maxResultSize?: number
  /** Alt+Click 元素检查器，默认开启。设为 false 禁用 */
  inspector?: boolean
  /** 操作元素时显示高亮聚焦效果（蓝色虚线边框），默认开启 */
  highlight?: boolean
  /** 语言环境，默认 'zh'。支持 'zh' | 'en' */
  locale?: 'zh' | 'en'
  /** 是否检查 npm 新版本，默认 true */
  checkUpdate?: boolean
}

export type LogLevel = 'info' | 'warn' | 'error'

/** 客户端上报的日志条目 */
export interface LogEntry {
  timestamp: string
  type: LogLevel
  message: string
  stack?: string
  source?: string
  line?: number
  col?: number
}

/** 远程执行结果 */
export interface ExecResult {
  code: string
  result: unknown
  success: boolean
  error?: string
  /** 客户端 exec 后立即采集的 snapshot，服务端 ?snapshot=1 直接透传 */
  snapshot?: Record<string, unknown>
  /** compact 格式的页面快照文本（file-driven exec 后自动生成，agent 用 cat 即可读取） */
  snapshotText?: string
  /** exec 期间产生的控制台日志（紧凑格式：[TYPE] message），agent 无需额外 bash 调用 */
  logs?: string[]
}

/** 元素信息（客户端采集） */
export interface ElementInfo {
  tagName: string
  className: string
  rect: { width: number; height: number; top: number; left: number }
  textContent: string
  sourceFile?: string
  sourceLine?: number
  componentName?: string
  domPath: string
  computedStyles: { color: string; fontSize: string; display: string }
}

/** 页面快照数据 */
export interface SnapshotData {
  timestamp: string
  url: string
  title: string
  route?: string
  queryParams: Record<string, string>
  visibleElements: Array<{
    tag: string
    id?: string
    className?: string
    text: string
    rect: { width: number; height: number }
    sourceFile?: string
    sourceLine?: number
  }>
  componentTree?: Array<{
    name: string
    file?: string
    children: ComponentTreeNode[]
  }>
  errorCount: number
  performance: {
    domReady: number
    load: number
  }
}

/** 组件树节点 */
export interface ComponentTreeNode {
  name: string
  file?: string
  children: ComponentTreeNode[]
}

/** 服务端路由处理函数 */
export interface RouteHandler {
  (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void): void
}

/** 构建后的插件配置（带默认值） */
export interface ResolvedPilotOptions extends Required<PilotOptions> {
  /** .pilot 目录的绝对路径 */
  pilotDir: string
}
