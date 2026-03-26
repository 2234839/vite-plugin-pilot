# vite-plugin-pilot 测试用例

> 前置条件：playground 页面已打开（`pnpm dev` 启动，浏览器打开 /vue/）
> 自动测试：`npx tsx scripts/test.ts` 程序化执行
> Agent 参与：需要观察浏览器行为或手动验证的用例

---

## Agent 参与的测试

### [Agent] 高亮动画
- 操作元素时，浏览器中显示蓝色虚线边框 + 四角角标锁定动画
- 动画 1.5s 后淡出消失

### [Agent] Alt+Click 元素检查
- 按住 Alt 键移动鼠标，元素高亮跟随
- Alt+Click 弹出提示词面板

### [Agent] 页面自动 reload
- `pnpm build` 后浏览器自动刷新加载最新代码

### [Agent] 后台 tab 操作
- 切换到其他 tab 后，exec 仍可正常执行（setTimeout fallback）

---

## 自动测试（npx tsx scripts/test.ts）

### 1. CLI 基础命令
- status 返回 JSON 含 instances 数组
- help 输出包含 __pilot_clickByText
- page 返回 compact snapshot 含 # url: / # title:
- page cached 返回缓存版本

### 2. 纯代码执行
- 1+1 返回 2
- document.title 返回页面标题
- await __pilot_wait(50); "done" 返回 done
- throw new Error 返回 ERROR
- void 0 不输出 undefined

### 3. 文本匹配操作
- clickByText / typeByPlaceholder / selectValueByText / checkByText / uncheckByText
- findByText 匹配和未找到
- setValueByPlaceholder（不触发 Enter）
- checkMultipleByText
- dblclickByText / keydownByText
- waitFor appear / disappear
- waitEnabled
- nth 越界

### 4. 索引操作
- click / setValue / getRect / scrollIntoView / hover
- idx 不存在返回 not found

### 5. 上下文聚焦（v144）
- 操作元素 → 标记 + · 折叠
- checkbox/radio label 匹配
- 无操作时完整 snapshot
- 多操作多 → 标记
- nopage 无 snapshot

### 6. 错误处理
- 元素不存在 / disabled / 索引越界
- exec 失败时自动附带 snapshot

### 7. 输出格式
- runcode 行 / page snapshot 段 / snapshot 头部

### 8. 复合操作
- 多步操作（setValueByPlaceholder + selectValueByText）

### 9. 其他
- bridge / userscript 输出
