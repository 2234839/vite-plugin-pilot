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
    .replace(/__MAX_RESULT_SIZE__/g, String(options.maxResultSize))
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
}

/** userscript 专用的通信层：用 GM_xmlhttpRequest 替代 fetch/SSE */
const userscriptClientCode = `
(function() {
  window.__pilot_gen = (window.__pilot_gen || 0) + 1;
  var myGen = window.__pilot_gen;

  var execTimeout = __EXEC_TIMEOUT__;
  var maxResultSize = __MAX_RESULT_SIZE__;
  var serverOrigin = window.__PILOT_SERVER_ORIGIN__;

  function serializeResult(val) {
    var str;
    if (val === undefined) str = 'undefined';
    else if (val === null) str = 'null';
    else if (typeof val === 'function') str = '[Function: ' + (val.name || 'anonymous') + ']';
    else if (typeof val === 'string') str = val;
    else { try { str = JSON.stringify(val, null, 2); } catch(e) { str = String(val); } }
    if (str.length > maxResultSize) {
      str = str.slice(0, maxResultSize) + '\\n... [truncated, ' + str.length + ' chars total]';
    }
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
    var hasAwait = /\\bawait\\b/.test(code) || code.indexOf('__pilot_waitFor(') !== -1 || code.indexOf('__pilot_wait(') !== -1
      || code.indexOf('__pilot_typeByPlaceholder(') !== -1 || code.indexOf('__pilot_type(') !== -1
      || code.indexOf('__pilot_checkMultipleByText(') !== -1 || code.indexOf('__pilot_waitEnabled(') !== -1;
    var logStartIdx = window.__pilot_logs ? window.__pilot_logs.length : 0;

    if (hasAwait) {
      var lines = code.split('\\n');
      var lastIdx = -1;
      for (var li = lines.length - 1; li >= 0; li--) {
        var trimmed = lines[li].trim();
        if (trimmed && trimmed !== '}' && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
          lastIdx = li;
          break;
        }
      }
      if (lastIdx >= 0) {
        var lastLine = lines[lastIdx].trim();
        if (!/^return\\b/.test(lastLine) && !/^}/.test(lastLine)) {
          var semiIdx = lastLine.lastIndexOf(';');
          if (semiIdx !== -1 && semiIdx < lastLine.length - 1) {
            var prefix = lastLine.slice(0, semiIdx + 1);
            var suffix = lastLine.slice(semiIdx + 1).trim();
            if (suffix && !/^return\\b/.test(suffix)) {
              lines[lastIdx] = prefix + ' return ' + suffix;
            }
          } else {
            lines[lastIdx] = 'return ' + lastLine;
          }
          code = lines.join('\\n');
        }
      }
      var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      return new Promise(function(resolve) {
        var timeoutId = setTimeout(function() {
          resolve(makeResult(code, undefined, false, 'Execution timeout after ' + execTimeout + 'ms'));
        }, execTimeout);

        try {
          var fn = new AsyncFunction(code);
          fn().then(function(result) {
            clearTimeout(timeoutId);
            resolve(makeResult(code, result, true, undefined, getLogsSince(logStartIdx)));
          }).catch(function(e) {
            clearTimeout(timeoutId);
            resolve(makeResult(code, undefined, false, e.message || String(e), getLogsSince(logStartIdx)));
          });
        } catch(e) {
          clearTimeout(timeoutId);
          resolve(makeResult(code, undefined, false, e.message || String(e)));
        }
      });
    }

    var result;
    var success = true;
    var errorMsg = '';

    var timeoutId = setTimeout(function() {
      throw new Error('Execution timeout after ' + execTimeout + 'ms');
    }, execTimeout);

    try {
      var hasTopReturn = false;
      var depth = 0;
      for (var ci = 0; ci < code.length; ci++) {
        var ch = code[ci];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
        else if (depth === 0 && code.slice(ci, ci + 6) === 'return' && (ci + 6 >= code.length || /[^a-zA-Z0-9_$]/.test(code[ci + 6])) && (ci === 0 || /[^a-zA-Z0-9_$]/.test(code[ci - 1]))) {
          hasTopReturn = true;
          break;
        }
      }
      if (hasTopReturn) {
        result = (0, eval)('(function() { ' + code + ' })()');
      } else {
        result = (0, eval)(code);
      }
    } catch(e) {
      success = false;
      errorMsg = e.message || String(e);
      result = undefined;
    } finally {
      clearTimeout(timeoutId);
    }

    return makeResult(code, result, success, errorMsg, getLogsSince(logStartIdx));
  }

  /** 使用 GM_xmlhttpRequest 发送 HTTP POST（绕过 CSP 跨域限制） */
  function postResult(result) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: serverOrigin + '/__pilot/result',
      headers: {
        'Content-Type': 'application/json',
        'X-Pilot-Instance': window.__pilot_instanceId
      },
      data: JSON.stringify(result)
    });
  }

  function sendResult(result) {
    postResult(result);
  }

  var isExecuting = false;
  var pendingCode = null;

  function handleCode(code) {
    if (isExecuting) {
      pendingCode = code;
      return;
    }
    isExecuting = true;
    var result = execCode(code);
    function sendWithSnapshot(result) {
      if (window.__pilot_snapshot && !document.hidden) {
        requestAnimationFrame(function() {
          if (window.__pilot_snapshot) result.snapshot = window.__pilot_snapshot();
          sendResult(result);
          isExecuting = false;
          if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
        });
      } else if (window.__pilot_snapshot) {
        setTimeout(function() {
          if (window.__pilot_snapshot) result.snapshot = window.__pilot_snapshot();
          sendResult(result);
          isExecuting = false;
          if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
        }, 50);
      } else {
        sendResult(result);
        isExecuting = false;
        if (pendingCode) { var next = pendingCode; pendingCode = null; handleCode(next); }
      }
    }
    if (result && typeof result.then === 'function') {
      result.then(function(r) { sendWithSnapshot(r); });
    } else {
      sendWithSnapshot(result);
    }
  }

  /** HTTP 轮询替代 SSE：定期检查是否有待执行代码 */
  function pollCode() {
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

  /** 向服务端注册实例（写入 active-instance.json） */
  GM_xmlhttpRequest({
    method: 'GET',
    url: serverOrigin + '/__pilot/register?instance=' + window.__pilot_instanceId + '&path=' + encodeURIComponent(location.pathname) + '&title=' + encodeURIComponent(document.title),
    onload: function() {
      console.log('[Pilot] Instance registered: ' + window.__pilot_instanceId);
    }
  });

  console.log('[Pilot] Userscript polling started (gen=' + myGen + ', instance=' + window.__pilot_instanceId + ')');
  pollCode();
  setInterval(pollCode, 2000);
})();
`

export function buildUserscript(options: ResolvedPilotOptions, pilotVersion: string, serverOrigin: string): string {
  const modules = [
    { name: 'Log Collector', code: replacePlaceholders(logCollectorCode, options, pilotVersion) },
    { name: 'Userscript Client', code: replacePlaceholders(userscriptClientCode, options, pilotVersion) },
    { name: 'Page Snapshot', code: replacePlaceholders(snapshotCode, options, pilotVersion) },
  ]

  const body = modules
    .map(({ name, code }) => `  /* === ${name} === */\n  ${code.trim()}`)
    .join('\n\n')

  return `// ==UserScript==
// @name         Pilot Bridge
// @namespace    https://github.com/2234839/vite-plugin-pilot
// @version      ${pilotVersion}
// @description  AI Agent browser automation bridge — connect to vite-plugin-pilot dev server
// @author       2234839
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

// [Pilot] Tampermonkey Userscript — 安装到油猴后自动在所有页面运行
// 修改下方 SERVER_ORIGIN 指向你的 dev server 地址
(function() {
  if (window.__pilot_userscript_active) return;
  window.__pilot_userscript_active = true;

  /** ==================== 配置 ==================== */
  /** dev server 地址，按需修改 */
  var SERVER_ORIGIN = "${serverOrigin}";
  window.__PILOT_SERVER_ORIGIN__ = SERVER_ORIGIN;
  window.__pilot_instanceId = "userscript:" + Math.random().toString(16).slice(2, 10);
  var __PILOT_VERSION__ = "${pilotVersion}";
  /** ==================== 配置结束 ==================== */

  console.log("[Pilot] Userscript starting... (instance: " + window.__pilot_instanceId + ")");
  console.log("[Pilot] Server: " + SERVER_ORIGIN);

${body}

  console.log("[Pilot] Userscript ready! Use: npx pilot run 'your code' (PILOT_INSTANCE=" + window.__pilot_instanceId + ")");
})();`
}
