# vite-plugin-pilot

> **AI 驱动的浏览器导航工具** — 通过文件 I/O 打通 AI Agent 与浏览器运行时的链路。

一个 Vite 插件，让 AI Agent（Claude Code、Cursor 等）通过紧凑快照格式和简单的 JS 辅助函数**查看、交互和验证**浏览器页面。无需 Puppeteer、无需 Playwright — 纯文件 I/O。

English | **[简体中文](./README_zh.md)**

## 特性

- **零配置** — Vite 插件即插即用，支持任何 Vite 项目（Vue、React、原生 JS 等）
- **紧凑快照** — 页面状态序列化为 ~80 行文本，针对 LLM 上下文窗口优化
- **多实例** — 每个浏览器 tab 独立追踪，通过 `PILOT_INSTANCE` 自由切换
- **自动刷新** — Dev server 重启后浏览器自动刷新
- **Vue/React 兼容** — `typeByPlaceholder` 触发 input 事件，兼容 v-model
- **Element Inspector** — Alt+Click 选中元素，生成含完整信息的提示词，供 AI Agent 使用
- **Channel Server** — 浏览器端提示词可直接推送到 Claude Code session（通过 Channels API）

## 为什么不直接用 Chrome DevTools MCP？

| | vite-plugin-pilot | Chrome DevTools MCP |
|---|---|---|
| **连接方式** | Dev server 注入（SSE + 文件 I/O） | Chrome DevTools Protocol (CDP) |
| **需要 CDP 端口** | 不需要 | 需要（`--remote-debugging-port`） |
| **WPS 加载项** | 支持 | 不支持（无法访问 CDP） |
| **Electron / 嵌入式浏览器** | 支持 | 不确定（需开启 CDP） |
| **远程调试** | 支持（浏览器可在任意设备） | 受限（需同一网络 + 暴露 CDP） |
| **框架感知** | Vue/React v-model、scheduler | 仅操作 DOM |
| **外部依赖** | 纯文件 I/O，零依赖 | 需要 Puppeteer / CDP 客户端 |

vite-plugin-pilot 在任何能加载 Vite dev server 的浏览器中工作 — 不需要特殊的浏览器启动参数，不需要网络穿透，不需要 CDP 访问权限。打开页面就能用。

## 安装

```bash
pnpm add -D vite-plugin-pilot
# 或
npm install -D vite-plugin-pilot
```

## 快速开始

把以下内容发送给你的 AI Agent（粘贴到 Claude Code 的 `CLAUDE.md` 或 Cursor 的 `.cursorrules`）：

```
请阅读 https://raw.githubusercontent.com/2234839/vite-plugin-pilot/master/SKILL.md ，
按照其中的指示安装 vite-plugin-pilot 并配置自己，然后开始测试浏览器页面。
```

## 浏览器直连 Claude Code（Channel Server）

通过 Claude Code Channels API，浏览器中 Alt+Click 的提示词可直接推送到当前 Claude Code session，无需复制粘贴。

```bash
# 终端 1：启动 channel server
npx pilot-channel

# 终端 2：启动 Claude Code 并加载 channel
claude --dangerously-load-development-channels server:pilot-channel
```

浏览器端 Alt+Click 元素面板中的「发送给 Claude」按钮会自动检测 channel server 是否运行。

## 工作原理

```
┌─────────────┐     文件 I/O      ┌──────────────┐     SSE          ┌─────────────┐
│  AI Agent   │ ───────────────→  │  .pilot/      │ ←────────────── │  浏览器      │
│  (pilot.js) │                   │  instances/   │                  │  (客户端)    │
│             │ ←───────────────  │  result.txt   │ ──────────────→ │             │
└─────────────┘     结果 + 快照    └──────────────┘   紧凑快照       └─────────────┘
```

1. Agent 将 JS 代码写入 `pending.js` 或通过 HTTP API 发送
2. 浏览器通过 SSE 实时接收代码并执行
3. 浏览器将结果写入 `result.txt`，紧凑快照写入 `compact-snapshot.txt`
4. Agent 一次 tool call 读取结果 + 快照

## Playground

项目包含多框架 playground：

```bash
pnpm dev
# /vue/ — Vue 3 playground
# /react/ — React playground
# /html/ — 原生 JS playground
```

## 许可证

MIT
