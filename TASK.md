给 agent 使用的辅助开发插件

## pilot 开发

/loop 先检查 TASK.md 中是否有未完成的任务请逐项完成并在充分test验证再继续下一项，如果没有则请请完善当前项目：然后分析一下项目中还有没什么地方可以像sse这种极大提高用户体验的（不会像轮询一样污染调试工具网络面板），请直接执行，不要询问我，不要进入计划模式,修改完毕后需要进行实际运行测试，请自我完善，不要询问我任何事情，也不要切换其他模式（例如 plan mode），我已经在浏览器打开了playground页面，所以任何改动都需要你使用自身进行实际测试，确保pilot非常好用而且没有任何问题
使用咱们插件的人 肯定要频繁重启 dev server的，所以不用考虑太多的旧客户端的向后兼容
修改代码后记得同步更新对应的文档

## TASKS

[x]没有必要对存活的实例做上限数量限制
[x]检测npm插件新版本，每天一次异步检查，CLI输出中附带更新提示（修复semver比较bug）
[x]Console Bridge：生成可粘贴到任意浏览器控制台执行的 JS 脚本，建立 SSE 连接到 dev server，支持跨域（CORS 自动开启）。`pilot bridge` 命令输出脚本，`.pilot/bridge.js` 自动生成。console: 前缀实例与 Vite 注入的 tab 隔离，跳过版本检查和 reload（防止注入代码丢失）。
[x]要不还是换个思路吧，咱们配置一个项目级的插件，然后在用户输入提示词的时候，将之前通过网页发送过来的指令叠在一起发出去，你看这作为一种claude Channel不能使用的降级方案的话有可行性没有？
[x]claude Channel 是需要帐号在研究预览列表中才能使用，这个目前还是不方便使用，我觉得可以探索一下  https://code.claude.com/docs/en/remote-control#enable-remote-control-for-all-sessions
[x]多语言应该让 skill 根据项目情况自行分析然后配置中文还是英文
[x]Channel Server机制好像不太行，配置项目级 claude code 插件可以来实现这个功能吗，然后让 skill 在首次安装时自行配置
[x]咱们的开发工具要考虑语言环境，无论是从生成的文本还是复制的提示词或者ui界面文本，都要考虑这个语言环境，这个语言环境本身也是在vite中配置的，配置它是什么语言，目前主要支持中英双语。
[x]因为我看alt键选中元素之后点击在弹窗那个选中元素的这个这种就是虚线高亮的这个效果怎么就还是消失了呢，我希望就是在弹窗期间那个效果一直存在
[x]我有一个新的想法，如果说我给你集成了那个claude sdk，然后如果用户在编辑这个项目的时候，他也选择使用的是claude code，那么你是不是就能够就是说实现用户在浏览器里面他用alt键点击元素，然后你弹出用户输入提示词，他点击发送，你就可以直接直接在本地就执行，嗯就是也不能说是你直接调用claude sdk执行吧，还是说你能不能使用claude sdk然后相当于说用户他本身跑了一个对话在这里能够就是将以用户的身份再发一条新的对话消息出去这个能实现吗？

## 已完成的工作

- 实例目录自动清理：过期 5 分钟的实例自动删除目录（无数量上限）
- CLI 实例不活跃时输出警告和可用实例列表
- Alt+Click 元素后弹出输入框+复制按钮，生成包含元素信息的提示词供 agent 使用
- 修复 WSL2 环境下 referer 缺失导致 active-instance.json 不写入的问题
- 弹窗期间元素高亮保持显示（panelOpen 标志位）
- Channel Server：浏览器 Alt+Click 提示词可直接推送到 Claude Code session（零依赖 MCP stdio 协议）
- 语言环境支持：`pilot({ locale: 'en' })` 切换中英文 UI（默认 zh）
- 多语言自动检测：SKILL.md 指导 skill 在首次配置时根据项目语言环境自动设置 locale
- Channel Server 项目级配置：通过 .mcp.json 自动注册 MCP server，skill 首次配置时自动创建
- Channel Server 降级方案：UserPromptSubmit hook 自动附加浏览器消息到用户下次输入（无需 Channels API）
- CLI HTTP 优先模式：`pilot run/page/logs` 优先通过 HTTP API 通信（~10-50ms），HTTP 不可用时自动 fallback 到文件通道
- SSE 心跳：服务端每 30s 发送 ping 事件，防止代理/防火墙静默断开空闲连接
- npm 版本检查：CLI 每天一次异步检查新版本，有更新时输出提示（3s 超时，非阻塞）
