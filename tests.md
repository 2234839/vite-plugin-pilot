# vite-plugin-pilot 测试用例

> 前置条件：`pnpm dev` 启动，浏览器打开 playground 页面（至少一个 tab）
> 自动测试：`npx tsx scripts/test.ts` 程序化执行
> Agent 参与：需要观察浏览器行为或手动验证的用例

## 多框架支持

测试脚本自动检测已连接的浏览器实例（Vue/React/HTML），对每个实例运行基础测试。
Vue playground 运行完整测试（功能最全）。

打开多个 tab 可同时测试多个框架：
- `http://localhost:5173/vue/` — Vue 3 playground（完整测试）
- `http://localhost:5173/react/` — React playground（基础 + React 特有测试）
- `http://localhost:5173/html/` — Vanilla JS playground（基础 + HTML 特有测试）

---

## Agent 参与的测试

### [Agent] 高亮动画
- 操作元素时，浏览器中显示蓝色虚线边框 + 四角角标锁定动画
- 动画 1.5s 后淡出消失

### [Agent] Alt+Click 元素检查
- 按住 Alt 键移动鼠标，元素高亮跟随
- Alt+Click 弹出提示词面板
- **Alt+组合键（Ctrl+Alt、Alt+Shift 等）不触发选择模式**

### [Agent] 页面自动 reload
- `pnpm build` 后浏览器自动刷新加载最新代码

### [Agent] 后台 tab 操作
- 切换到其他 tab 后，exec 仍可正常执行（setTimeout fallback）

---

## 自动测试（npx tsx scripts/test.ts）

### 通用基础测试（所有框架实例）

#### 1. CLI 基础命令
- page 返回 compact snapshot 含 # url: / # title:
- page cached 返回缓存版本

#### 2. 纯代码执行
- 1+1 返回 2
- document.title 返回页面标题
- await __pilot_wait(50); "done" 返回 done
- throw new Error 返回 ERROR
- void 0 不输出 undefined

#### 3. 文本匹配操作
- findByText 匹配和未找到

#### 4. 上下文聚焦
- 无操作时无 → 标记和 · 折叠
- 操作元素后 → 标记 + · 折叠（仅 Vue playground 元素足够多时出现）

#### 5. 错误处理
- 元素不存在 / idx 不存在
- exec 失败时自动附带 snapshot

#### 6. 输出格式
- runcode 行 / snapshot 头部 / nopage 无 snapshot

### Vue 完整测试

#### 7.1 CLI
- status 返回 JSON 含 instances 数组
- help 输出包含 __pilot_clickByText

#### 7.2 文本匹配
- clickByText / typeByPlaceholder / selectValueByText / checkByText / uncheckByText
- setValueByPlaceholder / checkMultipleByText / dblclickByText / keydownByText
- waitFor appear / disappear / waitEnabled / nth 越界

#### 7.3 索引操作
- click / setValue / getRect / scrollIntoView / hover

#### 7.4 上下文聚焦
- checkbox label 匹配 / 多操作多 → 标记

#### 7.5 错误处理
- disabled 元素

#### 7.6 复合操作
- 多步操作（setValueByPlaceholder + selectValueByText）

#### 7.7 响应式验证
- input val 更新（setValueByPlaceholder 后 compact snapshot 反映新值，验证 v-model 响应式更新）
- select check 更新（selectValueByText 后 compact snapshot 反映新选中项）
- checkbox check 更新（checkByText 后 compact snapshot 反映勾选状态）

#### 7.8 其他
- bridge / userscript 输出

### HTML playground 测试

#### 文本匹配
- clickByText(添加) / typeByPlaceholder / clickByText(面板 B)
- selectValueByText / checkByText / dblclickByText
- input 值更新（验证原生 JS 事件监听器正确触发）

#### 链接导航
- a 标签显示 href 路径（内部链接仅 pathname+hash，外部链接含 host）

### React playground 测试

#### 文本匹配
- clickByText(console.log) / dblclickByText
- input 响应式（setValueByPlaceholder 后 compact snapshot 反映新值）
- select 响应式（selectValueByText 后 compact snapshot 反映新选中项）
- checkbox 响应式（checkByText 后 compact snapshot 反映勾选状态）
