# vite-plugin-pilot

> 猫哥评价：**内鬼版的 DevTools MCP** —— 不走 CDP，直接往你网页里塞个内应，AI 通过它来操作页面。

简单说就是：**让 AI 能「看到」和「操作」你的浏览器页面**。

你用 Claude Code / Cursor 写前端代码时，改完之后想看效果，以前得自己切到浏览器刷新、点点点。现在 AI 可以自己干这些事 —— 它能读取页面上的内容、点击按钮、填写表单、验证效果对不对。就像给 AI 装了一双看网页的眼睛和一双操作网页的手。

**它不是什么**：不是 Puppeteer、不是 Playwright、不是 Selenium。它不需要启动一个「模拟浏览器」，而是直接在你**真实的浏览器**里干活，你甚至可以在旁边看着它操作。

**两种运行模式**：
- **Vite 插件模式**（推荐）— `pnpm dev` 启动项目时自动注入，零配置，AI 立刻就能操作你的页面
- **独立 Server 模式** — 不依赖 Vite，`npx pilot server` + 一段小脚本，连接任意网页（包括线上网站）

**[English](./README.md)** | 简体中文

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

## 它能干嘛

- **零配置接入** — Vite 插件即插即用，Vue、React、原生 JS 什么项目都行
- **操控任意网页** — 不依赖 Vite 的话，也能连线上网站（通过 Tampermonkey 或控制台脚本）
- **AI 看得懂页面** — 把页面压缩成 ~80 行文本给 AI 看，不浪费 token
- **多 tab 支持** — 开了 10 个 tab 也没事，AI 可以切换着操作
- **Vue/React 友好** — 自动处理 v-model 这些框架特性，不会填了表单但状态没更新
- **Alt+Click 元素检查** — 鼠标点到哪个元素，一键生成提示词发给 AI，告诉它「改这个」
- **浏览器反推消息** — 浏览器里看到的可以直接推给 Claude Code，不用手动复制粘贴

## 跟 Chrome DevTools MCP 有啥区别？

DevTools MCP 走的是 Chrome 调试协议（CDP），像官方后门；pilot 走的是往页面里注入代码，像内鬼。所以它能连一些 DevTools MCP 连不上的场景：

| | vite-plugin-pilot | Chrome DevTools MCP |
|---|---|---|
| **连接方式** | 页面内注入代码（SSE + HTTP） | Chrome 调试协议（CDP） |
| **需要开 CDP 端口吗** | 不用 | 要，还得加启动参数 |
| **WPS 加载项里的浏览器** | 能用 | 用不了（没有 CDP） |
| **Electron / 嵌入式浏览器** | 能用 | 不确定 |
| **连线上网站** | 能（Tampermonkey 一装就行） | 得暴露 CDP 端口 |
| **懂 Vue/React 吗** | 懂，v-model、scheduler 都处理了 | 不懂，只操作 DOM |
| **依赖** | 零依赖，纯注入 | 需要 Puppeteer / CDP 客户端 |

## 浏览器直连 Claude Code（Channel Server）

浏览器中 Alt+Click 的提示词可直接推送到当前 Claude Code session，无需复制粘贴。

> **前置条件**：Claude Code v2.1.80+、claude.ai 登录（API Key / Console 认证不支持）。Channel 功能目前处于 Research Preview，需使用 `--dangerously-load-development-channels` 启动标志。**注意：此功能未经作者实际验证（作者帐号不支持 Channel API），欢迎反馈。**

1. 安装 Channel Server 所需依赖（`pilot-channel.js` 依赖 `@modelcontextprotocol/sdk`，为避免影响包体积，该依赖未内置）：
```bash
pnpm add @modelcontextprotocol/sdk
```

2. 在项目根目录添加 `.mcp.json`：
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

3. 在 `.claude/settings.local.json` 中添加 hook 配置（降级模式，Channel API 不可用时自动生效）：
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

4. 启动 Claude Code 时加载 channel：
```bash
claude --dangerously-load-development-channels server:pilot-channel
```

**工作原理**：
- **Channel 模式**（推荐）：pilot-channel 作为 MCP Channel Server 通过 stdio 推送到 Claude Code session
- **降级模式**（始终可用）：消息写入 `.pilot/channel-pending.txt`，通过 UserPromptSubmit hook 自动附加到用户下次输入

浏览器端 Alt+Click 元素面板中的「发送给 Claude」按钮会自动检测 channel server 是否运行。未连接时按钮自动禁用，「复制提示词」始终可用。

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
