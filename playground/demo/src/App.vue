<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import Terminal from './Terminal.vue'

const isDev = typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
const frameRef = ref<HTMLIFrameElement>()
const pilotReady = ref(false)
const autoDemoRunning = ref(false)

/**
 * iframe 加载完成后检查 pilot 客户端是否可用
 * dev 模式：pilot 插件自动注入，直接可用
 * static 模式：需要动态注入 pilot-client.js
 */
function onFrameLoad() {
  const frame = frameRef.value
  if (!frame?.contentWindow) return

  /** dev 模式下 pilot 插件已注入 */
  if ((frame.contentWindow as any).__pilot_snapshot) {
    pilotReady.value = true
    return
  }

  /** static 模式下动态注入 pilot-client.js */
  const script = frame.contentDocument?.createElement('script')
  if (!script) return
  script.src = '../pilot-client.js'
  script.onload = () => {
    pilotReady.value = true
  }
  frame.contentDocument.head.appendChild(script)
}

/** 重置 iframe */
function resetFrame() {
  pilotReady.value = false
  if (frameRef.value) {
    frameRef.value.src = frameRef.value.src
  }
}

function onAutoDemoChange(running: boolean) {
  autoDemoRunning.value = running
}
</script>

<template>
  <div class="demo-root">
    <!-- 顶部 Header -->
    <header class="demo-header">
      <div class="header-left">
        <h1 class="header-title">vite-plugin-pilot</h1>
        <span class="header-subtitle">AI Agent Browser Automation</span>
      </div>
      <div class="header-right">
        <a class="header-link" href="https://github.com/2234839/vite-plugin-pilot" target="_blank">
          GitHub
        </a>
        <a class="header-link" href="https://www.npmjs.com/package/vite-plugin-pilot" target="_blank">
          npm
        </a>
      </div>
    </header>

    <!-- iframe 区域：嵌入 Vue playground -->
    <main class="demo-main">
      <div class="frame-wrapper">
        <div v-if="!pilotReady" class="frame-loading">
          <div class="loading-spinner" />
          <span>Loading playground...</span>
        </div>
        <!--
          dev 模式：/vue/ 由 playground vite server 提供（含 pilot 注入）
          static 模式：./vue-app/index.html 由 build:demo 编译生成
        -->
        <iframe
          ref="frameRef"
          :src="isDev ? '/vue/' : './vue-app/index.html'"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          class="playground-frame"
          @load="onFrameLoad"
        />
      </div>
    </main>

    <!-- 浮动终端 -->
    <Terminal
      :frame="frameRef"
      :pilot-ready="pilotReady"
      :auto-demo-running="autoDemoRunning"
      @update:auto-demo-running="onAutoDemoChange"
      @reset="resetFrame"
    />
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0a0a0a;
  color: #e5e5e5;
  overflow: hidden;
  height: 100vh;
}

#app {
  height: 100vh;
}
</style>

<style scoped>
.demo-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.demo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: #111;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  font-family: 'JetBrains Mono', monospace;
}

.header-subtitle {
  font-size: 13px;
  color: #666;
}

.header-right {
  display: flex;
  gap: 16px;
}

.header-link {
  font-size: 13px;
  color: #888;
  text-decoration: none;
  transition: color 0.15s;
}

.header-link:hover {
  color: #3b82f6;
}

.demo-main {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.frame-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}

.frame-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #555;
  font-size: 14px;
  z-index: 10;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #333;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.playground-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}
</style>
