# vite-plugin-pilot

辅助 AI agent 测试浏览器页面。支持两种运行模式：**Vite 插件模式**（自动注入客户端代码）和**独立 Server 模式**（不依赖 Vite，连接任意网页）。CLI 优先使用 HTTP API（低延迟），自动 fallback 到文件通道。

## 运行模式

### Vite 插件模式（推荐）
`pnpm dev` 启动，浏览器打开页面即可使用。客户端代码通过 Vite 自动注入。修改 src/ 后执行 `pnpm build`，build 脚本更新 `.pilot/inject-bundle.txt`，middleware 检测 version.txt 变化后推送 SSE reload 事件，浏览器自动刷新加载最新代码。Vite 进程不会重启。

### 独立 Server 模式
不依赖 Vite，通过 bridge.js 或 userscript 连接任意网页（包括线上页面）。

```bash
npx pilot server [port]   # 启动独立 HTTP server（默认 5173）
# 然后将 .pilot/bridge.js 粘贴到目标浏览器控制台执行
# 或安装 .pilot/userscript.user.js 到 Tampermonkey
```

## 工作流

```bash
npx pilot page                    # 看页面（compact 格式）
npx pilot run '代码'              # 操作+看结果+日志+页面快照（默认全附带）
npx pilot run '代码' nopage       # 操作+看结果+日志（不附带页面快照）
npx pilot run '代码' nologs       # 操作+看结果+页面快照（不附带日志）
npx pilot run '代码' instance:abc # 指定目标实例（支持前缀模糊匹配）
npx pilot instance:abc page       # instance 可放在任意位置
npx pilot logs                    # 看最近日志
npx pilot status                  # 查看连接的实例列表（含 type、url、title）
npx pilot bridge                  # 输出 Console Bridge 脚本（粘贴到任意浏览器控制台）
npx pilot userscript              # 输出 Tampermonkey Userscript（安装后自动连接）
npx pilot server [port]           # 启动独立 HTTP server（不依赖 Vite）
npx pilot help                    # 查看辅助函数列表
PILOT_INSTANCE=xxxxxxxx npx pilot page  # 指定目标 tab
```

**使用模式**：`run '代码'` 默认返回结果+日志+页面快照，agent 一步即可看到完整信息。`page` 单独看 compact 快照。

**实例选择**：多个 tab 打开时，输出末尾显示可用实例（`--- instances ---`），用 `instance:xxx`（支持前缀模糊匹配）或 `PILOT_INSTANCE` 切换。实例有 type 标识（`[vite]`/`[console]`/`[userscript]`）、hostname label 和 title。

**关键注意**：
- **同一 exec 完成相关操作**（填写+提交），跨 exec Vue/React 状态可能丢失
- 多步操作间 `await __pilot_wait(0)` 让 Vue scheduler 处理响应式更新
- **始终用 `typeByPlaceholder`**：Vue/React v-model 需要 input 事件，`type` 触发 input 事件+Enter 键，`setValue` 触发 input 事件但不触发 Enter（表单填写推荐 `setValueByPlaceholder`）
- `page cached` 读缓存（0.03s），不需要最新状态时用

## 开发维护

当前项目通过 npm OIDC 发布：git tag vx.x.x && git push --tags 即可通过 github actions 来发布 npm 包，不需要本地执行npm命令发布

**发版流程（严格遵守顺序）**：
1. 更新 `package.json` 中的 `version` 字段
2. 提交代码：`git commit`
3. 打 tag（版本号必须与 package.json 一致）：`git tag v{version}`
4. 推送：`git push --tags origin master`
5. **禁止**在 package.json 版本号未更新的情况下打 tag

## 项目结构

src/         源码（TypeScript）
src/bin/     CLI 入口（编译到 dist/bin/pilot.js）
scripts/     构建后处理脚本（write-inject-bundle.mjs）
dist/        编译产物
bin/         辅助脚本（channel hook 等）
playground/  用于测试当前插件效果的游乐场前端
