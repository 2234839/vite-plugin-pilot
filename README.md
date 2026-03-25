# vite-plugin-pilot

> **AI-Powered Browser Navigation** — Bridge the gap between AI agents and browser runtime via SSE + HTTP API.

Let AI agents (Claude Code, Cursor, etc.) **see, interact with, and verify** browser pages through a compact snapshot format and simple JS helper functions. No Puppeteer, no Playwright.

**Two modes**:
- **Vite Plugin** (recommended) — Auto-injects client code, works with `pnpm dev`
- **Standalone Server** — `npx pilot server` connects to any webpage via bridge.js or Tampermonkey userscript (including production sites)

[![npm version](https://img.shields.io/npm/v/vite-plugin-pilot.svg)](https://www.npmjs.com/package/vite-plugin-pilot)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vite](https://img.shields.io/badge/Vite-%3E%3D5-green.svg)](https://vitejs.dev/)

**[简体中文](./README_zh.md)** | English

## Features

- **Zero Config** — Drop-in Vite plugin, works with any Vite project (Vue, React, vanilla JS, etc.)
- **Standalone Server** — `npx pilot server` works without Vite, connects to any webpage
- **Compact Snapshot** — Page state serialized into ~80 lines of text, optimized for LLM context windows
- **Multi-Instance** — Each browser tab is independently tracked, switch freely with `instance:xxx` (supports prefix matching) or `PILOT_INSTANCE`
- **Instance Persistence** — Page refreshes reuse the same instance ID, no stale instance buildup
- **Auto Reload** — Browser auto-refreshes when dev server restarts
- **Vue/React Aware** — `typeByPlaceholder` dispatches input events for v-model compatibility
- **Element Inspector** — Alt+Click any element to generate a prompt with full context for AI agents
- **Tampermonkey Support** — Install userscript to run on any page automatically
- **Channel Server** — Push prompts directly to Claude Code session via hook-based integration

## Why Not Chrome DevTools MCP?

| | vite-plugin-pilot | Chrome DevTools MCP |
|---|---|---|
| **Connects via** | Dev server injection (SSE + HTTP API) | Chrome DevTools Protocol (CDP) |
| **Requires CDP port** | No | Yes (`--remote-debugging-port`) |
| **WPS Add-ins** | Yes | No (no CDP access) |
| **Electron / embedded browsers** | Yes | Maybe (needs CDP enabled) |
| **Remote debugging** | Yes (browser on any device) | Limited (same network, CDP exposed) |
| **Framework awareness** | Vue/React v-model, scheduler | DOM-only |
| **Zero external deps** | Pure Dev Server injection | Needs Puppeteer/CDP client |
| **Production sites** | Yes (standalone server + bridge.js) | Needs CDP exposed |

## Installation

```bash
pnpm add -D vite-plugin-pilot
# or
npm install -D vite-plugin-pilot
```

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

## Browser-to-Claude Code (Channel Server)

Push prompts directly from the browser to your running Claude Code session — no copy-paste needed.

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

2. Add hook config to `.claude/settings.local.json`:
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

The "Send to Claude" button in the Alt+Click panel auto-detects whether the channel server is running. When you send a message, it will be automatically attached to your next Claude Code input.

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
