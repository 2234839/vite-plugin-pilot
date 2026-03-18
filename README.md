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
- **Dual Channel** — File I/O CLI (`bin/pilot.js`) + HTTP API (`/__pilot/*`)
- **Auto Reload** — Browser auto-refreshes when dev server restarts (v132)
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

### 3. Use the CLI to interact

```bash
# See the current page state (compact snapshot)
node bin/pilot.js page

# Execute JS and see the result + updated page
node bin/pilot.js run '__pilot_clickByText("Submit")' page

# Execute JS and see console logs
node bin/pilot.js run 'document.title' logs
```

That's it! The agent can now read the compact snapshot, decide what to do, execute actions, and verify results — all in a single tool call.

## Compact Snapshot Format

The page is serialized into a compact text format designed for LLM consumption:

```
# url: http://localhost:5173/
# title: My App
sections Overview|Settings|Users
button #3 Save|#4 Cancel
input #10 ph:Username
select #12 check=1 <Admin|Editor|Viewer>
checkbox check=agree I agree
textarea #15 ph:Description...
th Name|Role|Actions
tr Alice|Admin|Delete
```

Format: `tag#idx[val=V][check=N][type:T][ph=P][disabled] text`

- `#idx` — Element index for precise operations: `__pilot_click(10)`
- `[val=V]` — Current value
- `[check=N]` — Selected option index (0-based)
- `[ph=P]` — Placeholder text
- `[disabled]` — Element is disabled

## CLI Reference

```bash
node bin/pilot.js page              # View page (compact snapshot)
node bin/pilot.js page cached       # View cached snapshot (0.03s, no browser round-trip)
node bin/pilot.js run 'code' page   # Execute JS + view result + page (one step, recommended)
node bin/pilot.js run 'code' logs   # Execute JS + view result + logs
node bin/pilot.js logs              # View recent console logs
node bin/pilot.js status            # List connected browser tabs

# Target a specific tab
PILOT_INSTANCE=xxxxxxxx node bin/pilot.js page
```

**Recommended pattern**: `page` → read snapshot → `run 'code' page` → verify. Prefer `run 'code' page` (one step) to avoid two ~5s polling delays.

## Helper Functions

### Text Matching (recommended, refreshes element references each time)

| Function | Description |
|----------|-------------|
| `__pilot_clickByText(text, nth?)` | Click element by text content |
| `__pilot_typeByPlaceholder(ph, value)` | Type into input (triggers input events for v-model) |
| `__pilot_setValueByPlaceholder(ph, value, nth?)` | Set input value |
| `__pilot_selectValueByText(text, nth?)` | Select dropdown option |
| `__pilot_checkByText(text, nth?)` | Check checkbox |
| `__pilot_findByText(text)` | Find elements → `[{idx, tag, text}]` |
| `__pilot_waitFor(text, timeout?, disappear?)` | Wait for text to appear/disappear |
| `__pilot_waitEnabled(text, timeout?)` | Wait for disabled element to become enabled |

### Index-Based (read `#N` from compact)

| Function | Description |
|----------|-------------|
| `__pilot_click(i)` | Click element by index |
| `__pilot_setValue(i, value)` | Set input value |
| `__pilot_type(i, value)` | Type into input by index |
| `__pilot_dblclick(i)` | Double-click element |
| `__pilot_hover(i)` | Hover over element |

### Other

| Function | Description |
|----------|-------------|
| `__pilot_wait(ms)` | Wait for milliseconds |
| `__pilot_snapshot()` | Get full JSON snapshot |
| `__pilot_scrollIntoView(i)` | Scroll element into view |
| `__pilot_getRect(i)` | Get element bounding rect |
| `__pilot_checkMultipleByText([t1, t2])` | Check multiple checkboxes |
| `__pilot_uncheckByText(text, nth?)` | Uncheck checkbox |
| `__pilot_keydownByText(text, key)` | Trigger keydown on element |

## Important Notes

- **Complete related operations in one exec** (fill + submit) — Vue/React state may be lost across execs
- **Always use `typeByPlaceholder`** over `setValueByPlaceholder` — Vue/React v-model needs input events
- **Use `await __pilot_wait(0)`** between multi-step operations to let Vue scheduler process reactive updates
- **Use `__pilot_waitFor`** instead of `__pilot_wait(N)` — poll-based condition checking is more reliable than guessing wait times

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

The project includes a multi-framework playground for dogfooding:

```bash
pnpm dev
# /vue/ — Vue 3 playground
# /react/ — React playground
# /html/ — Vanilla JS playground
```

## License

MIT
