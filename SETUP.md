# vite-plugin-pilot — 自动配置指南

你是 AI Agent（Claude Code、Cursor、Windsurf、Cline 等），请按照以下步骤为用户项目配置 vite-plugin-pilot。

## 步骤 1：安装插件

检查项目是否已安装 vite-plugin-pilot：
- 检查 `package.json` 的 `devDependencies` 是否包含 `vite-plugin-pilot`
- 如果没有，执行 `pnpm add -D vite-plugin-pilot`（或 `npm install -D vite-plugin-pilot`）

检查 Vite 配置是否已包含插件：
- 检查 `vite.config.ts`（或 `vite.config.js`）的 `plugins` 数组是否包含 `pilot()`
- 如果没有，在文件顶部添加 `import { pilot } from 'vite-plugin-pilot'`，并在 plugins 数组中添加 `pilot()`
- 如果已有 `pilot({...})` 配置，不要覆盖已有字段

## 步骤 2：配置插件选项

**语言环境**：分析项目语言环境（UI 文本、README 语言、i18n 配置等），在 vite.config.ts 中追加 `locale` 字段：
- 中文项目：`pilot({ locale: 'zh' })`
- 英文项目：`pilot({ locale: 'en' })`
- 默认 `zh`，已有配置时只追加字段不覆盖

**更新检查**：默认开启 CLI 自动检查 npm 新版本。如用户选择关闭，追加 `checkUpdate: false`。

## 步骤 3：确保 .gitignore 包含 .pilot

检查项目根目录的 `.gitignore` 是否包含 `.pilot`（运行时数据目录，不应提交），如果没有则添加。

## 步骤 4：将使用指南写入项目指令文件

**这是最关键的一步**：在你自己的项目指令文件中追加 pilot 使用指南，让未来的会话自动获得浏览器测试能力。

例如 Claude Code 写入 `CLAUDE.md`，Cursor 写入 `.cursorrules`，其他 agent 写入对应的指令文件。

读取文件现有内容，在末尾追加以下内容（不要覆盖已有内容）：

````markdown
## 浏览器测试（vite-plugin-pilot）

已安装。`npx pilot run '代码'` 执行 JS（返回运行时日志+快照）、`npx pilot page` 页面状态
`npx pilot help`  查看pilot所有功能
常用：`__pilot_clickByText("文本")` 点击、`__pilot_typeByPlaceholder("提示文字", "值")` 输入、`__pilot_waitFor("文本")` 等待、`__pilot_findByText("文本")` 查找。snapshot 中 `#N` 是元素索引。
多 tab 时用 `npx pilot status` 查看实例列表，`npx pilot run '代码' instance:前缀` 指定目标实例（支持 ID 前缀模糊匹配）。
````

**重要**：不要删除或覆盖文件中的已有内容，只追加。

## 步骤 5：启动 dev server 并验证

1. 启动 dev server（`pnpm dev` 或 `npm run dev`）
2. 在浏览器中打开页面
3. 执行 `npx pilot status` 确认浏览器已连接
4. 执行 `npx pilot page` 确认能看到页面快照

全部完成后告诉用户：配置完成，现在可以通过 `/pilot` 或 `npx pilot` 命令测试浏览器页面了。

## 步骤 6（可选）：配置浏览器直连 Claude Code

**跳过条件**：如果用户未使用 Claude Code，或不需要浏览器 Alt+Click 直接推送消息给 agent，跳过此步骤。

此功能让用户在浏览器中 Alt+Click 元素后，可直接将提示词推送到 Claude Code session，无需手动复制粘贴。

> **前置条件**：Claude Code v2.1.80+、claude.ai 登录。Channel 功能处于 Research Preview。**注意：此功能未经作者实际验证，欢迎反馈。**

1. 安装 Channel Server 所需的依赖（`pilot-channel.js` 依赖 `@modelcontextprotocol/sdk`，为避免影响包体积，该依赖未内置）：
```bash
pnpm add @modelcontextprotocol/sdk
```

2. 在项目根目录创建或更新 `.mcp.json`：
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

3. 在 `.claude/settings.local.json` 中添加 hook 配置（降级模式，如已有 hooks 则合并，不要覆盖）：
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

配置后启动 Claude Code 时加 `--dangerously-load-development-channels server:pilot-channel`。浏览器 Alt+Click 面板中的「发送给 Claude」按钮会自动检测 channel server 是否运行，未连接时自动禁用。
