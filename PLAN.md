# vite-plugin-pilot / 领航

> AI Agent 驾驶浏览器的导航工具 — 打通 浏览器运行时 → Dev Server → 源码 → IDE 的完整链路
>
> A pilot for AI agents to navigate the browser — bridging runtime, dev server, source code, and IDE.

## 背景与动机 / Background & Motivation

在 AI 辅助开发（如 Claude Code）的工作流中，Agent 需要频繁与运行中的浏览器页面交互：查看控制台日志、执行调试代码、定位 DOM 元素对应的源码。但现有工具链存在断层——Agent 只能通过间接方式（截图、用户描述）了解页面状态，无法高效地"看到"和"操作"浏览器。

**vite-plugin-pilot** 专门为 AI Agent 工作流设计，提供浏览器与 Agent 之间的双向通信桥梁。

In AI-assisted development workflows (e.g., Claude Code), agents frequently need to interact with running browser pages: reading console logs, executing debug code, and locating source code for DOM elements. But existing toolchains have a gap — agents can only understand page state indirectly (screenshots, user descriptions), and cannot efficiently "see" and "operate" the browser.

**vite-plugin-pilot** is designed specifically for AI agent workflows, providing a two-way communication bridge between the browser and the agent.

## 功能概览 / Feature Overview

| 模块 | 功能 | 通信方式 |
|------|------|----------|
| 日志收集 / Log Collector | 拦截 console 输出，增量追加到本地文件 | Browser → `.pilot/latest-errors.log` |
| 远程执行 / Remote Exec | Agent 写入 JS 文件，浏览器自动执行并返回结果 | `.pilot/pending-js.txt` → Browser → `.pilot/exec-result.json` |
| 元素选择器 / Element Inspector | Alt+Click 选中元素，提取组件信息和源码位置，生成 AI 提示词 | Browser → `.pilot/selected-element.json` |
| 页面快照 / Page Snapshot | 获取当前页面的结构化状态（组件树、路由、可见元素等） | Browser → `.pilot/snapshot.json` |
| 源码定位 / Source Locator | 在 DOM 元素上注入源码位置属性，支持 IDE 跳转链接 | Vite transform → DOM attributes |

## 架构 / Architecture

```
┌─────────────────┐     HTTP API              ┌─────────────────┐    readFile     ┌──────────┐
│    Browser       │ ◄──────────────────────► │    Dev Server    │ ◄───────────► │  Source   │
│                  │                          │  (Vite Plugin)   │               │  Files    │
│                  │                          │                  │   source map  │          │
│  ┌────────────┐  │  POST /__pilot/logs      │  ┌────────────┐  │   resolution  │          │
│  │Log         │──┼──────────────────────────┼─►│Middleware   │──┼──────────────►│          │
│  │Collector   │  │                          │  │Router       │  │               │          │
│  └────────────┘  │  POST /__pilot/exec      │  │             │  │               │          │
│  ┌────────────┐  │  GET  /__pilot/check     │  │  ┌───────┐  │  │  ┌─────────┐  │          │
│  │Remote      │──┼──────────────────────────┼─►│  │File   │  │  │  │Source   │  │          │
│  │Exec        │  │                          │  │  │Bridge │  │  │  │Locator  │  │          │
│  └────────────┘  │  GET  /__pilot/snapshot  │  │  └───────┘  │  │  └─────────┘  │          │
│  ┌────────────┐  │  POST /__pilot/inspect   │  └────────────┘  └───────────────┘          │
│  │Element     │──┼──────────────────────────┼─►                                          │
│  │Inspector   │  │                          │                                             │
│  └────────────┘  │                          │                                             │
│  ┌────────────┐  │                          │                                             │
│  │Page        │──┼──────────────────────────┼─►                                          │
│  │Snapshot    │  │                          │                                             │
│  └────────────┘  │                          │                                             │
└─────────────────┘                          └─────────────────┘                             │
        ▲                                            ▲                                       │
        │          Agent reads                        │     Agent writes                     │
        │          .pilot/*.log/json                  │     .pilot/pending-js.txt             │
        ▼                                            ▼                                       │
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                            AI Agent (Claude Code / etc.)                                    │
│                                                                                              │
│  1. curl GET /__pilot/logs  → 理解页面运行状态                                             │
│  2. curl POST /__pilot/exec?wait -d '...'  → 执行代码并同步获取结果                          │
│  3. curl GET /__pilot/snapshot  → 获取完整页面快照（WS 实时采集）                             │
│  4. curl GET /__pilot/result  → 获取最新执行结果                                             │
│  5. cat .pilot/selected-element.json  → 获取用户选中的元素上下文                               │
│  6. 读取 DOM 上的 data-v-pilot-file 属性  → 定位源码                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 详细设计 / Detailed Design

### 1. 日志收集系统 / Log Collector System

**目标**：让 Agent 能通过读取本地文件了解浏览器运行时状态。

**服务端（Server）**：
- 端点：`POST /__pilot/logs`（客户端上报）
- 端点：`GET /__pilot/logs`（Agent 读取）
- 接收 JSON 数组 `LogEntry[]`，格式化后追加到 `.pilot/latest-errors.log`
- 每次请求返回 `{ success: true }`

**客户端（Client）**：
- 拦截 `console.log/info/warn/error`，保留原始行为
- 监听 `window.onerror` 和 `unhandledrejection`
- 缓冲日志，每秒批量上报一次（避免频繁网络请求）
- 上报后清空已发送的缓冲区

**日志格式**：
```
=== 2026-03-16T14:30:00.000Z | 3 new logs ===
[2026-03-16T14:30:00.100Z] [INFO] App mounted successfully
[2026-03-16T14:30:00.200Z] [WARNING] Deprecated API called at App.vue:42
[2026-03-16T14:30:00.300Z] [ERROR] Failed to fetch user data
Stack Trace:
Error: NetworkError
    at fetchUser (src/api/user.ts:15:5)
```

**配置项**：
```ts
interface PilotOptions {
  /** 日志级别过滤，默认收集所有级别 */
  logLevels?: ('info' | 'warn' | 'error')[]
  /** 日志缓冲区最大条数，默认 200 */
  maxBufferSize?: number
  /** 日志上报间隔（ms），默认 1000 */
  flushInterval?: number
}
```

### 2. 远程执行 JS / Remote JS Execution

**目标**：让 Agent 能在浏览器页面上执行任意 JS 代码并获取结果。

**双通道设计**：

通道 A — 文件驱动（简单模式）：
1. Agent 写入 `.pilot/pending-js.txt`
2. 客户端每秒轮询 `GET /__pilot/check`
3. 服务端读取文件内容返回，然后删除文件
4. 客户端 `eval(code)` 执行，结果通过 `POST /__pilot/result` 回传
5. 服务端将结果写入 `.pilot/exec-result.json`

通道 B — HTTP API（直接模式）：
1. Agent 发送 `POST /__pilot/exec`，body 为要执行的 JS 代码（支持纯文本或 JSON string）
2. 服务端存储待执行代码
3. 客户端轮询 `/__pilot/check` 获取并执行
4. 执行结果回传到 `/__pilot/result`
5. Agent 可通过 `.pilot/exec-result.json` 或 `GET /__pilot/result` 获取结果

通道 C — 同步等待模式：
1. Agent 发送 `POST /__pilot/exec?wait`，body 为要执行的 JS 代码
2. 服务端通过 WS 推送代码给客户端
3. 客户端执行后结果通过 WS/HTTP 回传
4. HTTP 响应直接返回执行结果（同步，最长等待 execTimeout + 2s）

**安全性**：
- 仅在开发模式（`configureServer`）下生效
- 执行超时机制（默认 5s），防止无限循环
- 结果序列化限制（最大 100KB），防止内存溢出

**执行结果格式**：
```json
{
  "code": "document.querySelector('h1')?.textContent",
  "result": "Hello World",
  "timestamp": "2026-03-16T14:30:00.000Z",
  "success": true
}
```

### 3. 元素选择器 + 提示词生成 / Element Inspector + Prompt Generation

**目标**：用户在页面上选中元素，自动生成包含组件上下文的 AI 提示词，Agent 读取后获得精准的开发上下文。

**交互流程**：
1. 用户按 `Alt + Click` 激活选择模式
2. 鼠标移动时，目标元素被高亮覆盖层标记
3. 覆盖层显示：组件名、文件路径:行号、元素尺寸
4. 点击确认选中
5. 客户端收集元素信息，通过 `POST /__pilot/inspect` 发送到服务端
6. 服务端调用提示词生成器，结果写入 `.pilot/selected-element.json`

**覆盖层 UI 设计**：
```
┌─────────────────────────────────┐
│ <UserAvatar>                    │  ← 组件名
│ src/components/UserAvatar.vue:42│  ← 源码位置（来自 data-v-pilot-* 属性）
│ 48 × 48px                       │  ← 元素尺寸
└─────────────────────────────────┘
```
- 使用 `position: fixed` 绝对定位
- `z-index: 2147483640` 确保在最顶层
- `pointer-events: none` 不阻挡鼠标事件
- 虚线边框 + 半透明背景，类似 devtools 检查器

**收集的元素信息**：
```ts
interface ElementInfo {
  /** 元素标签名 */
  tagName: string
  /** CSS 类名列表 */
  className: string
  /** 元素尺寸 */
  rect: { width: number; height: number; top: number; left: number }
  /** 元素文本内容（截断到 200 字符） */
  textContent: string
  /** 源码文件路径（来自 data-v-pilot-file 属性） */
  sourceFile?: string
  /** 源码行号（来自 data-v-pilot-line 属性） */
  sourceLine?: number
  /** Vue 组件名（通过 __vueParentComponent 获取） */
  componentName?: string
  /** DOM 层级路径 */
  domPath: string
  /** 计算样式摘要 */
  computedStyles: { color: string; fontSize: string; display: string }
}
```

**生成的提示词格式**：
```
用户选中了页面上的 <UserAvatar> 组件。

位置信息：
- 源码文件：src/components/UserAvatar.vue 第 42 行
- 组件路径：Header > NavBar > UserProfile > UserAvatar
- 元素尺寸：48 × 48px
- CSS 类名：avatar-large rounded-full
- 文本内容：（无文本内容，为图片元素）

上下文：
该组件位于页面顶部的用户导航栏中，是用户资料区域的一部分。
当前元素可能是用户头像图片。

如需修改，请编辑：src/components/UserAvatar.vue
IDE 跳转：vscode://file/absolute/path/src/components/UserAvatar.vue:42
```

### 4. 页面状态快照 / Page Snapshot

**目标**：让 Agent 能获取当前页面的完整结构化状态，无需截图或用户描述。

**端点**：`GET /__pilot/snapshot`（客户端主动采集，服务端转发）

**快照数据结构**：
```ts
interface SnapshotData {
  /** 采集时间 */
  timestamp: string
  /** 当前 URL */
  url: string
  /** 页面标题 */
  title: string
  /** 当前路由（Vue Router / React Router，如果可用） */
  route?: string
  /** URL 查询参数 */
  queryParams: Record<string, string>
  /** 可见元素概览（最多 100 个） */
  visibleElements: Array<{
    tag: string
    id?: string
    className?: string
    text: string          /** 截断到 100 字符 */
    rect: { width: number; height: number }
    sourceFile?: string
    sourceLine?: number
  }>
  /** Vue 组件树（如果可用，通过 __vueParentComponent 遍历） */
  componentTree?: Array<{
    name: string
    file?: string
    children: ComponentTreeNode[]
  }>
  /** 控制台错误数量（自上次快照以来的新错误） */
  errorCount: number
  /** 页面加载时间 */
  performance: {
    domReady: number
    load: number
  }
}
```

**采集策略**：
- 仅采集 `document.body` 内的可见元素（`offsetParent !== null` 或 `<body>` 本身）
- 文本内容截断，避免快照过大
- 组件树深度限制（最多 5 层），避免过度递归
- 性能指标从 `performance.timing` 或 `PerformanceObserver` 获取

### 5. 源码定位桥接 / Source Locator Bridge

**目标**：在 DOM 元素上注入源码位置信息，让 Agent 能通过 DOM 属性直接定位源码。

**实现方式**：

通过 Vite 的 `transform` 钩子，在代码转换阶段为每个 HTML 元素和 Vue SFC 模板节点注入位置标记：

```ts
// 在 Vite transform 钩子中
transform(code, id) {
  if (!id.endsWith('.vue') && !id.endsWith('.html')) return null

  // 利用 Vite 已有的 source map 信息
  // 在模板编译后，为每个根元素添加 data 属性
  const sourceFile = relative(process.cwd(), id)
  // 注入 data-v-pilot-file 和 data-v-pilot-line 属性
}
```

**注入的属性**：
- `data-v-pilot-file`：源码文件的相对路径
- `data-v-pilot-line`：模板中对应行的行号

**Vue SFC 特殊处理**：
- 利用 `@vue/compiler-sfc` 解析 SFC 的 template 区域
- 结合 Vite 内部的 source map 追踪编译后的位置映射
- 注入到模板根元素上

**IDE 跳转链接生成**：
```ts
function generateIdeLink(filePath: string, line: number, root: string): string {
  const absolutePath = resolve(root, filePath)
  return `vscode://file/${absolutePath}:${line}`
}
```

## 项目结构 / Project Structure

```
vite-plugin-pilot/
├── package.json              # 包配置，peerDeps: vite >= 5
├── tsconfig.json             # TypeScript 配置
├── tsconfig.node.json        # Node 端 TS 配置（vite.config.ts 等）
├── vite.config.ts            # 插件自身构建配置
├── LICENSE                   # MIT
├── README.md                 # 中英双语使用文档
├── PLAN.md                   # 本规划文档
│
├── src/
│   ├── index.ts              # 主入口，导出 pilot() 函数
│   ├── types.ts              # 所有类型定义
│   ├── constants.ts          # 端点路径、默认配置值
│   │
│   ├── server/               # 服务端模块（Node.js 环境）
│   │   ├── middleware.ts     # HTTP 中间件路由，处理所有 /__pilot/* 请求
│   │   ├── file-bridge.ts    # 文件系统桥接：.pilot/ 目录管理、文件读写
│   │   └── source-locator.ts # 源码位置注入：Vite transform 钩子
│   │
│   ├── client/               # 客户端模块（浏览器环境，将打包为字符串注入）
│   │   ├── log-collector.ts  # Console 拦截 + 批量上报
│   │   ├── remote-exec.ts    # 轮询 + 执行 + 结果回传
│   │   ├── element-inspector.ts # Alt+Click 选择器 + 高亮覆盖层
│   │   ├── snapshot.ts       # 页面结构化快照采集
│   │   └── inject.ts         # 组装所有客户端模块，生成注入脚本
│   │
│   └── prompt/
│       └── generator.ts      # ElementInfo → AI 提示词
│
├── __tests__/                # 单元测试
│   ├── middleware.test.ts    # 中间件端点测试
│   ├── file-bridge.test.ts   # 文件操作测试
│   └── generator.test.ts     # 提示词生成测试
│
└── playground/               # Vue 3 演示项目
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.vue
        └── main.ts
```

## 使用方式 / Usage

### 安装 / Install
```bash
pnpm add -D vite-plugin-pilot
```

### 配置 / Setup
```ts
// vite.config.ts
import { pilot } from 'vite-plugin-pilot'

export default defineConfig({
  plugins: [
    vue(),
    pilot({
      // 可选配置
      logLevels: ['info', 'warn', 'error'],
      maxBufferSize: 200,
      flushInterval: 1000,
    }),
  ],
})
```

### 在 CLAUDE.md 中添加 Agent 工作流指引
```markdown
## Pilot 开发工具

Pilot 插件提供浏览器与 Agent 的双向桥接：

- 查看页面日志：`tail -100 .pilot/latest-errors.log`
- 远程执行 JS：`echo 'document.title' > .pilot/pending-js.txt && sleep 2 && cat .pilot/exec-result.json`
- 获取页面快照：`curl -s http://localhost:5173/__pilot/snapshot`
- 读取选中元素：`cat .pilot/selected-element.json`（用户 Alt+Click 选中后可用）
```

## 技术要点 / Technical Notes

1. **仅开发模式生效** — 所有功能通过 `configureServer` + `transformIndexHtml` 实现，生产构建零影响
2. **零运行时依赖** — 不引入任何第三方依赖，仅 `peerDependencies: { "vite": ">=5" }`
3. **文件通信协议** — `.pilot/` 目录作为 Agent 和浏览器的共享状态空间，简单可靠，与 AI Agent 的文件读写能力天然契合
4. **与 Vite DevTools 兼容** — 使用独立的端点前缀 `/__pilot/*` 和快捷键 `Alt+Click`，不与 devtools 的 `/__devtools/*` 和 `Ctrl+Shift` 冲突
5. **Source Map 利用** — 通过 Vite transform 钩子在编译阶段注入位置标记，比运行时 source map 查询更高效
6. **Vue 组件识别** — 利用 Vue 3 内部的 `__vueParentComponent` 属性，无需额外依赖即可识别组件层次

## 实施步骤 / Implementation Steps

按以下顺序实施，每步完成后可独立验证：

1. **项目骨架** — package.json、tsconfig.json、tsconfig.node.json、vite.config.ts、目录结构
2. **类型 + 常量** — types.ts、constants.ts
3. **文件桥接层** — server/file-bridge.ts
4. **日志收集** — server/middleware.ts（日志端点）+ client/log-collector.ts
5. **远程执行** — server/middleware.ts（执行端点）+ client/remote-exec.ts
6. **客户端注入** — client/inject.ts + transformIndexHtml 钩子
7. **源码定位** — server/source-locator.ts（Vite transform 钩子）
8. **元素选择器** — client/element-inspector.ts（Alt+Click + 覆盖层）
9. **提示词生成器** — prompt/generator.ts
10. **页面快照** — client/snapshot.ts + server 端点
11. **主入口** — src/index.ts 组装所有模块
12. **Playground** — Vue 3 演示项目
13. **测试** — middleware、file-bridge、generator 单元测试
14. **README** — 中英双语文档

## 验证方式 / Verification

1. `pnpm build` — 构建成功，输出 dist/
2. `pnpm tsc --noEmit` — 无类型错误
3. Playground `pnpm dev` 端到端验证：
   - [ ] 浏览器控制台日志自动写入 `.pilot/latest-errors.log`
   - [ ] `echo '1+1' > .pilot/pending-js.txt` → 页面执行 → 结果写入 `.pilot/exec-result.json`
   - [ ] `Alt+Click` 元素 → 高亮覆盖层 + 信息写入 `.pilot/selected-element.json`
   - [ ] `curl localhost:5173/__pilot/snapshot` → 返回结构化快照
   - [ ] DOM 元素包含 `data-v-pilot-file` / `data-v-pilot-line` 属性
4. 回到 range-warp 项目，替换本地插件引用为 npm 包引用，验证兼容性
