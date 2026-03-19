---
name: pilot
description: 通过 vite-plugin-pilot 在浏览器中测试页面。当需要查看页面状态、与页面元素交互、验证前端功能时使用。前置条件：vite-plugin-pilot 已安装且 dev server 已启动。
---

# vite-plugin-pilot — 浏览器页面测试

通过文件 I/O 在浏览器执行 JS，用于查看页面状态、交互和验证功能。

## 前置检查

1. 确认 vite-plugin-pilot 已安装：检查 package.json 是否包含 `vite-plugin-pilot`，如果没有则执行 `pnpm add -D vite-plugin-pilot`，并确认 vite.config.ts 的 plugins 数组中包含 `pilot()`
2. 确认 dev server 已启动（检查是否有进程监听 vite 端口）

## 工作流

```bash
npx pilot page                    # 查看页面状态（compact snapshot）
npx pilot run 'code' page         # 执行 JS + 查看结果 + 页面状态（一步完成，推荐）
npx pilot run 'code' logs         # 执行 JS + 查看结果 + 控制台日志
npx pilot logs                    # 查看最近控制台日志
npx pilot status                  # 列出已连接的浏览器 tab
npx pilot help                    # 查看辅助函数列表
```

**使用模式**：`page` 查看 compact snapshot → 读取 `#idx` 或用文本匹配定位元素 → `run '操作代码' page` 执行并验证 → 重复直到完成。优先用 `run 'code' page`（一步完成，避免两次轮询延迟）。

## 辅助函数

以下函数在 `npx pilot run '...'` 中作为浏览器端 JS 执行，完整列表见 `npx pilot help`。

**文本匹配**（推荐）：`__pilot_clickByText(t,n)` `__pilot_typeByPlaceholder(p,v)` `__pilot_findByText(t)` `__pilot_waitFor(t,timeout,disappear)` `__pilot_waitEnabled(t,timeout)`
**按索引**：`__pilot_click(i)` `__pilot_setValue(i,v)` `__pilot_type(i,v)` `__pilot_dblclick(i)`

## 关键注意

- **同一 exec 完成相关操作**（填写+提交），跨 exec Vue/React 状态可能丢失
- 多步操作间 `await __pilot_wait(0)` 让 Vue scheduler 处理响应式更新
- **始终用 `typeByPlaceholder`**：Vue/React v-model 需要 input 事件
- `npx pilot page cached` 读缓存（0.03s），不需要最新状态时用
