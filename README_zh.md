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

## 安装

```bash
pnpm add -D vite-plugin-pilot
# 或
npm install -D vite-plugin-pilot
```

## 快速开始

### 1. 在 Vite 配置中添加插件

```ts
// vite.config.ts
import { pilot } from 'vite-plugin-pilot'

export default defineConfig({
  plugins: [pilot()],
})
```

### 2. 启动 dev server 并打开浏览器

```bash
pnpm dev
# 在浏览器中打开 http://localhost:5173
```

### 3. 配置 AI Agent

复制 [SKILL.md](./SKILL.md) 的内容发送给你的 AI Agent，Agent 会自动检查插件是否已安装、配置自身并开始测试你的浏览器页面。

**Claude Code**：粘贴到项目 `CLAUDE.md` 或直接在聊天中发送。
**Cursor**：粘贴到 `.cursorrules` 或直接在聊天中发送。

## 工作原理

```
┌─────────────┐     文件 I/O      ┌──────────────┐     轮询        ┌─────────────┐
│  AI Agent   │ ───────────────→  │  .pilot/      │ ←────────────── │  浏览器      │
│  (pilot.js) │                   │  instances/   │                  │  (客户端)    │
│             │ ←───────────────  │  result.txt   │ ──────────────→ │             │
└─────────────┘     结果 + 快照    └──────────────┘   紧凑快照       └─────────────┘
```

1. Agent 将 JS 代码写入 `pending.js`
2. 浏览器轮询 `/__pilot/check`，获取代码并执行
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
