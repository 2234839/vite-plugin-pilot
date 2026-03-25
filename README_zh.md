# vite-plugin-pilot

> **AI 驱动的浏览器导航工具** — 通过 SSE + HTTP API 打通 AI Agent 与浏览器运行时的链路。

让 AI Agent（Claude Code、Cursor 等）通过紧凑快照格式和简单的 JS 辅助函数**查看、交互和验证**浏览器页面。无需 Puppeteer、无需 Playwright。

**两种运行模式**：
- **Vite 插件模式**（推荐）— 自动注入客户端代码，`pnpm dev` 启动即可
- **独立 Server 模式** — `npx pilot server` 启动独立 HTTP server，配合 bridge.js 或 Tampermonkey 脚本连接任意网页（包括线上页面）

English | **[简体中文](./README_zh.md)**

## 快速开始

### 方式一：Vite 插件模式

复制以下内容，**粘贴到 AI Agent 的对话框中发送**：

```
请阅读 https://raw.githubusercontent.com/2234839/vite-plugin-pilot/master/SETUP.md ，按照其中的步骤为我配置 vite-plugin-pilot，包括安装插件、配置 vite.config.ts、将使用指南写入项目指令文件。
```

Agent 会自动完成安装、配置，并将使用指南写入项目的 AI 指令文件。

### 方式二：独立 Server 模式（不依赖 Vite）

```bash
# 启动独立 HTTP server
npx pilot server

# 浏览器连接方式（任选一种）：
# 1. 复制 .pilot/bridge.js 内容到目标浏览器控制台执行
# 2. 安装 .pilot/userscript.user.js 到 Tampermonkey

# 然后使用 CLI 操控浏览器：
npx pilot run '1+1'              # 执行 JS
npx pilot page                  # 查看页面快照
npx pilot status                # 查看连接的实例列表
```

## 特性

- **零配置** — Vite 插件即插即用，支持任何 Vite 项目（Vue、React、原生 JS 等）
- **独立运行** — 不依赖 Vite，`npx pilot server` 即可连接任意网页
- **紧凑快照** — 页面状态序列化为 ~80 行文本，针对 LLM 上下文窗口优化
- **多实例** — 每个浏览器 tab 独立追踪，通过 `instance:xxx`（支持前缀模糊匹配）或 `PILOT_INSTANCE` 自由切换
- **实例持久化** — 页面刷新复用同一 instance ID，不会堆积过期实例
- **自动刷新** — Dev server 重启后浏览器自动刷新
- **Vue/React 兼容** — `typeByPlaceholder` 触发 input 事件，兼容 v-model
- **Element Inspector** — Alt+Click 选中元素，生成含完整信息的提示词，供 AI Agent 使用
- **Tampermonkey 支持** — 安装 userscript 后自动在所有页面运行
- **Channel Server** — 浏览器端提示词可直接推送到 Claude Code session（通过 UserPromptSubmit hook）

## 为什么不直接用 Chrome DevTools MCP？

| | vite-plugin-pilot | Chrome DevTools MCP |
|---|---|---|
| **连接方式** | Dev server 注入（SSE + HTTP API） | Chrome DevTools Protocol (CDP) |
| **需要 CDP 端口** | 不需要 | 需要（`--remote-debugging-port`） |
| **WPS 加载项** | 支持 | 不支持（无法访问 CDP） |
| **Electron / 嵌入式浏览器** | 支持 | 不确定（需开启 CDP） |
| **远程调试** | 支持（浏览器可在任意设备） | 受限（需同一网络 + 暴露 CDP） |
| **框架感知** | Vue/React v-model、scheduler | 仅操作 DOM |
| **外部依赖** | 纯 Dev Server 注入，零依赖 | 需要 Puppeteer / CDP 客户端 |
| **线上页面** | 支持（独立 Server + bridge.js） | 需要暴露 CDP |

## 浏览器直连 Claude Code（Channel Server）

浏览器中 Alt+Click 的提示词可直接推送到当前 Claude Code session，无需复制粘贴。

1. 在项目根目录添加 `.mcp.json`：
```json
{
  "mcpServers": {
    "pilot-channel": {
      "command": "node",
      "args": ["node_modules/vite-plugin-pilot/bin/pilot-channel.js"]
    }
  }
}
```

2. 在 `.claude/settings.local.json` 中添加 hook 配置：
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/vite-plugin-pilot/bin/pilot-hook-channel.js"
          }
        ]
      }
    ]
  }
}
```

浏览器端 Alt+Click 元素面板中的「发送给 Claude」按钮会自动检测 channel server 是否运行。发送后，消息会在用户下次输入时自动附加到 Claude Code。

## 工作原理

```
┌─────────────┐     HTTP API      ┌──────────────┐     SSE          ┌─────────────┐
│  AI Agent   │ ───────────────→  │  Dev Server   │ ──────────────→ │  浏览器      │
│  (pilot.js) │                   │  (middleware) │                  │  (客户端)    │
│             │ ←───────────────  │               │ ←────────────── │             │
└─────────────┘   结果 + 快照     └──────────────┘   POST /result   └─────────────┘
                                  │  .pilot/
                                  │  instances/  (文件通道 fallback)
                                  └──────────────┘
```

1. Agent 通过 HTTP API 发送 JS 代码（一次请求，~10-50ms 响应）
2. Server 通过 SSE 将代码推送给浏览器（实时推送，零轮询）
3. 浏览器执行代码并通过 HTTP POST 返回结果
4. Agent 一次响应获取结果 + 快照 + 日志（fallback：文件通道）

## Playground

项目包含多框架 playground：

```bash
pnpm dev
# /vue/ — Vue 3 playground
# /react/ — React playground
# /html/ — 原生 JS playground
```

## 致谢

特别感谢 [LINUX DO](https://linux.do/) 社区，宝贵的反馈和讨论推动了项目的持续演进。

## 许可证

MIT
