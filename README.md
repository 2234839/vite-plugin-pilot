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

Copy [SKILL.md](./SKILL.md) content and send it to your AI agent. The agent will check if the plugin is installed, configure itself, and start testing your browser pages.

**Claude Code**: paste into project `CLAUDE.md` or directly send in chat.
**Cursor**: paste into `.cursorrules` or send in chat.

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
