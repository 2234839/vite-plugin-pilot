# vite-plugin-pilot

> **AI-Powered Browser Navigation for Vite** — Bridge the gap between AI agents and browser runtime via file I/O.

A Vite plugin that lets AI agents (Claude Code, Cursor, etc.) **see, interact with, and verify** browser pages through a compact snapshot format and simple JS helper functions. No Puppeteer, no Playwright — just file I/O.

[![npm version](https://img.shields.io/npm/v/vite-plugin-pilot.svg)](https://www.npmjs.com/package/vite-plugin-pilot)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vite](https://img.shields.io/badge/Vite-%3E%3D5-green.svg)](https://vitejs.dev/)

**[简体中文](./README_zh.md)** | English

## Features

- **Zero Config** — Drop-in Vite plugin, works with any Vite project (Vue, React, vanilla JS, etc.)
- **Compact Snapshot** — Page state serialized into ~80 lines of text, optimized for LLM context windows
- **Multi-Instance** — Each browser tab is independently tracked, switch freely with `PILOT_INSTANCE`
- **Auto Reload** — Browser auto-refreshes when dev server restarts
- **Vue/React Aware** — `typeByPlaceholder` dispatches input events for v-model compatibility

## Installation

```bash
pnpm add -D vite-plugin-pilot
# or
npm install -D vite-plugin-pilot
```

## Quick Start

### 1. Add plugin to your Vite config

```ts
// vite.config.ts
import { pilot } from 'vite-plugin-pilot'

export default defineConfig({
  plugins: [pilot()],
})
```

### 2. Start dev server and open browser

```bash
pnpm dev
# Open http://localhost:5173 in your browser
```

### 3. Configure your AI agent

Copy the following into your AI agent's instruction file:

**Claude Code** → paste into project `CLAUDE.md`:

```markdown
<!-- vite-plugin-pilot:start -->
# vite-plugin-pilot

辅助 AI agent 测试浏览器页面。通过文件 I/O 在浏览器执行 JS。`pnpm dev` 启动，浏览器打开页面即可使用。

## 工作流

```bash
npx pilot page                    # 看页面（compact 格式）
npx pilot run '代码' page         # 操作+看结果（一步完成）
npx pilot run '代码' logs         # 操作+看日志
npx pilot logs                    # 看最近日志
npx pilot status                  # 查看连接的 tab 列表
npx pilot help                    # 查看辅助函数列表
```

**使用模式**：`page` 看 compact → 读取 `#idx` 或用文本匹配 → `run '操作代码' page` → 验证结果。优先用 `run 'code' page` 一步完成（避免两次 ~5s 轮询延迟）。

**关键注意**：
- **同一 exec 完成相关操作**（填写+提交），跨 exec Vue/React 状态可能丢失
- 多步操作间 `await __pilot_wait(0)` 让 Vue scheduler 处理响应式更新
- **始终用 `typeByPlaceholder`**：Vue/React v-model 需要 input 事件，`type` 触发 input 事件，`setValue` 只改 DOM
- `page cached` 读缓存（0.03s），不需要最新状态时用
<!-- vite-plugin-pilot:end -->
```

**Cursor / Other agents** → paste into `.cursorrules` or project rules, content same as above.

That's it! The agent can now autonomously develop and verify features for you.

## How It Works

```
┌─────────────┐     file I/O      ┌──────────────┐     polling      ┌─────────────┐
│  AI Agent   │ ───────────────→  │  .pilot/      │ ←────────────── │  Browser    │
│  (pilot.js) │                   │  instances/   │                  │  (client)   │
│             │ ←───────────────  │  result.txt   │ ──────────────→ │             │
└─────────────┘     result +      │  snapshot.txt │   compact snap   └─────────────┘
                    snapshot        └──────────────┘
```

1. Agent writes JS code to `pending.js`
2. Browser polls `/__pilot/check`, picks up code, executes it
3. Browser writes result to `result.txt` and compact snapshot to `compact-snapshot.txt`
4. Agent reads result + snapshot in one tool call

## Playground

The project includes a multi-framework playground:

```bash
pnpm dev
# /vue/ — Vue 3 playground
# /react/ — React playground
# /html/ — Vanilla JS playground
```

## License

MIT
