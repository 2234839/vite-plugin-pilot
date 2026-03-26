# vite-plugin-pilot

> As one user put it: **"DevTools MCP, but from the inside."** Instead of connecting via Chrome's debugging protocol, it plants an agent inside your page. AI operates the browser through it.

**In plain English**: lets AI **see** and **interact** with your browser pages.

When you're coding with Claude Code or Cursor, you used to switch to the browser, refresh, click around to check your changes. Now AI can do all that itself — read page content, click buttons, fill forms, verify that everything looks right. It's like giving AI eyes to see your webpage and hands to operate it.

**What it's NOT**: not Puppeteer, not Playwright, not Selenium. It doesn't spin up a "simulated browser" — it works inside your **real browser**. You can literally watch it click around.

**Two modes**:
- **Vite Plugin** (recommended) — Auto-injects client code, works with `pnpm dev`, zero setup
- **Standalone Server** — `npx pilot server` connects to any webpage via bridge.js or Tampermonkey userscript (including production sites)

[![npm version](https://img.shields.io/npm/v/vite-plugin-pilot.svg)](https://www.npmjs.com/package/vite-plugin-pilot)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vite](https://img.shields.io/badge/Vite-%3E%3D5-green.svg)](https://vitejs.dev/)

**[简体中文](./README_zh.md)** | English

## Quick Start

### Option 1: Vite Plugin Mode

Copy the following and **send it to your AI agent in the chat**:

```
Read https://raw.githubusercontent.com/2234839/vite-plugin-pilot/master/SETUP.md and follow its steps to configure vite-plugin-pilot for my project, including installing the plugin, configuring vite.config.ts, and writing the usage guide into the project instruction file.
```

The agent will automatically install the plugin, configure options, and write the usage guide into your project's instruction file.

### Option 2: Standalone Server Mode (No Vite Required)

```bash
# Start standalone HTTP server
npx pilot server

# Connect browser (choose one):
# 1. Copy .pilot/bridge.js content to browser console
# 2. Install .pilot/userscript.user.js in Tampermonkey

# Then control the browser:
npx pilot run '1+1'              # Execute JS
npx pilot page                  # View page snapshot
npx pilot status                # List connected instances
```

## What It Does

- **Zero Config** — Drop-in Vite plugin, works with any Vite project (Vue, React, vanilla JS, etc.)
- **Works on Any Website** — No Vite? No problem. Tampermonkey or a console script connects to any page
- **AI-Readable Pages** — Compresses page state into ~80 lines of text, easy on token budgets
- **Multi-Tab Support** — 10 tabs open? AI can switch between them freely
- **Vue/React Aware** — Handles v-model and framework quirks so forms actually work
- **Alt+Click Inspector** — Click any element to generate a prompt telling AI "change this"
- **Browser Push-Back** — Send prompts from the browser directly to Claude Code, no copy-paste

## How's This Different from Chrome DevTools MCP?

DevTools MCP connects via Chrome's debugging protocol — the official backdoor. Pilot injects code into the page — the insider approach. This means it can reach places DevTools MCP can't:

| | vite-plugin-pilot | Chrome DevTools MCP |
|---|---|---|
| **How it connects** | Injects code into the page (SSE + HTTP) | Chrome DevTools Protocol (CDP) |
| **Needs CDP port?** | No | Yes, plus startup flags |
| **WPS Add-in browser** | Works | Doesn't work (no CDP) |
| **Electron / embedded browsers** | Works | Uncertain |
| **Production websites** | Yes (just install Tampermonkey) | Need to expose CDP |
| **Knows Vue/React?** | Yes, handles v-model, scheduler | No, DOM only |
| **Dependencies** | None, pure injection | Puppeteer / CDP client |

## Browser-to-Claude Code (Channel Server)

Push prompts directly from the browser to your running Claude Code session — no copy-paste needed.

> **Prerequisites**: Claude Code v2.1.80+, claude.ai login (API Key / Console auth not supported). Channels are in Research Preview — use `--dangerously-load-development-channels` flag. **Note: This feature has not been tested by the author (account lacks Channel API access). Feedback welcome.**

1. Add `.mcp.json` to your project root:
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

2. Add hook config to `.claude/settings.local.json` (fallback mode, always works):
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

3. Start Claude Code with the channel loaded:
```bash
claude --dangerously-load-development-channels server:pilot-channel
```

**How it works**:
- **Channel mode** (recommended): pilot-channel pushes directly to Claude Code session via MCP stdio
- **Fallback mode** (always available): message written to `.pilot/channel-pending.txt`, auto-attached via UserPromptSubmit hook

The "Send to Claude" button in the Alt+Click panel auto-detects whether the channel server is running. When unavailable, the button is disabled — "Copy Prompt" always works.

## How It Works

```
┌─────────────┐     HTTP API      ┌──────────────┐     SSE          ┌─────────────┐
│  AI Agent   │ ───────────────→  │  Dev Server   │ ──────────────→ │  Browser    │
│  (pilot.js) │                   │  (middleware) │                  │  (client)   │
│             │ ←───────────────  │               │ ←────────────── │             │
└─────────────┘   result + snap   └──────────────┘   POST /result   └─────────────┘
                                  │  .pilot/
                                  │  instances/  (file channel fallback)
                                  └──────────────┘
```

1. Agent sends JS code via HTTP API (one request, ~10-50ms response)
2. Server dispatches code to browser via SSE (real-time, zero polling)
3. Browser executes code and posts result back via HTTP
4. Agent receives result + snapshot + logs in one response (fallback: file I/O)

## Playground

The project includes a multi-framework playground:

```bash
pnpm dev
# /vue/ — Vue 3 playground
# /react/ — React playground
# /html/ — Vanilla JS playground
```

## Thanks

Special thanks to [LINUX DO](https://linux.do/) community for the valuable feedback and discussions that helped shape this project.

## License

MIT
