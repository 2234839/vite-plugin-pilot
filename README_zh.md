# vite-plugin-pilot

> **AI 驱动的浏览器导航工具** — 通过文件 I/O 打通 AI Agent 与浏览器运行时的链路。

一个 Vite 插件，让 AI Agent（Claude Code、Cursor 等）通过紧凑快照格式和简单的 JS 辅助函数**查看、交互和验证**浏览器页面。无需 Puppeteer、无需 Playwright — 纯文件 I/O。

English | **[English](./README.md)**

## 特性

- **零配置** — Vite 插件即插即用，支持任何 Vite 项目（Vue、React、原生 JS 等）
- **紧凑快照** — 页面状态序列化为 ~80 行文本，针对 LLM 上下文窗口优化
- **多实例** — 每个浏览器 tab 独立追踪，通过 `PILOT_INSTANCE` 自由切换
- **双通道** — 文件 I/O CLI（`bin/pilot.js`）+ HTTP API（`/__pilot/*`）
- **自动刷新** — Dev server 重启后浏览器自动刷新（v132）
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

### 3. 使用 CLI 交互

```bash
# 查看当前页面状态（紧凑快照）
node bin/pilot.js page

# 执行 JS 并查看结果 + 更新后的页面
node bin/pilot.js run '__pilot_clickByText("提交")' page

# 执行 JS 并查看控制台日志
node bin/pilot.js run 'document.title' logs
```

完成！Agent 现在可以读取紧凑快照、决定操作、执行动作并验证结果 — 全部在一次 tool call 中完成。

## 紧凑快照格式

页面被序列化为针对 LLM 消费优化的紧凑文本格式：

```
# url: http://localhost:5173/
# title: My App
sections 概览|设置|用户
button #3 保存|#4 取消
input #10 ph:用户名
select #12 check=1 <管理员|编辑|查看者>
checkbox check=agree 我同意
textarea #15 ph:描述...
th 姓名|角色|操作
tr Alice|管理员|删除
```

格式：`tag#idx[val=V][check=N][type:T][ph=P][disabled] text`

- `#idx` — 元素索引，用于精确操作：`__pilot_click(10)`
- `[val=V]` — 当前值
- `[check=N]` — 已选中的选项索引（从 0 开始）
- `[ph=P]` — 占位符文本
- `[disabled]` — 元素已禁用

## CLI 参考

```bash
node bin/pilot.js page              # 查看页面（紧凑快照）
node bin/pilot.js page cached       # 查看缓存快照（0.03s，无浏览器轮询）
node bin/pilot.js run '代码' page   # 执行 JS + 查看结果 + 页面（一步完成，推荐）
node bin/pilot.js run '代码' logs   # 执行 JS + 查看结果 + 日志
node bin/pilot.js logs              # 查看最近控制台日志
node bin/pilot.js status            # 列出已连接的浏览器 tab

# 指定目标 tab
PILOT_INSTANCE=xxxxxxxx node bin/pilot.js page
```

**推荐模式**：`page` → 读取快照 → `run '代码' page` → 验证结果。优先使用 `run 'code' page`（一步完成，避免两次 ~5s 轮询延迟）。

## 辅助函数

### 文本匹配（推荐，每次搜索刷新元素引用）

| 函数 | 说明 |
|------|------|
| `__pilot_clickByText(text, nth?)` | 按文本内容点击元素 |
| `__pilot_typeByPlaceholder(ph, value)` | 在输入框中输入（触发 input 事件，兼容 v-model） |
| `__pilot_setValueByPlaceholder(ph, value, nth?)` | 设置输入框值 |
| `__pilot_selectValueByText(text, nth?)` | 选择下拉框选项 |
| `__pilot_checkByText(text, nth?)` | 勾选复选框 |
| `__pilot_findByText(text)` | 查找元素 → `[{idx, tag, text}]` |
| `__pilot_waitFor(text, timeout?, disappear?)` | 等待文本出现/消失 |
| `__pilot_waitEnabled(text, timeout?)` | 等待禁用元素变为可用 |

### 按索引（从 compact 读取 `#N`）

| 函数 | 说明 |
|------|------|
| `__pilot_click(i)` | 按索引点击元素 |
| `__pilot_setValue(i, value)` | 按索引设置值 |
| `__pilot_type(i, value)` | 按索引输入 |
| `__pilot_dblclick(i)` | 双击元素 |
| `__pilot_hover(i)` | 悬停元素 |

### 其他

| 函数 | 说明 |
|------|------|
| `__pilot_wait(ms)` | 等待毫秒 |
| `__pilot_snapshot()` | 获取完整 JSON 快照 |
| `__pilot_scrollIntoView(i)` | 滚动元素到视口 |
| `__pilot_getRect(i)` | 获取元素位置 |
| `__pilot_checkMultipleByText([t1, t2])` | 勾选多个复选框 |
| `__pilot_uncheckByText(text, nth?)` | 取消勾选 |
| `__pilot_keydownByText(text, key)` | 在元素上触发按键事件 |

## 注意事项

- **在同一 exec 中完成相关操作**（填写+提交）— 跨 exec 时 Vue/React 状态可能丢失
- **始终使用 `typeByPlaceholder`** 而非 `setValueByPlaceholder` — Vue/React v-model 需要 input 事件
- **多步操作间使用 `await __pilot_wait(0)`** — 让 Vue scheduler 处理响应式更新
- **使用 `__pilot_waitFor`** 替代 `__pilot_wait(N)` — 轮询检测比猜测等待时间更可靠

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

## 许可证

MIT
