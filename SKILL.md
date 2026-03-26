---
name: pilot
description: 通过 vite-plugin-pilot 在浏览器中测试页面。当需要查看页面状态、与页面元素交互、验证前端功能时使用。前置条件：vite-plugin-pilot 已安装且 dev server 已启动。
---

# vite-plugin-pilot — 浏览器页面测试

通过 HTTP API + SSE 在浏览器执行 JS，用于查看页面状态、交互和验证功能。

## 首次配置（仅初次安装时执行）

### Vite 插件模式
1. 确认 vite-plugin-pilot 已安装：检查 package.json 是否包含 `vite-plugin-pilot`，如果没有则执行 `pnpm add -D vite-plugin-pilot`，并确认 vite.config.ts 的 plugins 数组中包含 `pilot()`
2. **语言环境检测**：分析项目语言环境，在 vite.config.ts 中配置 `pilot({ locale: 'zh' })` 或 `pilot({ locale: 'en' })`。判断依据：项目中的 UI 文本、README 语言、i18n 配置等。已有 `pilot({...})` 配置时只追加 `locale` 字段，不覆盖其他配置。默认 `zh`
3. **更新检查配置**：询问用户是否需要 CLI 自动检查 npm 新版本（默认开启）。如用户选择关闭，在 vite.config.ts 中配置 `pilot({ checkUpdate: false })`。已有 `pilot({...})` 配置时只追加 `checkUpdate` 字段
4. 确认 `.pilot` 已添加到 `.gitignore`（运行时数据目录，不应提交）

### 独立 Server 模式（不依赖 Vite）
1. 运行 `npx pilot server` 启动独立 HTTP server
2. 浏览器连接方式（任选一种）：
   - 复制 `.pilot/bridge.js` 内容到目标浏览器控制台执行
   - 安装 `.pilot/userscript.user.js` 到 Tampermonkey（自动在所有页面运行）
3. 连接后即可使用下方工作流中的所有命令

## 每次使用前检查

- Vite 插件模式：确认 dev server 已启动（检查是否有进程监听 vite 端口）
- 独立 Server 模式：确认 `npx pilot server` 已运行，浏览器已连接

## 工作流

```bash
npx pilot page                    # 查看页面状态（compact snapshot）
npx pilot run 'code'              # 执行 JS + 结果 + 日志 + 页面快照（默认全附带）
npx pilot run 'code' nopage       # 执行 JS + 结果 + 日志（不附带页面快照）
npx pilot run 'code' nologs       # 执行 JS + 结果 + 页面快照（不附带日志）
npx pilot run 'code' instance:abc # 指定目标实例（支持前缀模糊匹配）
npx pilot logs                    # 查看最近控制台日志
npx pilot status                  # 列出已连接的实例（含 type、url、title）
npx pilot server [port]           # 启动独立 HTTP server（不依赖 Vite）
npx pilot bridge                  # 输出 Console Bridge 脚本
npx pilot userscript              # 输出 Tampermonkey Userscript
npx pilot help                    # 查看辅助函数列表
```

**使用模式**：`run 'code'` 默认返回结果+日志+页面快照，一步即可看到完整信息。`page` 单独查看 compact snapshot。

**输出格式**：`run` 命令的输出按优先级排列：
1. `--- runcode ---` 执行的代码预览
2. 返回值（成功时）或 `ERROR:` 错误信息 + 修复建议 — agent 最关心的信息，紧跟 runcode
3. `--- exec logs ---` 执行期间的控制台日志（仅在有日志时输出）
4. `--- context logs ---` 执行前的上下文日志（仅在有 exec 日志时输出）
5. `--- page snapshot ---` 页面快照（默认附带，`nopage` 模式下 exec 失败时也自动附带帮助诊断）
6. `--- hint ---` 辅助函数提示（仅在检测到原生 DOM 操作且未使用过 `__pilot_` 函数时出现，使用一次后永久消失）

纯操作（如 `__pilot_clickByText("登录")`）无返回值时，不输出空的 undefined，直接跳到日志或快照。

**实例选择**：多个浏览器 tab 打开时，执行结果末尾会显示可用实例列表（`--- instances ---`），用 `←` 标记当前实例。每个实例有 type 标识（`[vite]` / `[console]` / `[userscript]`）、hostname label 和页面 title。切换实例用 `instance:xxx` 参数（支持前缀模糊匹配，如 `instance:1316` 匹配 `131646c7`）或 `PILOT_INSTANCE` 环境变量。`npx pilot status` 查看所有实例详情（含 type、url、title、lastSeen）。

## 辅助函数

以下函数在 `npx pilot run '...'` 中作为浏览器端 JS 执行，完整列表见 `npx pilot help`。

### 文本匹配（推荐，每次重新搜索 DOM，比索引更稳定）

| 函数 | 说明 |
|------|------|
| `__pilot_clickByText(text, nth?)` | 按文本点击元素 |
| `__pilot_dblclickByText(text, nth?)` | 按文本双击元素 |
| `__pilot_typeByPlaceholder(ph, value)` | 输入并按 Enter（触发 input 事件） |
| `__pilot_setValueByPlaceholder(ph, value, nth?)` | 设置输入框值（触发 input 事件，不触发 Enter） |
| `__pilot_selectValueByText(text, nth?)` | 选择下拉框选项 |
| `__pilot_checkByText(text, nth?)` | 勾选复选框 |
| `__pilot_uncheckByText(text, nth?)` | 取消勾选复选框 |
| `__pilot_checkMultipleByText([t1, t2, ...])` | 批量勾选多个复选框 |
| `__pilot_keydownByText(text, key)` | 在元素上触发按键 |
| `__pilot_findByText(text)` | 查找元素 → `[{idx, tag, text}]` |
| `__pilot_waitFor(text, timeout?, disappear?)` | 等待文本出现/消失 |
| `__pilot_waitEnabled(text, timeout?)` | 等待禁用元素变为可用 |

### 按索引（compact snapshot 中的 `#N`，适合精确操作）

| 函数 | 说明 |
|------|------|
| `__pilot_click(i)` | 点击元素 |
| `__pilot_dblclick(i)` | 双击元素 |
| `__pilot_type(i, v)` | 输入并按 Enter（触发 input 事件） |
| `__pilot_setValue(i, v)` | 设置值（触发 input 事件，不触发 Enter） |
| `__pilot_hover(i)` | 悬停元素 |
| `__pilot_scrollIntoView(i)` | 滚动到元素 |
| `__pilot_getRect(i)` | 获取元素位置和尺寸 |
| `__pilot_check(i)` | 勾选复选框 |
| `__pilot_uncheck(i)` | 取消勾选复选框 |

### 其他

| 函数 | 说明 |
|------|------|
| `__pilot_wait(ms)` | 等待毫秒 |
| `__pilot_snapshot()` | 获取完整 JSON 快照 |

**compact snapshot 格式**：`tag#idx[val=V][check=N][type=T][ph=P][disabled] text`
- `#idx` 是元素的序号，可直接传给 `__pilot_click(idx)` 等函数
- 交互元素（button/input/select/textarea）和有 id 的元素会显示 idx
- 带 `[disabled]` 标记的元素不可操作

## 关键注意

- **同一 exec 完成相关操作**（填写+提交），跨 exec Vue/React 状态可能丢失
- 多步操作间 `await __pilot_wait(0)` 让 Vue scheduler 处理响应式更新
- **始终用 `typeByPlaceholder`**：Vue/React v-model 需要 input 事件，`type` 触发 input 事件+Enter 键，`setValue` 触发 input 事件但不触发 Enter（表单填写推荐 `setValueByPlaceholder`）
- `npx pilot page cached` 读缓存（0.03s），不需要最新状态时用
- **clickByText 同名按钮**：多个 section 有同名按钮时（如多个"重置"），匹配 score 最高的（可能不是目标 section 的），应用 compact 中的 `#idx` 精确操作
- **clickByText + v-if 时序**：modal 未渲染时可能匹配到其他元素，先用 `await __pilot_waitFor("目标文本")` 等待渲染完成再点击
- **Vue checkbox**：始终用 `__pilot_checkByText`/`__pilot_uncheckByText`，不要手动设置 `el.checked`

## Element Inspector（Alt+Click）

默认开启。按住 Alt 键移动鼠标可高亮页面元素，Alt+Click 选中元素后弹出提示词面板：
- 显示选中元素的标签、组件名、源码位置
- 输入框中描述你想对元素做什么
- 点击「复制提示词」生成包含元素完整信息（标签、组件、源码、DOM路径、位置、文本、样式）的提示词
- 点击「发送给 Claude」直接推送到当前 Claude Code session（需 channel server）
- 操作后 8 秒倒计时自动关闭，输入时重置倒计时
- 弹窗存在时选中元素的高亮保持显示

**关闭 Element Inspector**：在 vite.config.ts 中设置 `pilot({ inspector: false })`

## Channel Server（浏览器直连 Claude Code）

浏览器中 Alt+Click 的提示词可直接发送到当前 Claude Code session。

> **前置条件**：Claude Code v2.1.80+、claude.ai 登录。Channel 功能处于 Research Preview，需 `--dangerously-load-development-channels server:pilot-channel` 启动。**注意：此功能未经作者实际验证，欢迎反馈。**

**架构**：
- **Channel 模式**：浏览器 Alt+Click → HTTP POST → pilot-channel (MCP Channel Server) → stdio → Claude Code session
- **降级模式**（始终可用）：浏览器 Alt+Click → HTTP POST → pilot-channel → `.pilot/channel-pending.txt` → UserPromptSubmit hook → Claude Code 自动附加

**首次配置**（skill 自动执行）：
1. 确认项目根目录存在 `.mcp.json`，内容如下（不存在则创建）：
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
2. 确认 `.claude/settings.local.json` 存在并包含 hook 配置（不存在则创建，已有 hooks 时合并）：
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

浏览器端「发送给 Claude」按钮会在 pilot-channel server 运行时自动可用（Claude Code 启动时通过 `.mcp.json` 自动拉起）。未连接时按钮自动禁用，「复制提示词」始终可用。
