# vite-plugin-pilot — 自动配置指南

你是 AI Agent（Claude Code、Cursor、Windsurf、Cline 等），请按照以下步骤为用户项目配置 vite-plugin-pilot。

## 步骤 1：安装插件

检查项目是否已安装 vite-plugin-pilot：
- 检查 `package.json` 的 `devDependencies` 是否包含 `vite-plugin-pilot`
- 如果没有，执行 `pnpm add -D vite-plugin-pilot`（或 `npm install -D vite-plugin-pilot`）

检查 Vite 配置是否已包含插件：
- 检查 `vite.config.ts`（或 `vite.config.js`）的 `plugins` 数组是否包含 `pilot()`
- 如果没有，在文件顶部添加 `import pilot from 'vite-plugin-pilot'`，并在 plugins 数组中添加 `pilot()`
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

使用 vite-plugin-pilot 操控浏览器页面进行测试。已安装并配置。

- `npx pilot run '代码'` — 执行 JS 并获取结果+日志+页面快照
- `npx pilot page` — 查看页面状态
- `npx pilot status` — 查看已连接的实例

详见 https://raw.githubusercontent.com/2234839/vite-plugin-pilot/master/SKILL.md
````

**重要**：不要删除或覆盖文件中的已有内容，只追加。

## 步骤 5：启动 dev server 并验证

1. 启动 dev server（`pnpm dev` 或 `npm run dev`）
2. 在浏览器中打开页面
3. 执行 `npx pilot status` 确认浏览器已连接
4. 执行 `npx pilot page` 确认能看到页面快照

全部完成后告诉用户：配置完成，现在可以通过 `/pilot` 或 `npx pilot` 命令测试浏览器页面了。
