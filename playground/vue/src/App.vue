<template>
  <div class="app">
    <h1>Vite Plugin Pilot - Vue 3 Playground</h1>
    <p class="subtitle">Alt+Click 任意元素可选中并查看信息</p>

    <section class="card">
      <h2>测试功能</h2>
      <div class="btn-group">
        <button @click="logInfo">console.log</button>
        <button @click="logWarn">console.warn</button>
        <button @click="logError">console.error</button>
        <button @click="throwError">抛出异常</button>
        <button @click="rejectPromise">Promise 拒绝</button>
      </div>
    </section>

    <section class="card">
      <h2>组件测试</h2>
      <UserCard name="张三" role="前端工程师" email="zhangsan@example.com" />
      <UserCard name="李四" role="后端工程师" email="lisi@example.com" />
    </section>

    <section class="card">
      <h2>动态计数器</h2>
      <div class="btn-group">
        <button @click="count--">-</button>
        <span class="count">{{ count }}</span>
        <button @click="count++">+</button>
        <button @click="count = 0">重置</button>
      </div>
    </section>

    <section class="card">
      <h2>列表数据</h2>
      <div class="todo-input">
        <input v-model="searchQuery" placeholder="搜索任务..." />
        <button v-if="searchQuery" class="btn-clear" @click="searchQuery = ''">✕</button>
      </div>
      <ul>
        <li v-for="item in filteredItems" :key="item.id">
          {{ item.name }} - {{ item.status }}
        </li>
        <li v-if="filteredItems.length === 0" class="empty">无匹配结果</li>
      </ul>
    </section>

    <section class="card">
      <h2>秒表</h2>
      <div class="timer-display">{{ formatTime(elapsed) }}</div>
      <div class="btn-group">
        <button @click="toggleTimer">{{ timerRunning ? '暂停' : '开始' }}</button>
        <button @click="resetTimer">重置</button>
        <button @click="recordLap">计次</button>
      </div>
      <ul v-if="laps.length">
        <li v-for="(lap, i) in laps" :key="i">{{ i + 1 }}. {{ formatTime(lap) }}</li>
      </ul>
    </section>

    <section class="card">
      <h2>主题色</h2>
      <div class="color-picker">
        <div v-for="c in presetColors" :key="c" class="color-swatch" :style="{ background: c }" :class="{ active: accentColor === c }" @click="accentColor = c" />
        <input type="color" v-model="accentColor" class="color-input" />
      </div>
      <div class="color-preview" :style="{ borderColor: accentColor }">预览文字</div>
    </section>

    <section class="card">
      <h2>进度条</h2>
      <div class="progress-bar-wrap">
        <div class="progress-bar" :style="{ width: progress + '%' }"></div>
        <span class="progress-text">{{ progress }}%</span>
      </div>
      <div class="btn-group">
        <button @click="progress = Math.max(0, progress - 10)">-10</button>
        <button @click="progress = Math.min(100, progress + 10)">+10</button>
        <button @click="progress = 0">归零</button>
      </div>
    </section>

    <section class="card">
      <h2>Todo 输入</h2>
      <div class="todo-input">
        <input v-model="newTodo" placeholder="输入新任务..." @keyup.enter="addTodo" />
        <button @click="addTodo">添加</button>
      </div>
      <ul>
        <li
          v-for="(todo, index) in todos"
          :key="todo.id"
          class="todo-item"
          draggable="true"
          @dragstart="dragIndex = index"
          @dragover.prevent
          @drop="dropTodo(index)"
        >
          <span v-if="editingId !== todo.id" @dblclick="editingId = todo.id">{{ todo.text }}</span>
          <input v-else v-model="todo.text" @blur="editingId = null" @keyup.enter="editingId = null" class="edit-input" />
          <button class="btn-del" @click="removeTodo(todo.id)">x</button>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>标签页</h2>
      <div class="tab-bar">
        <button v-for="(tab, i) in tabs" :key="tab" class="tab-btn" :class="{ active: activeTab === i }" @click="switchTab(i)">{{ tab }}</button>
      </div>
      <div class="tab-content">
        <div v-if="activeTab === 0" class="tab-panel">这是「概览」面板，显示一些汇总信息。</div>
        <div v-if="activeTab === 1" class="tab-panel">这是「详情」面板，显示详细数据列表。</div>
        <div v-if="activeTab === 2" class="tab-panel">这是「设置」面板，可以调整偏好选项。</div>
      </div>
      <div v-if="tabHistory.length > 1" class="tab-history">
        切换记录: {{ tabHistory.map(i => tabs[i]).join(' → ') }}
        <button v-if="tabHistory.length > 1" @click="goBack" :disabled="tabHistory.length <= 1">后退</button>
      </div>
    </section>

    <section class="card">
      <h2>主题切换</h2>
      <button @click="isDark = !isDark">{{ isDark ? '切换亮色' : '切换暗色' }}</button>
    </section>

    <section class="card">
      <h2>模态对话框</h2>
      <button @click="showModal = true">打开弹窗</button>
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="modal-box">
          <h3>确认操作</h3>
          <p>这是一个模态对话框示例。点击遮罩层或取消按钮关闭。</p>
          <div class="btn-group">
            <button @click="showModal = false">取消</button>
            <button class="btn-confirm" @click="confirmModal">确认</button>
          </div>
        </div>
      </div>
      <div v-if="modalConfirmed" class="modal-status">已确认操作</div>
    </section>

    <section class="card">
      <h2>通知消息</h2>
      <div class="btn-group">
        <button @click="showToast('success', '操作成功')">成功通知</button>
        <button @click="showToast('error', '操作失败')">错误通知</button>
        <button @click="showToast('info', '提示信息')">信息通知</button>
      </div>
    </section>

    <section class="card">
      <h2>表单提交</h2>
      <div class="form-row">
        <input v-model="formData.name" placeholder="姓名" />
        <select v-model="formData.priority">
          <option value="low">低优先级</option>
          <option value="medium">中优先级</option>
          <option value="high">高优先级</option>
        </select>
      </div>
      <div class="form-row">
        <textarea v-model="formData.desc" placeholder="描述..." rows="2"></textarea>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" v-model="formData.agree" />
        我同意条款
      </label>
      <div class="tag-group">
        <label v-for="tag in availableTags" :key="tag" class="tag-label">
          <input type="checkbox" :value="tag" v-model="formData.tags" />
          {{ tag }}
        </label>
      </div>
      <div class="btn-group">
        <button @click="submitForm">提交</button>
        <button @click="resetForm">重置</button>
      </div>
      <div v-if="submitted" class="submit-result">
        {{ formData.name }} | {{ formData.priority }} | {{ formData.desc.slice(0, 20) }}{{ formData.desc.length > 20 ? '...' : '' }} | {{ formData.agree ? '已同意' : '未同意' }} | {{ formData.tags.length ? formData.tags.join(', ') : '无标签' }}
      </div>
    </section>

    <section class="card">
      <h2>键盘快捷键</h2>
      <p class="shortcut-hint">按键盘任意键查看捕获结果（Esc 清除）</p>
      <div v-if="lastKey" class="key-display">
        <span class="key-badge">{{ lastKey.key }}</span>
        <span class="key-detail">code={{ lastKey.code }} ctrl={{ lastKey.ctrl }} shift={{ lastKey.shift }}</span>
      </div>
    </section>

    <section class="card">
      <h2>折叠面板</h2>
      <div class="accordion">
        <div v-for="(item, i) in faqItems" :key="i" class="accordion-item">
          <button class="accordion-header" :class="{ open: openFaq === i }" @click="openFaq = openFaq === i ? -1 : i">
            {{ item.q }}
          </button>
          <div v-if="openFaq === i" class="accordion-body">{{ item.a }}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>密码强度</h2>
      <div class="pwd-input-wrap">
        <input v-model="password" placeholder="输入密码..." :type="showPassword ? 'text' : 'password'" class="pwd-input" />
        <button class="btn-toggle-pwd" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button>
      </div>
      <div class="strength-bar">
        <div class="strength-fill" :style="{ width: strengthPercent + '%' }" :class="'strength-' + strengthLevel"></div>
      </div>
      <div class="strength-text">{{ strengthLabel }}</div>
    </section>

    <section class="card">
      <h2>主题模式</h2>
      <div class="radio-group">
        <label v-for="opt in themeOptions" :key="opt.value" class="radio-label">
          <input type="radio" name="themeMode" :value="opt.value" v-model="themeMode" />
          {{ opt.label }}
        </label>
      </div>
      <div class="theme-preview" :class="'theme-' + themeMode">
        当前选择：{{ themeOptions.find(o => o.value === themeMode)?.label }}
      </div>
    </section>

    <section class="card">
      <h2>文件上传</h2>
      <div class="upload-zone" :class="{ active: isDragging }" @dragover.prevent="isDragging = true" @dragleave="isDragging = false" @drop.prevent="handleDrop">
        <template v-if="uploadedFile">
          <span class="file-icon">📄</span>
          <span class="file-name">{{ uploadedFile }}</span>
          <button class="btn-del" @click="uploadedFile = null">✕</button>
        </template>
        <template v-else>
          <span class="upload-hint">拖拽文件到此处或</span>
          <button @click="triggerUpload">选择文件</button>
        </template>
        <input ref="fileInput" type="file" class="hidden" @change="handleFileChange" accept=".txt,.md,.json,.csv" />
      </div>
    </section>

    <section class="card">
      <h2>数据表格</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th @click="sortTable('name')">姓名 {{ tableSort.field === 'name' ? (tableSort.asc ? '↑' : '↓') : '' }}</th>
            <th @click="sortTable('age')">年龄 {{ tableSort.field === 'age' ? (tableSort.asc ? '↑' : '↓') : '' }}</th>
            <th @click="sortTable('role')">角色</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sortedTableData" :key="row.id">
            <td>{{ row.name }}</td>
            <td>{{ row.age }}</td>
            <td>{{ row.role }}</td>
            <td><button class="btn-del" @click="removeTableRow(row.id)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <div class="table-form">
        <input v-model="newRow.name" placeholder="姓名" />
        <input v-model.number="newRow.age" placeholder="年龄" type="number" />
        <select v-model="newRow.role">
          <option value="前端">前端</option>
          <option value="后端">后端</option>
          <option value="设计">设计</option>
        </select>
        <button @click="addTableRow">添加</button>
      </div>
    </section>

    <section class="card">
      <h2>搜索过滤</h2>
      <div class="todo-input">
        <input v-model="filterText" placeholder="输入关键词过滤..." />
      </div>
      <div class="filter-tags">
        <span v-for="tag in filteredTags" :key="tag" class="filter-tag" :class="{ active: activeFilter === tag }" @click="activeFilter = activeFilter === tag ? '' : tag">{{ tag }}</span>
      </div>
      <p v-if="activeFilter" class="filter-hint">当前过滤：{{ activeFilter }}</p>
    </section>

    <section class="card">
      <h2>评论列表</h2>
      <div class="comment-form">
        <input v-model="newComment.author" placeholder="昵称" class="comment-author" />
        <textarea v-model="newComment.text" placeholder="写下你的评论..." rows="2" class="comment-textarea"></textarea>
        <button @click="addComment" :disabled="!newComment.text.trim()">发布评论</button>
      </div>
      <div class="comment-search">
        <input v-model="commentSearch" placeholder="搜索评论..." />
      </div>
      <ul class="comment-list">
        <li v-for="c in filteredComments" :key="c.id" class="comment-item">
          <div class="comment-header">
            <span class="comment-author">{{ c.author }}</span>
            <span class="comment-time">{{ c.time }}</span>
            <button v-if="c.pinned" class="btn-pin pinned" @click="c.pinned = false" title="取消置顶">📌</button>
            <button v-else class="btn-pin" @click="c.pinned = true" title="置顶">📌</button>
            <button class="btn-like" :class="{ liked: c.liked }" @click="c.liked = !c.liked">
              {{ c.liked ? '❤️' : '🤍' }} {{ c.likes }}
            </button>
            <button class="btn-del" @click="removeComment(c.id)">删除</button>
          </div>
          <p v-if="editingCommentId !== c.id" class="comment-body" @dblclick="editingCommentId = c.id">{{ c.text }}</p>
          <textarea v-else v-model="c.text" @blur="editingCommentId = null" @keyup.enter="editingCommentId = null" class="edit-input comment-edit" rows="2"></textarea>
        </li>
        <li v-if="filteredComments.length === 0" class="empty">暂无评论</li>
      </ul>
    </section>

    <section class="card">
      <h2>步骤导航</h2>
      <div class="step-bar">
        <div v-for="(step, i) in wizardSteps" :key="i" class="step-item" :class="{ active: wizardStep === i, done: wizardStep > i }">
          <div class="step-num">{{ wizardStep > i ? '✓' : i + 1 }}</div>
          <span class="step-label">{{ step }}</span>
        </div>
      </div>
      <div class="step-content">
        <div v-if="wizardStep === 0" class="step-panel">
          <p>选择你喜欢的编程语言：</p>
          <label v-for="lang in ['JavaScript', 'Python', 'Rust', 'Go']" :key="lang" class="radio-label">
            <input type="radio" :value="lang" v-model="wizardData.language" />
            {{ lang }}
          </label>
        </div>
        <div v-if="wizardStep === 1" class="step-panel">
          <p>选择你的经验等级：</p>
          <select v-model="wizardData.level">
            <option value="">请选择</option>
            <option value="junior">初级（1-2年）</option>
            <option value="mid">中级（3-5年）</option>
            <option value="senior">高级（5年以上）</option>
          </select>
        </div>
        <div v-if="wizardStep === 2" class="step-panel">
          <p>确认你的选择：</p>
          <div class="wizard-summary">
            <span>语言：{{ wizardData.language || '未选择' }}</span>
            <span>等级：{{ wizardData.level || '未选择' }}</span>
          </div>
        </div>
      </div>
      <div class="btn-group">
        <button @click="wizardStep = Math.max(0, wizardStep - 1)" :disabled="wizardStep === 0">上一步</button>
        <button @click="wizardStep = Math.min(wizardSteps.length - 1, wizardStep + 1)" :disabled="wizardStep === wizardSteps.length - 1">
          {{ wizardStep === wizardSteps.length - 1 ? '完成' : '下一步' }}
        </button>
      </div>
    </section>

    <section class="card">
      <h2>日期范围</h2>
      <div class="date-range">
        <input type="date" v-model="dateRange.start" placeholder="开始日期" class="date-input" />
        <span class="date-sep">→</span>
        <input type="date" v-model="dateRange.end" placeholder="结束日期" class="date-input" />
      </div>
      <div v-if="dateRange.start && dateRange.end" class="date-info">
        <span>开始：{{ dateRange.start }}</span>
        <span>结束：{{ dateRange.end }}</span>
        <span class="date-days">共 {{ dayCount }} 天</span>
      </div>
      <div class="btn-group">
        <button @click="setDateRange(7)">最近7天</button>
        <button @click="setDateRange(30)">最近30天</button>
        <button @click="setDateRange(90)">最近90天</button>
      </div>
    </section>

    <section class="card">
      <h2>拖拽排序</h2>
      <p class="shortcut-hint">拖拽列表项可调整顺序</p>
      <ul class="drag-list">
        <li
          v-for="(item, index) in dragItems"
          :key="item.id"
          class="drag-item"
          :class="{ dragging: dragSortIndex === index }"
          draggable="true"
          @dragstart="dragSortIndex = index"
          @dragover.prevent
          @drop="dropSortItem(index)"
        >
          <span class="drag-handle">⠿</span>
          <span>{{ item.name }}</span>
          <span class="drag-rank">#{{ index + 1 }}</span>
        </li>
      </ul>
      <div class="btn-group">
        <button @click="shuffleDragItems">随机打乱</button>
        <button @click="resetDragItems">重置顺序</button>
      </div>
    </section>

    <section class="card">
      <h2>星级评分</h2>
      <div class="star-rating">
        <span v-for="n in 5" :key="n" class="star" :class="{ active: n <= starRating }" @click="starRating = n">★</span>
        <span class="star-value">{{ starRating }} / 5</span>
      </div>
      <div class="slider-row">
        <input type="range" min="0" max="100" v-model.number="sliderValue" class="slider" />
        <span class="slider-val">{{ sliderValue }}</span>
      </div>
      <div class="slider-row">
        <input type="range" min="0" max="200" v-model.number="volume" class="slider volume" />
        <span class="slider-val">{{ volume }}%</span>
      </div>
    </section>

    <section class="card">
      <h2>数字计数</h2>
      <div class="number-counter">
        <button @click="numCount = Math.max(0, numCount - step)">-</button>
        <input v-model.number="numCount" type="number" min="0" class="num-input" />
        <button @click="numCount += step">+</button>
        <span class="num-step-label">步长:</span>
        <select v-model.number="step">
          <option :value="1">1</option>
          <option :value="5">5</option>
          <option :value="10">10</option>
          <option :value="100">100</option>
        </select>
        <button @click="numCount = 0">归零</button>
      </div>
      <div class="num-display">当前值: {{ numCount }}</div>
    </section>

    <section class="card">
      <h2>标签输入</h2>
      <div class="tag-input-wrap">
        <div class="tag-list">
          <span v-for="tag in tags" :key="tag" class="tag-item" :style="{ background: tagColor(tag) }">
            {{ tag }}
            <button class="tag-remove" @click="removeTag(tag)">x</button>
          </span>
          <input
            v-model="newTag"
            placeholder="输入标签后回车..."
            @keyup.enter="addTag"
            class="tag-input"
          />
        </div>
      </div>
      <div class="btn-group">
        <button @click="addPresetTags">添加预设标签</button>
        <button @click="tags = []">清空全部</button>
      </div>
    </section>

    <section class="card">
      <h2>条件渲染</h2>
      <div class="btn-group">
        <button @click="conditionType = conditionType === 'success' ? '' : 'success'">{{ conditionType === 'success' ? '隐藏成功' : '显示成功' }}</button>
        <button @click="conditionType = conditionType === 'error' ? '' : 'error'">{{ conditionType === 'error' ? '隐藏错误' : '显示错误' }}</button>
        <button @click="conditionType = conditionType === 'warning' ? '' : 'warning'">{{ conditionType === 'warning' ? '隐藏警告' : '显示警告' }}</button>
      </div>
      <div v-if="conditionType === 'success'" class="cond-msg cond-success">操作成功完成！</div>
      <div v-if="conditionType === 'error'" class="cond-msg cond-error">发生错误，请重试。</div>
      <div v-if="conditionType === 'warning'" class="cond-msg cond-warning">请注意，此操作不可撤销。</div>
      <div v-show="showExtra" class="cond-msg cond-info">这是额外信息（v-show 控制显隐）。</div>
      <button @click="showExtra = !showExtra">{{ showExtra ? '隐藏额外' : '显示额外' }}</button>
    </section>

    <section class="card">
      <h2>分页</h2>
      <ul class="pag-list">
        <li v-for="item in paginatedItems" :key="item.id">{{ item.name }} - {{ item.category }}</li>
      </ul>
      <div class="pag-info">第 {{ pagPage }} / {{ pagTotalPages }} 页，共 {{ allPagItems.length }} 条</div>
      <div class="btn-group">
        <button @click="pagPage = Math.max(1, pagPage - 1)" :disabled="pagPage <= 1">上一页</button>
        <button v-for="p in pagPageNumbers" :key="p" :class="{ active: p === pagPage }" @click="pagPage = p">{{ p }}</button>
        <button @click="pagPage = Math.min(pagTotalPages, pagPage + 1)" :disabled="pagPage >= pagTotalPages">下一页</button>
      </div>
      <div class="btn-group">
        <select v-model.number="pagPageSize">
          <option :value="3">每页3条</option>
          <option :value="5">每页5条</option>
          <option :value="10">每页10条</option>
        </select>
      </div>
    </section>

    <section class="card">
      <h2>字符统计</h2>
      <textarea v-model="charInput" placeholder="输入文本进行实时统计..." class="char-textarea"></textarea>
      <div class="char-stats">
        <span>字符: {{ charInput.length }}</span>
        <span>单词: {{ charInput.trim() ? charInput.trim().split(/\s+/).length : 0 }}</span>
        <span>行: {{ charInput ? charInput.split('\n').length : 0 }}</span>
        <span>字节: {{ charBytes }}</span>
      </div>
      <div class="btn-group">
        <button @click="charInput = ''">清空</button>
        <button @click="charInput = 'Hello World\n你好世界\n🎉 emoji test'">示例文本</button>
      </div>
    </section>

    <section class="card">
      <h2>剪贴板操作</h2>
      <textarea v-model="clipInput" placeholder="输入内容后点击按钮操作剪贴板..." class="char-textarea"></textarea>
      <div class="btn-group">
        <button @click="copyToClip">复制到剪贴板</button>
        <button @click="pasteFromClip">从剪贴板粘贴</button>
        <button @click="clipInput = ''">清空</button>
      </div>
      <div v-if="clipMsg" class="cond-msg" :class="'cond-' + clipMsgType">{{ clipMsg }}</div>
    </section>

    <section class="card">
      <h2>本地存储</h2>
      <div class="storage-grid">
        <div class="storage-item">
          <span class="storage-label">访问次数</span>
          <span class="storage-value">{{ visitCount }}</span>
        </div>
        <div class="storage-item">
          <span class="storage-label">上次访问</span>
          <span class="storage-value">{{ lastVisit }}</span>
        </div>
        <div class="storage-item">
          <span class="storage-label">自定义备注</span>
          <input v-model="customNote" placeholder="输入备注..." class="storage-input" />
        </div>
      </div>
      <div class="btn-group">
        <button @click="clearStorage">清除存储</button>
        <button @click="saveNote">保存备注</button>
      </div>
      <div v-if="storageMsg" class="cond-msg" :class="'cond-' + storageMsgType">{{ storageMsg }}</div>
    </section>

    <section class="card">
      <h2>亮度对比</h2>
      <div class="brightness-row">
        <span class="brightness-label">亮度 {{ brightness }}%</span>
        <input type="range" :min="20" :max="200" v-model.number="brightness" class="slider" />
      </div>
      <div class="contrast-grid">
        <div v-for="c in contrastColors" :key="c" class="contrast-swatch" :style="{ background: c, filter: 'brightness(' + (brightness / 100) + ')' }">
          <span>{{ c }}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>实时时钟</h2>
      <div class="clock-display">{{ clockTime }}</div>
      <div class="clock-date">{{ clockDate }}</div>
      <div class="btn-group">
        <button @click="clock24h = !clock24h">{{ clock24h ? '12小时制' : '24小时制' }}</button>
        <button @click="toggleClockRunning">{{ clockRunning ? '暂停' : '继续' }}</button>
      </div>
    </section>

    <section class="card">
      <h2>画板</h2>
      <div class="canvas-toolbar">
        <div class="color-picker">
          <div v-for="c in canvasColors" :key="c" class="color-swatch" :class="{ active: penColor === c }" :style="{ background: c }" @click="penColor = c" />
        </div>
        <select v-model.number="penSize">
          <option :value="2">细 (2px)</option>
          <option :value="4">中 (4px)</option>
          <option :value="8">粗 (8px)</option>
        </select>
        <button @click="clearCanvas">清除</button>
      </div>
      <canvas ref="canvasRef" class="draw-canvas" @mousedown="startDraw" @mousemove="drawing" @mouseup="stopDraw" @mouseleave="stopDraw" />
    </section>

    <div class="toast-container">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" :class="['toast', 'toast-' + t.type]">{{ t.message }}</div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import UserCard from './components/UserCard.vue'

const count = ref(0)
const progress = ref(50)
const accentColor = ref('#60a5fa')
const presetColors = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#a78bfa']

const items = ref([
  { id: 1, name: '任务 A', status: '进行中' },
  { id: 2, name: '任务 B', status: '已完成' },
  { id: 3, name: '任务 C', status: '待开始' },
])

const searchQuery = ref('')
const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return items.value
  return items.value.filter(item =>
    item.name.toLowerCase().includes(q) || item.status.toLowerCase().includes(q)
  )
})

function logInfo() {
  console.log('这是一条 info 日志', { timestamp: Date.now(), foo: 'bar' })
}

function logWarn() {
  console.warn('这是一条 warning 日志', 'deprecated API usage')
}

function logError() {
  console.error('这是一条 error 日志', new Error('测试错误'))
}

function throwError() {
  throw new Error('手动抛出的异常')
}

function rejectPromise() {
  Promise.reject(new Error('Promise 被拒绝了')).catch(() => {})
}

const newTodo = ref('')
const todos = ref<{ id: number; text: string }[]>([])
const editingId = ref<number | null>(null)
const dragIndex = ref<number | null>(null)

function dropTodo(targetIndex: number) {
  if (dragIndex.value === null || dragIndex.value === targetIndex) return
  const item = todos.value.splice(dragIndex.value, 1)[0]
  todos.value.splice(targetIndex, 0, item)
  dragIndex.value = null
}

function addTodo() {
  const text = newTodo.value.trim()
  if (!text) return
  todos.value.push({ id: Date.now(), text })
  newTodo.value = ''
}

function removeTodo(id: number) {
  todos.value = todos.value.filter(t => t.id !== id)
}

const timerRunning = ref(false)
const elapsed = ref(0)
const laps = ref<number[]>([])
let timerHandle: ReturnType<typeof setInterval> | null = null

function formatTime(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function toggleTimer() {
  if (timerRunning.value) {
    clearInterval(timerHandle!)
    timerHandle = null
    timerRunning.value = false
  } else {
    const start = Date.now() - elapsed.value
    timerHandle = setInterval(() => {
      elapsed.value = Date.now() - start
    }, 10)
    timerRunning.value = true
  }
}

function resetTimer() {
  if (timerRunning.value) toggleTimer()
  elapsed.value = 0
  laps.value = []
}

function recordLap() {
  if (elapsed.value > 0) laps.value.push(elapsed.value)
}

onUnmounted(() => {
  if (timerHandle) clearInterval(timerHandle)
})

const tabs = ['概览', '详情', '设置']
const activeTab = ref(0)
const tabHistory = ref<number[]>([0])

function switchTab(i: number) {
  if (i === activeTab.value) return
  tabHistory.value.push(i)
  activeTab.value = i
}

function goBack() {
  if (tabHistory.value.length <= 1) return
  tabHistory.value.pop()
  activeTab.value = tabHistory.value[tabHistory.value.length - 1]
}

const showModal = ref(false)
const modalConfirmed = ref(false)
const isDark = ref(true)

/** v18 测试：添加一个注释触发 HMR */

function confirmModal() {
  showModal.value = false
  modalConfirmed.value = true
}

type ToastType = 'success' | 'error' | 'info'
const toasts = ref<{ id: number; message: string; type: ToastType }[]>([])

function showToast(type: ToastType, message: string) {
  const id = Date.now()
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 2000)
}

const availableTags = ['Vue', 'TypeScript', 'Vite', 'Tailwind']
const formData = reactive({ name: '', priority: 'medium', desc: '', agree: false, tags: [] as string[] })
const submitted = ref(false)

function submitForm() {
  if (!formData.name.trim()) {
    showToast('error', '请填写姓名')
    return
  }
  submitted.value = true
  showToast('success', '表单已提交')
}

function resetForm() {
  formData.name = ''
  formData.priority = 'medium'
  formData.desc = ''
  formData.agree = false
  formData.tags = []
  submitted.value = false
}

/** 键盘快捷键捕获 */
const lastKey = ref<{ key: string; code: string; ctrl: boolean; shift: boolean } | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    lastKey.value = null
    return
  }
  lastKey.value = { key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/** 折叠面板 */
const faqItems = [
  { q: '如何添加任务？', a: '在输入框中输入任务名称，按 Enter 或点击"添加"按钮即可。' },
  { q: '如何编辑任务？', a: '双击任务文本进入编辑模式，修改后按 Enter 保存。' },
  { q: '如何删除任务？', a: '点击任务右侧的"x"按钮即可删除。' },
  { q: '密码强度如何计算？', a: '根据密码长度、大小写字母、数字和特殊字符综合评分，共 5 个等级。' },
]
const openFaq = ref(-1)

/** 文件上传 */
const uploadedFile = ref<string | null>(null)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
function triggerUpload() { fileInput.value?.click() }
function handleFileChange(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadedFile.value = f.name }
function handleDrop(e: DragEvent) { isDragging.value = false; const f = e.dataTransfer?.files?.[0]; if (f) uploadedFile.value = f.name }

/** 密码强度检测 */
const password = ref('')
const showPassword = ref(false)
const strengthLevel = computed(() => {
  const p = password.value
  if (!p) return 0
  let score = 0
  if (p.length >= 6) score++
  if (p.length >= 10) score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  return Math.min(score, 4)
})
const strengthPercent = computed(() => (strengthLevel.value / 4) * 100)
const strengthLabel = computed(() => ['极弱', '弱', '一般', '强', '极强'][strengthLevel.value])

/** 主题模式选择（radio group） */
const themeMode = ref<'auto' | 'light' | 'dark'>('auto')
const themeOptions = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色模式' },
  { value: 'dark', label: '深色模式' },
]

/** 数据表格 */
const tableData = ref([
  { id: 1, name: '张三', age: 28, role: '前端' },
  { id: 2, name: '李四', age: 32, role: '后端' },
  { id: 3, name: '王五', age: 25, role: '设计' },
])
const tableSort = reactive({ field: '', asc: true })
const newRow = reactive({ name: '', age: 0, role: '前端' })

const sortedTableData = computed(() => {
  const data = [...tableData.value]
  if (tableSort.field) {
    data.sort((a, b) => {
      const va = a[tableSort.field as keyof typeof a]
      const vb = b[tableSort.field as keyof typeof b]
      const cmp = typeof va === 'number' ? (va as number) - (vb as number) : String(va).localeCompare(String(vb))
      return tableSort.asc ? cmp : -cmp
    })
  }
  return data
})

function sortTable(field: string) {
  if (tableSort.field === field) {
    tableSort.asc = !tableSort.asc
  } else {
    tableSort.field = field
    tableSort.asc = true
  }
}

function addTableRow() {
  if (!newRow.name.trim()) return
  tableData.value.push({ id: Date.now(), name: newRow.name, age: newRow.age || 0, role: newRow.role })
  newRow.name = ''
  newRow.age = 0
  newRow.role = '前端'
}

function removeTableRow(id: number) {
  tableData.value = tableData.value.filter(r => r.id !== id)
}

/** 搜索过滤 */
const filterText = ref('')
const activeFilter = ref('')
const allTags = ['Vue', 'TypeScript', 'Vite', 'Tailwind', 'React', 'Svelte']
const filteredTags = computed(() => {
  const q = filterText.value.toLowerCase()
  if (!q) return allTags
  return allTags.filter(t => t.toLowerCase().includes(q))
})

/** 评论列表 */
interface Comment {
  id: number
  author: string
  text: string
  time: string
  likes: number
  liked: boolean
  pinned: boolean
}
const comments = ref<Comment[]>([
  { id: 1, author: '小明', text: '这个插件太好用了！', time: '2分钟前', likes: 5, liked: false, pinned: true },
  { id: 2, author: '小红', text: '期待更多功能更新', time: '10分钟前', likes: 3, liked: false, pinned: false },
  { id: 3, author: '开发者', text: '感谢反馈，我们会持续改进', time: '1小时前', likes: 1, liked: false, pinned: false },
])
const newComment = reactive({ author: '', text: '' })
const commentSearch = ref('')
const editingCommentId = ref<number | null>(null)
const filteredComments = computed(() => {
  const q = commentSearch.value.toLowerCase()
  if (!q) return comments.value
  return comments.value.filter(c => c.text.toLowerCase().includes(q) || c.author.toLowerCase().includes(q))
})
function addComment() {
  const text = newComment.text.trim()
  if (!text) return
  comments.value.unshift({
    id: Date.now(),
    author: newComment.author.trim() || '匿名',
    text,
    time: '刚刚',
    likes: 0,
    liked: false,
    pinned: false,
  })
  newComment.text = ''
}
function removeComment(id: number) {
  comments.value = comments.value.filter(c => c.id !== id)
}

/** 步骤导航 */
const wizardSteps = ['选择语言', '选择等级', '确认']
const wizardStep = ref(0)
const wizardData = reactive({ language: '', level: '' })

/** 日期范围选择 */
const dateRange = reactive({ start: '', end: '' })
const dayCount = computed(() => {
  if (!dateRange.start || !dateRange.end) return 0
  const d1 = new Date(dateRange.start)
  const d2 = new Date(dateRange.end)
  return Math.ceil((d2.getTime() - d1.getTime()) / 86400000)
})
function setDateRange(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days)
  dateRange.start = start.toISOString().slice(0, 10)
  dateRange.end = end.toISOString().slice(0, 10)
}

/** 拖拽排序 */
const INITIAL_DRAG_ITEMS = [
  { id: 1, name: '设计稿评审' },
  { id: 2, name: '前端开发' },
  { id: 3, name: '接口联调' },
  { id: 4, name: '测试验收' },
  { id: 5, name: '部署上线' },
]
const dragItems = ref(INITIAL_DRAG_ITEMS.map(i => ({ ...i })))
const dragSortIndex = ref<number | null>(null)

function dropSortItem(targetIndex: number) {
  if (dragSortIndex.value === null || dragSortIndex.value === targetIndex) return
  const item = dragItems.value.splice(dragSortIndex.value, 1)[0]
  dragItems.value.splice(targetIndex, 0, item)
  dragSortIndex.value = null
}

function shuffleDragItems() {
  const arr = [...dragItems.value]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  dragItems.value = arr
}

function resetDragItems() {
  dragItems.value = INITIAL_DRAG_ITEMS.map(i => ({ ...i }))
}

/** 星级评分 */
const starRating = ref(3)
const sliderValue = ref(50)
const volume = ref(75)

/** 数字计数 */
const numCount = ref(0)
const step = ref(10)

/** 标签输入 */
const TAG_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444']
const tags = ref<string[]>(['Vue', 'TypeScript'])
const newTag = ref('')

function tagColor(tag: string) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

function addTag() {
  const t = newTag.value.trim()
  if (!t || tags.value.includes(t)) return
  tags.value.push(t)
  newTag.value = ''
}

/** 条件渲染 */
const conditionType = ref('')
const showExtra = ref(false)

/** 字符统计 */
const charInput = ref('')
const charBytes = computed(() => new Blob([charInput.value]).size)

/** 剪贴板操作 */
const clipInput = ref('')
const clipMsg = ref('')
const clipMsgType = ref('success')

async function copyToClip() {
  try {
    await navigator.clipboard.writeText(clipInput.value)
    clipMsg.value = '已复制到剪贴板'
    clipMsgType.value = 'success'
  } catch {
    clipMsg.value = '复制失败（可能需要 HTTPS）'
    clipMsgType.value = 'error'
  }
  setTimeout(() => { clipMsg.value = '' }, 2000)
}

async function pasteFromClip() {
  try {
    clipInput.value = await navigator.clipboard.readText()
    clipMsg.value = '已从剪贴板粘贴'
    clipMsgType.value = 'success'
  } catch {
    clipMsg.value = '粘贴失败（可能需要 HTTPS 或用户授权）'
    clipMsgType.value = 'error'
  }
  setTimeout(() => { clipMsg.value = '' }, 2000)
}

function removeTag(tag: string) {
  tags.value = tags.value.filter(t => t !== tag)
}

function addPresetTags() {
  const presets = ['React', 'Svelte', 'Angular', 'Next.js', 'Nuxt']
  for (const p of presets) {
    if (!tags.value.includes(p)) tags.value.push(p)
  }
}

/** 分页 */
const allPagItems = ref([
  { id: 1, name: '项目 Alpha', category: '前端' },
  { id: 2, name: '项目 Beta', category: '后端' },
  { id: 3, name: '项目 Gamma', category: '设计' },
  { id: 4, name: '项目 Delta', category: '前端' },
  { id: 5, name: '项目 Epsilon', category: '测试' },
  { id: 6, name: '项目 Zeta', category: '后端' },
  { id: 7, name: '项目 Eta', category: '设计' },
  { id: 8, name: '项目 Theta', category: '前端' },
])
const pagPage = ref(1)
const pagPageSize = ref(3)
const pagTotalPages = computed(() => Math.ceil(allPagItems.value.length / pagPageSize.value))
const paginatedItems = computed(() => {
  const start = (pagPage.value - 1) * pagPageSize.value
  return allPagItems.value.slice(start, start + pagPageSize.value)
})
const pagPageNumbers = computed(() => {
  const pages: number[] = []
  for (let i = 1; i <= pagTotalPages.value; i++) pages.push(i)
  return pages
})

/** 本地存储 */
const visitCount = ref(0)
const lastVisit = ref('')
const customNote = ref('')
const storageMsg = ref('')
const storageMsgType = ref('success')

onMounted(() => {
  visitCount.value = parseInt(localStorage.getItem('pilot_visit_count') || '0', 10) + 1
  localStorage.setItem('pilot_visit_count', String(visitCount.value))
  const prevTime = localStorage.getItem('pilot_last_visit')
  lastVisit.value = prevTime ? new Date(prevTime).toLocaleString('zh-CN') : '首次访问'
  localStorage.setItem('pilot_last_visit', new Date().toISOString())
  customNote.value = localStorage.getItem('pilot_custom_note') || ''
})

function saveNote() {
  localStorage.setItem('pilot_custom_note', customNote.value)
  storageMsg.value = '备注已保存'
  storageMsgType.value = 'success'
  setTimeout(() => { storageMsg.value = '' }, 2000)
}

function clearStorage() {
  localStorage.removeItem('pilot_visit_count')
  localStorage.removeItem('pilot_last_visit')
  localStorage.removeItem('pilot_custom_note')
  visitCount.value = 0
  lastVisit.value = ''
  customNote.value = ''
  storageMsg.value = '存储已清除'
  storageMsgType.value = 'info'
  setTimeout(() => { storageMsg.value = '' }, 2000)
}

/** 亮度对比 */
const brightness = ref(100)
const contrastColors = ['#e2e8f0', '#0f172a', '#f87171', '#34d399', '#fbbf24', '#60a5fa']

/** 实时时钟 */
const clockRunning = ref(true)
const clock24h = ref(true)
const clockTime = ref('')
const clockDate = ref('')
let clockHandle: ReturnType<typeof setInterval> | null = null

function updateClock() {
  const now = new Date()
  clockTime.value = now.toLocaleTimeString('zh-CN', { hour12: !clock24h.value })
  clockDate.value = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function startClock() {
  updateClock()
  clockHandle = setInterval(updateClock, 1000)
}

function toggleClockRunning() {
  if (clockRunning.value) {
    if (clockHandle) { clearInterval(clockHandle); clockHandle = null }
  } else {
    startClock()
  }
  clockRunning.value = !clockRunning.value
}

onMounted(() => startClock())
onUnmounted(() => { if (clockHandle) clearInterval(clockHandle) })

/** 画板 */
const canvasRef = ref<HTMLCanvasElement | null>(null)
const penColor = ref('#e2e8f0')
const penSize = ref(4)
const canvasColors = ['#e2e8f0', '#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa']
let isDrawing = false

function initCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = canvas.offsetWidth * window.devicePixelRatio
  canvas.height = 200 * window.devicePixelRatio
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

function getCanvasPos(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function startDraw(e: MouseEvent) {
  isDrawing = true
  const ctx = canvasRef.value?.getContext('2d')
  if (!ctx) return
  const pos = getCanvasPos(e)
  ctx.beginPath()
  ctx.moveTo(pos.x, pos.y)
}

function drawing(e: MouseEvent) {
  if (!isDrawing) return
  const ctx = canvasRef.value?.getContext('2d')
  if (!ctx) return
  const pos = getCanvasPos(e)
  ctx.strokeStyle = penColor.value
  ctx.lineWidth = penSize.value
  ctx.lineTo(pos.x, pos.y)
  ctx.stroke()
}

function stopDraw() {
  isDrawing = false
}

function clearCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

onMounted(() => { initCanvas() })
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
.app { max-width: 640px; margin: 0 auto; padding: 2rem; }
h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
.subtitle { color: #94a3b8; margin-bottom: 1.5rem; font-size: 0.875rem; }
.card { background: #1e293b; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; border: 1px solid #334155; }
.card h2 { font-size: 1rem; margin-bottom: 0.75rem; color: #60a5fa; }
.btn-group { display: flex; gap: 0.5rem; flex-wrap: wrap; }
button { padding: 0.5rem 1rem; border: 1px solid #475569; border-radius: 6px; background: #334155; color: #e2e8f0; cursor: pointer; font-size: 0.875rem; }
button:hover { background: #475569; }
button.active { background: #60a5fa; border-color: #60a5fa; color: #0f172a; }
.count { display: inline-block; min-width: 3rem; text-align: center; font-size: 1.5rem; font-weight: bold; line-height: 2.2; color: #60a5fa; }
ul { list-style: none; }
li { padding: 0.5rem 0; border-bottom: 1px solid #334155; }
li:last-child { border-bottom: none; }
li.empty { color: #64748b; font-style: italic; text-align: center; padding: 1rem 0; }
.todo-item { display: flex; align-items: center; justify-content: space-between; }
.btn-del { padding: 2px 8px; font-size: 0.75rem; opacity: 0.5; }
.btn-del:hover { opacity: 1; background: #ef4444; border-color: #ef4444; }
.edit-input { flex: 1; padding: 2px 6px; border: 1px solid #60a5fa; border-radius: 4px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.todo-item.dragging { opacity: 0.5; }
.todo-input { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.todo-input input { flex: 1; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.todo-input input:focus { outline: none; border-color: #60a5fa; }
.btn-clear { padding: 0.5rem 0.6rem; border: 1px solid #475569; border-radius: 6px; background: #334155; color: #94a3b8; cursor: pointer; font-size: 0.75rem; }
.timer-display { font-size: 2rem; font-weight: bold; font-family: monospace; text-align: center; padding: 1rem 0; color: #60a5fa; }
.color-picker { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.color-swatch { width: 28px; height: 28px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s; }
.color-swatch.active { border-color: #fff; }
.color-input { width: 28px; height: 28px; border: none; padding: 0; cursor: pointer; background: none; border-radius: 4px; }
.color-preview { margin-top: 0.75rem; padding: 0.75rem; border: 2px solid; border-radius: 6px; text-align: center; font-size: 0.875rem; transition: border-color 0.2s; }
.progress-bar-wrap { position: relative; height: 24px; background: #0f172a; border-radius: 12px; overflow: hidden; margin-bottom: 0.75rem; }
.progress-bar { height: 100%; background: linear-gradient(90deg, #60a5fa, #a78bfa); border-radius: 12px; transition: width 0.3s; }
.progress-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.75rem; font-weight: bold; color: #e2e8f0; }
.tab-bar { display: flex; gap: 0; margin-bottom: 0.75rem; border-bottom: 1px solid #334155; }
.tab-btn { padding: 0.5rem 1rem; border: none; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: #94a3b8; cursor: pointer; transition: color 0.15s, background 0.15s; }
.tab-btn:hover { color: #cbd5e1; background: rgba(255,255,255,0.04); }
.tab-btn.active { color: #e2e8f0; border-bottom-color: #60a5fa; background: rgba(96,165,250,0.08); font-weight: 500; }
.tab-content { padding: 0.5rem 0; }
.tab-panel { padding: 0.75rem; background: #0f172a; border-radius: 6px; font-size: 0.875rem; color: #94a3b8; }
.tab-history { margin-top: 0.5rem; font-size: 0.75rem; color: #64748b; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.tab-history button { font-size: 0.75rem; padding: 2px 8px; }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-box { background: #1e293b; border-radius: 12px; padding: 1.5rem; max-width: 400px; width: 90%; border: 1px solid #334155; }
.modal-box h3 { margin-bottom: 0.75rem; }
.modal-box p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1rem; }
.modal-status { margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: #064e3b; border-radius: 6px; color: #34d399; font-size: 0.875rem; }
.upload-zone { border: 2px dashed #475569; border-radius: 8px; padding: 1.25rem; text-align: center; transition: all 0.2s; }
.upload-zone.active { border-color: #60a5fa; background: rgba(96,165,250,0.05); }
.upload-zone .file-icon { font-size: 2rem; }
.upload-zone .file-name { font-size: 0.875rem; color: #e2e8f0; margin: 0 0.5rem; display: block; }
.upload-zone .upload-hint { color: #64748b; font-size: 0.8rem; }
.upload-zone button { margin-top: 0.5rem; }
.upload-zone .btn-del { position: static; margin-left: 0.5rem; }
.hidden { display: none; }
.btn-confirm { background: #60a5fa; border-color: #60a5fa; color: #0f172a; }
.toast-container { position: fixed; top: 1rem; right: 1rem; z-index: 2000; display: flex; flex-direction: column; gap: 0.5rem; }
.toast { padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.875rem; color: #fff; animation: toast-in 0.3s; }
.toast-success { background: #065f46; border: 1px solid #34d399; }
.toast-error { background: #7f1d1d; border: 1px solid #f87171; }
.toast-info { background: #1e3a5f; border: 1px solid #60a5fa; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(2rem); }
.pwd-input-wrap { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.pwd-input-wrap .pwd-input { margin-bottom: 0; }
.btn-toggle-pwd { padding: 0.5rem 0.75rem; white-space: nowrap; }
.pwd-input { width: 100%; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; box-sizing: border-box; }
.strength-bar { height: 6px; background: #334155; border-radius: 3px; overflow: hidden; margin-bottom: 0.25rem; }
.strength-fill { height: 100%; border-radius: 3px; transition: width 0.3s, background 0.3s; }
.strength-0 { background: #ef4444; }
.strength-1 { background: #f97316; }
.strength-2 { background: #eab308; }
.strength-3 { background: #22c55e; }
.strength-4 { background: #06b6d4; }
.strength-text { font-size: 0.75rem; color: #94a3b8; }
.form-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.form-row input, .form-row select, textarea { flex: 1; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.form-row input:focus, .form-row select:focus, textarea:focus { outline: none; border-color: #60a5fa; }
textarea { width: 100%; resize: vertical; }
.checkbox-label { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.875rem; cursor: pointer; }
.checkbox-label input { accent-color: #60a5fa; }
.tag-group { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.tag-label { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.75rem; border: 1px solid #475569; border-radius: 999px; font-size: 0.8rem; color: #94a3b8; cursor: pointer; }
.tag-label input { accent-color: #60a5fa; }
.tag-label:has(input:checked) { border-color: #60a5fa; color: #60a5fa; }
.radio-group { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.radio-label { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.75rem; border: 1px solid #475569; border-radius: 999px; font-size: 0.8rem; color: #94a3b8; cursor: pointer; }
.radio-label:has(input:checked) { border-color: #60a5fa; color: #60a5fa; background: rgba(96,165,250,0.08); }
.theme-preview { margin-top: 0.75rem; padding: 0.75rem; border: 1px solid #334155; border-radius: 6px; font-size: 0.875rem; color: #94a3b8; transition: all 0.2s; }
.theme-light { background: #f8fafc; color: #1e293b; border-color: #60a5fa; }
.theme-dark { background: #0f172a; color: #e2e8f0; border-color: #60a5fa; }
.theme-auto { background: linear-gradient(135deg, #f8fafc 50%, #0f172a 50%); border-color: #60a5fa; }
.submit-result { margin-top: 0.75rem; padding: 0.75rem; background: #064e3b; border-radius: 6px; color: #34d399; font-size: 0.875rem; word-break: break-all; }
.shortcut-hint { color: #94a3b8; font-size: 0.75rem; margin-bottom: 0.75rem; }
.key-display { display: flex; align-items: center; gap: 0.75rem; }
.key-badge { display: inline-block; padding: 0.5rem 1rem; background: #334155; border: 1px solid #60a5fa; border-radius: 8px; font-family: monospace; font-size: 1.25rem; color: #60a5fa; min-width: 3rem; text-align: center; }
.key-detail { color: #94a3b8; font-size: 0.75rem; font-family: monospace; }
.accordion-item { border: 1px solid #334155; border-radius: 6px; margin-bottom: 0.5rem; overflow: hidden; }
.accordion-header { width: 100%; padding: 0.75rem 1rem; background: #334155; border: none; color: #e2e8f0; cursor: pointer; font-size: 0.875rem; text-align: left; display: flex; justify-content: space-between; align-items: center; }
.accordion-header.open { background: #60a5fa22; color: #60a5fa; }
.accordion-header::after { content: '+'; font-size: 1.1rem; transition: transform 0.2s; }
.accordion-header.open::after { content: '−'; }
.accordion-body { padding: 0.75rem 1rem; color: #94a3b8; font-size: 0.875rem; background: #0f172a; border-top: 1px solid #334155; }
.filter-tags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
.filter-tag { padding: 0.25rem 0.75rem; border: 1px solid #475569; border-radius: 999px; font-size: 0.8rem; color: #94a3b8; cursor: pointer; transition: all 0.2s; }
.filter-tag.active { border-color: #60a5fa; color: #60a5fa; background: rgba(96,165,250,0.08); }
.data-table { width: 100%; border-collapse: collapse; margin-bottom: 0.75rem; font-size: 0.875rem; }
.data-table th, .data-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #334155; }
.data-table th { color: #94a3b8; font-weight: 500; cursor: pointer; user-select: none; }
.data-table th:hover { color: #60a5fa; }
.data-table td button { padding: 2px 8px; font-size: 0.75rem; }
.table-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.table-form input, .table-form select { padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.table-form input:focus, .table-form select:focus { outline: none; border-color: #60a5fa; }
.table-form input[type="number"] { width: 5rem; }
.filter-hint { color: #60a5fa; font-size: 0.75rem; margin-top: 0.5rem; }
.comment-form { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
.comment-form input { padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.comment-form input:focus { outline: none; border-color: #60a5fa; }
.comment-textarea { width: 100%; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; resize: vertical; box-sizing: border-box; }
.comment-textarea:focus { outline: none; border-color: #60a5fa; }
.comment-search { margin-bottom: 0.75rem; }
.comment-search input { width: 100%; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; box-sizing: border-box; }
.comment-search input:focus { outline: none; border-color: #60a5fa; }
.comment-list { list-style: none; }
.comment-item { padding: 0.75rem 0; border-bottom: 1px solid #334155; }
.comment-item:last-child { border-bottom: none; }
.comment-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; font-size: 0.8rem; }
.comment-author { font-weight: 500; color: #60a5fa; }
.comment-time { color: #64748b; font-size: 0.75rem; }
.comment-body { color: #cbd5e1; font-size: 0.875rem; line-height: 1.5; }
.btn-pin { background: none; border: none; cursor: pointer; font-size: 0.9rem; opacity: 0.4; padding: 0 0.25rem; }
.btn-pin.pinned { opacity: 1; }
.btn-like { background: none; border: 1px solid #475569; border-radius: 999px; padding: 0.1rem 0.5rem; cursor: pointer; font-size: 0.75rem; color: #e2e8f0; }
.btn-like.liked { border-color: #f472b6; background: rgba(244,114,182,0.1); }
.comment-edit { width: 100%; min-height: 2.5rem; }
.date-range { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
.date-input { padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.date-input:focus { outline: none; border-color: #60a5fa; }
.date-sep { color: #64748b; }
.date-info { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; padding: 0.75rem; background: #0f172a; border-radius: 6px; font-size: 0.875rem; color: #94a3b8; }
.date-days { color: #60a5fa; font-weight: bold; }
.step-bar { display: flex; gap: 0; margin-bottom: 1rem; }
.step-item { display: flex; align-items: center; gap: 0.5rem; flex: 1; position: relative; }
.step-item:not(:last-child)::after { content: ''; flex: 1; height: 2px; background: #334155; margin: 0 0.5rem; }
.step-item.done:not(:last-child)::after { background: #34d399; }
.step-num { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; border: 2px solid #475569; color: #94a3b8; flex-shrink: 0; }
.step-item.active .step-num { border-color: #60a5fa; color: #60a5fa; }
.step-item.done .step-num { border-color: #34d399; background: #34d399; color: #0f172a; }
.step-label { font-size: 0.75rem; color: #94a3b8; }
.step-item.active .step-label { color: #60a5fa; }
.step-item.done .step-label { color: #34d399; }
.step-content { padding: 0.75rem; background: #0f172a; border-radius: 6px; margin-bottom: 0.75rem; min-height: 80px; }
.step-panel p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 0.75rem; }
.step-panel .radio-group { margin-top: 0.25rem; }
.step-panel select { width: 100%; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; }
.wizard-summary { display: flex; flex-direction: column; gap: 0.5rem; }
.wizard-summary span { font-size: 0.875rem; color: #e2e8f0; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
.drag-list { list-style: none; margin-bottom: 0.75rem; }
.drag-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; border: 1px solid #334155; border-radius: 6px; margin-bottom: 0.4rem; background: #0f172a; cursor: grab; transition: all 0.2s; }
.drag-item:hover { border-color: #60a5fa; }
.drag-item.dragging { opacity: 0.4; border-color: #60a5fa; background: rgba(96,165,250,0.05); }
.drag-handle { color: #64748b; font-size: 1.1rem; user-select: none; }
.drag-rank { margin-left: auto; color: #64748b; font-size: 0.75rem; font-family: monospace; }
.star-rating { display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.75rem; }
.star { font-size: 1.5rem; color: #475569; cursor: pointer; transition: color 0.15s; }
.star.active { color: #fbbf24; }
.star-value { margin-left: 0.75rem; font-size: 0.875rem; color: #94a3b8; }
.slider-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.slider { flex: 1; accent-color: #60a5fa; }
.slider.volume { accent-color: #34d399; }
.slider-val { min-width: 3rem; font-size: 0.875rem; color: #94a3b8; font-family: monospace; }
.tag-input-wrap { margin-bottom: 0.75rem; }
.number-counter { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.num-input { width: 80px; text-align: center; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; padding: 0.4rem; font-size: 1rem; }
.num-step-label { font-size: 0.8rem; color: #94a3b8; }
.num-display { margin-top: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
.tag-list { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; }
.tag-item { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.5rem; border-radius: 999px; font-size: 0.8rem; color: #fff; }
.tag-remove { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 0.7rem; padding: 0 0.15rem; line-height: 1; }
.tag-remove:hover { color: #fff; }
.tag-input { border: none; outline: none; background: none; color: #e2e8f0; font-size: 0.8rem; min-width: 6rem; flex: 1; }
.tag-input::placeholder { color: #64748b; }
.cond-msg { padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; margin-bottom: 0.5rem; }
.cond-success { background: #064e3b; color: #34d399; }
.cond-error { background: #7f1d1d; color: #f87171; }
.cond-warning { background: #78350f; color: #fbbf24; }
.cond-info { background: #1e3a5f; color: #60a5fa; }
.pag-list { list-style: none; margin-bottom: 0.5rem; max-height: 150px; overflow-y: auto; }
.pag-list li { padding: 0.4rem 0; border-bottom: 1px solid #334155; font-size: 0.875rem; }
.pag-info { color: #94a3b8; font-size: 0.75rem; margin-bottom: 0.5rem; }
.pag-list .btn-group button { min-width: 2rem; padding: 0.4rem 0.6rem; text-align: center; }
.char-textarea { width: 100%; min-height: 80px; padding: 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.875rem; resize: vertical; box-sizing: border-box; margin-bottom: 0.5rem; }
.char-textarea:focus { outline: none; border-color: #60a5fa; }
.char-stats { display: flex; gap: 1rem; margin-bottom: 0.75rem; font-size: 0.8rem; color: #94a3b8; flex-wrap: wrap; }
.char-stats span { padding: 0.2rem 0.5rem; background: #0f172a; border-radius: 4px; }
.storage-grid { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
.storage-item { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; background: #0f172a; border-radius: 6px; }
.storage-label { font-size: 0.875rem; color: #94a3b8; }
.storage-value { font-size: 0.875rem; color: #e2e8f0; font-family: monospace; }
.storage-input { padding: 0.4rem 0.5rem; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 0.8rem; width: 14rem; box-sizing: border-box; }
.storage-input:focus { outline: none; border-color: #60a5fa; }
.brightness-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.brightness-label { font-size: 0.875rem; color: #94a3b8; min-width: 5rem; }
.contrast-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 0.75rem; }
.contrast-swatch { height: 2.5rem; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: filter 0.2s; }
.contrast-swatch span { font-size: 0.7rem; color: #94a3b8; }
.clock-display { font-size: 2.5rem; font-weight: bold; font-family: monospace; text-align: center; padding: 0.75rem 0; color: #60a5fa; letter-spacing: 0.05em; }
.clock-date { font-size: 0.875rem; color: #94a3b8; text-align: center; margin-bottom: 0.75rem; }
.canvas-toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.draw-canvas { width: 100%; height: 200px; border: 1px solid #334155; border-radius: 6px; background: #0f172a; cursor: crosshair; display: block; }
</style>
