---
name: pilot
description: 通过 vite-plugin-pilot 在浏览器中测试页面。当需要查看页面状态、与页面元素交互、验证前端功能时使用。前置条件：vite-plugin-pilot 已安装且 dev server 已启动。
---

# vite-plugin-pilot — 浏览器页面测试

通过文件 I/O 在浏览器执行 JS，用于查看页面状态、交互和验证功能。

## 首次配置（仅初次安装时执行）

1. 确认 vite-plugin-pilot 已安装：检查 package.json 是否包含 `vite-plugin-pilot`，如果没有则执行 `pnpm add -D vite-plugin-pilot`，并确认 vite.config.ts 的 plugins 数组中包含 `pilot()`
2. **语言环境检测**：分析项目语言环境，在 vite.config.ts 中配置 `pilot({ locale: 'zh' })` 或 `pilot({ locale: 'en' })`。判断依据：项目中的 UI 文本、README 语言、i18n 配置等。已有 `pilot({...})` 配置时只追加 `locale` 字段，不覆盖其他配置。默认 `zh`
3. 确认 `.pilot` 已添加到 `.gitignore`（运行时数据目录，不应提交）

## 每次使用前检查

- 确认 dev server 已启动（检查是否有进程监听 vite 端口）

## 工作流

```bash
npx pilot page                    # 查看页面状态（compact snapshot）
npx pilot run 'code'              # 执行 JS + 结果 + 日志 + 页面快照（默认全附带）
npx pilot run 'code' nopage       # 执行 JS + 结果 + 日志（不附带页面快照）
npx pilot run 'code' nologs       # 执行 JS + 结果 + 页面快照（不附带日志）
npx pilot logs                    # 查看最近控制台日志
npx pilot status                  # 列出已连接的浏览器 tab
npx pilot help                    # 查看辅助函数列表
```

**使用模式**：`run 'code'` 默认返回结果+日志+页面快照，一步即可看到完整信息。`page` 单独查看 compact snapshot。

## 辅助函数

以下函数在 `npx pilot run '...'` 中作为浏览器端 JS 执行，完整列表见 `npx pilot help`。

**文本匹配**（推荐）：`__pilot_clickByText(t,n)` `__pilot_typeByPlaceholder(p,v)` `__pilot_findByText(t)` `__pilot_waitFor(t,timeout,disappear)` `__pilot_waitEnabled(t,timeout)`
**按索引**：`__pilot_click(i)` `__pilot_setValue(i,v)` `__pilot_type(i,v)` `__pilot_dblclick(i)`

## 关键注意

- **同一 exec 完成相关操作**（填写+提交），跨 exec Vue/React 状态可能丢失
- 多步操作间 `await __pilot_wait(0)` 让 Vue scheduler 处理响应式更新
- **始终用 `typeByPlaceholder`**：Vue/React v-model 需要 input 事件
- `npx pilot page cached` 读缓存（0.03s），不需要最新状态时用

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

通过 Claude Code Channels API，浏览器中 Alt+Click 的提示词可直接推送到当前 Claude Code session（主动推送，非轮询）。

**架构**：浏览器 Alt+Click → HTTP POST → pilot-channel（MCP stdio）→ Claude Code session

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
2. 提示用户：使用 channel server 时需以 `claude --dangerously-load-development-channels server:pilot-channel` 启动 Claude Code。如果用户不使用 Alt+Click 推送功能，可以忽略此步骤。注意说明以下启动方式：
   - **CLI**：直接在终端运行上述命令
   - **VSCode 集成终端**：在 VSCode 终端中运行上述命令（推荐，同时享受 IDE 集成和 channel 推送）
   - **VSCode 图形面板**：需配置 `claudeProcessWrapper` 创建 wrapper 脚本注入 `--dangerously-load-development-channels server:pilot-channel` 参数，并在 settings 中设置 `"claudeCode.useTerminal": false`

浏览器端「发送给 Claude」按钮会在 channel server 运行时自动可用，未启动时显示「未连接」。
