import type { ResolvedPilotOptions } from '../types'
import { logCollectorCode } from '../client/log-collector'
import { snapshotCode } from '../client/snapshot'

/**
 * 生成 Tampermonkey/Greasemonkey 兼容的 userscript
 *
 * 与 bridge.ts 的区别：
 * - 使用 GM_xmlhttpRequest 替代 fetch/EventSource（绕过页面 CSP 限制）
 * - HTTP 轮询替代 SSE 接收代码推送
 * - 包含 ==UserScript== 元数据头，可直接安装到油猴
 * - server origin 硬编码为默认值，用户可在脚本顶部修改
 */

/** 替换所有占位符 */
function replacePlaceholders(code: string, options: ResolvedPilotOptions, pilotVersion: string): string {
  return code
    .replace(/__MAX_BUFFER_SIZE__/g, String(options.maxBufferSize))
    .replace(/__FLUSH_INTERVAL__/g, String(options.flushInterval))
    .replace(/__EXEC_TIMEOUT__/g, String(options.execTimeout))

    .replace(/__PILOT_VERSION__/g, pilotVersion)
    .replace(/__LOCALE_SELECTED__/g, '')
    .replace(/__LOCALE_TEXT__/g, '')
    .replace(/__LOCALE_EMPTY__/g, '')
    .replace(/__LOCALE_PLACEHOLDER__/g, '')
    .replace(/__LOCALE_SEND_TO_CLAUDE__/g, '')
    .replace(/__LOCALE_COPY_PROMPT__/g, '')
    .replace(/__LOCALE_CLOSE__/g, '')
    .replace(/__LOCALE_CLOSE_IN__/g, '')
    .replace(/__LOCALE_COPIED__/g, '')
    .replace(/__LOCALE_COPY_MANUAL__/g, '')
    .replace(/__LOCALE_SENDING__/g, '')
    .replace(/__LOCALE_SENT__/g, '')
    .replace(/__LOCALE_SEND_FAILED__/g, '')
    .replace(/__LOCALE_NOT_CONNECTED__/g, '')
    .replace(/__LOCALE_ELEMENT_INFO__/g, '')
    .replace(/__LOCALE_TAG__/g, '')
    .replace(/__LOCALE_COMPONENT__/g, '')
    .replace(/__LOCALE_SOURCE__/g, '')
    .replace(/__LOCALE_DOM_PATH__/g, '')
    .replace(/__LOCALE_POSITION__/g, '')
    .replace(/__LOCALE_TEXT_CONTENT__/g, '')
    .replace(/__LOCALE_STYLE__/g, '')
    .replace(/__PILOT_INSTANCE_TYPE__/g, "'userscript'")
}

/** userscript 专用的通信层：优先 SSE（EventSource），fallback 到 GM_xmlhttpRequest 轮询 */
const userscriptClientCode = `
(function() {
  window.__pilot_gen = (window.__pilot_gen || 0) + 1;
  var myGen = window.__pilot_gen;

  var execTimeout = __EXEC_TIMEOUT__;

  var serverOrigin = window.__PILOT_SERVER_ORIGIN__;

  function serializeResult(val) {
    var str;
    if (val === undefined) str = 'undefined';
    else if (val === null) str = 'null';
    else if (typeof val === 'function') str = '[Function: ' + (val.name || 'anonymous') + ']';
    else if (typeof val === 'string') str = val;
    else { try { str = JSON.stringify(val, null, 2); } catch(e) { str = String(val); } }
    return str;
  }

  function makeResult(code, result, success, error, logsSinceExec) {
    return {
      code: code,
      result: success ? serializeResult(result) : undefined,
      success: success,
      error: error || undefined,
      logs: logsSinceExec && logsSinceExec.length > 0 ? logsSinceExec : undefined
    };
  }

  /** 当前 exec 专属的显式日志队列指针。exec 开始时置为新数组，grace 窗口结束后置 null（关闭接收） */
  var currentExecLogs = null;

  /** 构造绑定到 currentExecLogs 的 log 函数，作为 IIFE 形参注入用户代码。
   *  每次调用：实时 push 到当前 exec 队列（主通道），同时打到 console（保持开发者可见 + 触发 log-collector 兜底拦截） */
  function makeExecLog() {
    return function log() {
      /** exec 已结束且 grace 窗口已过，丢弃（防延后回调污染或泄漏） */
      if (!currentExecLogs) return;
      var stringify = window.__pilot_stringify;
      var msg = stringify
        ? Array.prototype.map.call(arguments, stringify).join(' ')
        : Array.prototype.join.call(arguments, ' ');
      currentExecLogs.push('[log] ' + msg);
      try { console.log.apply(console, arguments); } catch(e) {}
    };
  }

  /** 合并两路日志：console 拦截（getLogsSince）+ 显式 log() 队列。按时序拼接，不去重 */
  function collectLogs(logStartIdx, execLogs) {
    var consoleLogs = getLogsSince(logStartIdx);
    if (execLogs && execLogs.length > 0) {
      return consoleLogs.concat(execLogs);
    }
    return consoleLogs;
  }

  var LOG_NOISE = ['[Vue warn]', '[vite]', '[COSE]', '[Pilot] Running'];

  function getLogsSince(idx) {
    if (!window.__pilot_logs) return [];
    var newLogs = window.__pilot_logs.slice(idx);
    return newLogs
      .filter(function(l) {
        for (var ni = 0; ni < LOG_NOISE.length; ni++) {
          if (l.message.indexOf(LOG_NOISE[ni]) !== -1) return false;
        }
        return true;
      })
      .map(function(l) {
        var msg = window.__pilot_logToMessage(l);
        if (l.type !== 'error' && msg.length > 150) {
          var cutIdx = msg.indexOf('\\n');
          msg = cutIdx > 0 && cutIdx < 150 ? msg.slice(0, cutIdx) : msg.slice(0, 150) + '...';
        }
        return '[' + l.type + '] ' + msg;
      });
  }

  function execCode(code) {
    /** 重置本次 exec 的显式日志队列 */
    currentExecLogs = [];
    /** 闭包捕获本次队列引用：grace 回调只读 myLogs，防止 exec 交叉污染 */
    var myLogs = currentExecLogs;
    var logStartIdx = window.__pilot_logs ? window.__pilot_logs.length : 0;
    /** grace 窗口：IIFE settle 后再等 N ms，收集 setTimeout/Promise.then 等延后回调产生的日志 */
    var grace = 300;
    var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    /** 统一走 async IIFE：用户代码作为 AsyncFunction 函数体，log 作为形参注入。
     *  函数体天然支持顶层 return 和 await，无需启发式 return 注入 */
    return new Promise(function(resolve) {
      var settled = false;
      /** timeout 不含 grace：代码卡死超时立即失败，不等 grace */
      var timeoutId = setTimeout(function() {
        if (settled) return; settled = true;
        currentExecLogs = null;
        resolve(makeResult(code, undefined, false, 'Execution timeout after ' + execTimeout + 'ms', collectLogs(logStartIdx, myLogs)));
      }, execTimeout);

      try {
        var fn = new AsyncFunction('log', code);
        fn(makeExecLog()).then(function(result) {
          if (settled) return;
          clearTimeout(timeoutId);
          /** grace 窗口：等待延后回调的 log()/console.log 落盘 */
          setTimeout(function() {
            if (settled) return; settled = true;
            currentExecLogs = null;
            resolve(makeResult(code, result, true, undefined, collectLogs(logStartIdx, myLogs)));
          }, grace);
        }).catch(function(e) {
          if (settled) return;
          clearTimeout(timeoutId);
          /** 出错也走 grace 窗口：错误发生后的回调日志同样有价值 */
          setTimeout(function() {
            if (settled) return; settled = true;
            currentExecLogs = null;
            resolve(makeResult(code, undefined, false, e.message || String(e), collectLogs(logStartIdx, myLogs)));
          }, grace);
        });
      } catch(e) {
        /** SyntaxError 等 new AsyncFunction 构造期错误 */
        if (settled) return; settled = true;
        clearTimeout(timeoutId);
        currentExecLogs = null;
        resolve(makeResult(code, undefined, false, e.message || String(e), collectLogs(logStartIdx, myLogs)));
      }
    });
  }

  /** 发送结果：GM_xmlhttpRequest POST */
  function sendResult(result) {
    var payload = JSON.stringify(result);
    GM_xmlhttpRequest({
      method: 'POST',
      url: serverOrigin + '/__pilot/result?instance=' + unsafeWindow.__pilot_instanceId,
      headers: { 'Content-Type': 'application/json' },
      data: payload,
      timeout: 10000
    });
  }

  var isExecuting = false;
  var pendingCode = null;

  function handleCode(code) {
    if (isExecuting) {
      pendingCode = code;
      return;
    }
    isExecuting = true;
    try {
      var result = execCode(code);

      /** 立即发送结果（不等待 snapshot），确保结果不会因 rAF/snapshot 问题丢失 */
      function doSend(result) {
        try {
          sendResult(result);
        } catch(e) {
          console.error('[Pilot] sendResult error:', e);
        }
        isExecuting = false;
        if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
      }

      if (result && typeof result.then === 'function') {
        result.then(function(r) { doSend(r); });
      } else {
        doSend(result);
      }
    } catch(e) {
      console.error('[Pilot] handleCode error:', e);
      isExecuting = false;
    }
  }

  /** 优先使用 EventSource（SSE）接收代码推送，失败时 fallback 到轮询 */
  var sseConnected = false;

  function connectSSE() {
    try {
      var es = new EventSource(serverOrigin + '/__pilot/sse?instance=' + window.__pilot_instanceId + '&version=' + __PILOT_VERSION__ + '&title=' + encodeURIComponent(document.title || '') + '&type=userscript' + '&path=' + encodeURIComponent(location.href));
      window.__pilot_es = es;
      es.addEventListener('code', function(e) {
        if (myGen !== window.__pilot_gen) return;
        handleCode(e.data);
      });
      es.addEventListener('ping', function() {
        if (!sseConnected) {
          sseConnected = true;
          stopPolling();
        }
      });
      es.addEventListener('reload', function() {
        /** Userscript 模式下不 reload（注入代码会丢失） */
        es.close();
      });
      es.onerror = function() {
        if (myGen !== window.__pilot_gen) { es.close(); return; }
        es.close();
        sseConnected = false;
        /** SSE 连接失败，5s 后尝试重连，同时启动轮询作为 fallback */
        setTimeout(function() { connectSSE(); }, 5000);
        startPolling();
      };
    } catch(e) {
      startPolling();
    }
  }

  /** 轮询 fallback（SSE 不可用时）：定期检查是否有待执行代码 */
  var pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    console.log('[Pilot] Polling started (SSE fallback)');
    pollCode();
    pollTimer = setInterval(pollCode, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function pollCode() {
    if (typeof GM_xmlhttpRequest === 'undefined') return;
    GM_xmlhttpRequest({
      method: 'GET',
      url: serverOrigin + '/__pilot/has-code?instance=' + window.__pilot_instanceId,
      onload: function(r) {
        if (r.status === 200 && r.responseText && r.responseText.trim()) {
          if (myGen !== window.__pilot_gen) return;
          handleCode(r.responseText);
        }
      }
    });
  }

  /** 向服务端注册实例 */
  function registerInstance() {
    var registerUrl = serverOrigin + '/__pilot/register?instance=' + window.__pilot_instanceId + '&path=' + encodeURIComponent(location.href) + '&title=' + encodeURIComponent(document.title) + '&type=userscript';
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({ method: 'GET', url: registerUrl });
    } else {
      try { fetch(registerUrl).catch(function() {}); } catch(e) {}
    }
  }

  registerInstance();
  console.log('[Pilot] Userscript started (gen=' + myGen + ', instance=' + window.__pilot_instanceId + ')');

  /** 先启动轮询作为保底（SSE 跨域时可能静默失败），SSE ping 成功后自动停止轮询 */
  startPolling();
  connectSSE();
})();
`

export function buildUserscript(options: ResolvedPilotOptions, pilotVersion: string, serverOrigin: string): string {
  const modules = [
    { name: 'Log Collector', code: replacePlaceholders(logCollectorCode, options, pilotVersion) },
    { name: 'Userscript Client', code: replacePlaceholders(userscriptClientCode, options, pilotVersion) },
    { name: 'Page Snapshot', code: replacePlaceholders(snapshotCode, options, pilotVersion) },
  ]

  /** userscript 在 Tampermonkey 沙箱中运行，window 是代理对象
   *  (0, eval)() 在页面全局执行，访问不到沙箱 window 上的 __pilot_*
   *  因此把 window.__pilot_* 和 window.__PILOT_* 替换为 unsafeWindow.__pilot_* / unsafeWindow.__PILOT_* */
  const body = modules
    .map(({ name, code }) => {
      const patched = code
        .replace(/window\.__pilot_/g, 'unsafeWindow.__pilot_')
        .replace(/window\.__PILOT_/g, 'unsafeWindow.__PILOT_')
      return `  /* === ${name} === */\n  ${patched.trim()}`
    })
    .join('\n\n')

  return `// ==UserScript==
// @name         Pilot Bridge
// @namespace    https://github.com/2234839/vite-plugin-pilot
// @version      ${pilotVersion}
// @description  AI Agent browser automation bridge — connect to vite-plugin-pilot dev server
// @author       2234839
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

// [Pilot] Tampermonkey Userscript — 安装到油猴后自动在所有页面运行
// 修改下方 SERVER_ORIGIN 指向你的 dev server 地址
(function() {
  /** 跳过 iframe（只连接顶层页面，避免 iframe 嵌套注册大量无用实例） */
  if (window.self !== window.top) return;
  if (unsafeWindow.__pilot_userscript_active) return;
  unsafeWindow.__pilot_userscript_active = true;

  /** ==================== 配置 ==================== */
  /** dev server 地址，按需修改 */
  var SERVER_ORIGIN = "${serverOrigin}";
  unsafeWindow.__PILOT_SERVER_ORIGIN__ = SERVER_ORIGIN;
  unsafeWindow.__pilot_instanceId = sessionStorage.getItem('__pilot_instanceId') || Math.random().toString(16).slice(2, 10);
  sessionStorage.setItem('__pilot_instanceId', unsafeWindow.__pilot_instanceId);
  var __PILOT_VERSION__ = "${pilotVersion}";
  /** ==================== 配置结束 ==================== */

  console.log("[Pilot] Userscript starting... (instance: " + unsafeWindow.__pilot_instanceId + ")");
  console.log("[Pilot] Server: " + SERVER_ORIGIN);

${body}

  console.log("[Pilot] Userscript ready! Use: npx pilot run 'your code' (PILOT_INSTANCE=" + unsafeWindow.__pilot_instanceId + ")");
})();`
}
