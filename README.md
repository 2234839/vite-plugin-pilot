/loop 自我进化指令

思路：一切操作皆文件
多个浏览器页面实例会有多个log文件对应不同的实例
写入不同的文件即可在对应的页面实例执行js
让 agent 可以使用bash命令一次性完成执行 js 和 查看执行日志（即一次tool call）

优化 CLAUDE.md 文件，使用最少的指令来让 agent 积极熟练的使用此插件自行完成用户的任务

用本插件开发 playground（dogfooding）注意，不仅仅要测试 vue react 还要测试纯 html js 的程序（但是注意优化方向不要特化于playground中的场景，咱们是一个通用插件），反正是一切能够使用 vite 开发的前端程序，在实际使用中发现不顺手的地方即为优化目标。优化后写 `docs/optimization-v{N}.md` 报告。dev server 和浏览器已就绪，直接开始，不要问。不要纸上谈兵，每一步都要实际执行并验证。
