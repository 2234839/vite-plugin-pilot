/**
 * 日志收集器客户端代码（字符串形式，用于注入到浏览器）
 *
 * 功能：
 * 1. 拦截 console.log/info/warn/error，保留原始行为
 * 2. 监听 window.onerror 和 unhandledrejection
 * 3. 缓冲日志，定时批量上报到 /__pilot/logs
 * 4. 维护 window.__pilot_errorCount 供 snapshot 使用
 */

export const logCollectorCode = `
(function() {
  var maxLogs = __MAX_BUFFER_SIZE__;
  var flushInterval = __FLUSH_INTERVAL__;
  var logs = [];
  var lastSavedIndex = 0;
  window.__pilot_errorCount = 0;

  function stringify(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.message + '\\n' + arg.stack;
    try { return JSON.stringify(arg); } catch(e) { return String(arg); }
  }

  /** 存储最近 3 条错误信息，供 snapshot 采集 */
  window.__pilot_lastErrors = [];
  /** 暴露日志数组，ws-client 在 exec 前后截取新增日志附加到 result */
  window.__pilot_logs = logs;

  /** 已知噪音日志（vite 警告等），不计入 errorCount 也不纳入 lastErrors */
  var ERROR_NOISE = ['[vite]', 'failed to connect to websocket'];

  function addLog(type, args) {
    if (type === 'error') {
      var msg = Array.from(args).map(stringify).join(' ').slice(0, 100);
      /** 噪音日志仍记录到 logs（完整日志），但不计入错误统计 */
      var isNoise = ERROR_NOISE.some(function(k) { return msg.indexOf(k) >= 0; });
      if (!isNoise) {
        window.__pilot_errorCount++;
        window.__pilot_lastErrors.push(msg);
        if (window.__pilot_lastErrors.length > 3) window.__pilot_lastErrors.shift();
      }
    }
    logs.push({
      timestamp: new Date().toISOString(),
      type: type,
      message: Array.from(args).map(stringify).join(' ')
    });
    if (logs.length > maxLogs) logs.shift();
  }

  window.addEventListener('error', function(event) {
    var errMsg = (event.message || '').slice(0, 100);
    /** 噪音错误仍记录到 logs（完整日志），但不计入错误统计 */
    var isNoise = ERROR_NOISE.some(function(k) { return errMsg.indexOf(k) >= 0; });
    if (!isNoise) {
      window.__pilot_errorCount++;
      window.__pilot_lastErrors.push(errMsg);
      if (window.__pilot_lastErrors.length > 3) window.__pilot_lastErrors.shift();
    }
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'error',
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error ? event.error.stack : undefined
    });
    if (logs.length > maxLogs) logs.shift();
  });

  window.addEventListener('unhandledrejection', function(event) {
    var errMsg = ('Unhandled Promise: ' + (event.reason ? event.reason.message || event.reason : '')).slice(0, 100);
    /** 噪音错误仍记录到 logs（完整日志），但不计入错误统计 */
    var isNoise = ERROR_NOISE.some(function(k) { return errMsg.indexOf(k) >= 0; });
    if (!isNoise) {
      window.__pilot_errorCount++;
      window.__pilot_lastErrors.push(errMsg);
      if (window.__pilot_lastErrors.length > 3) window.__pilot_lastErrors.shift();
    }
    logs.push({
      timestamp: new Date().toISOString(),
      type: 'error',
      message: 'Unhandled Promise Rejection: ' + (event.reason ? event.reason.message || event.reason : ''),
      stack: event.reason && event.reason.stack ? event.reason.stack : undefined
    });
    if (logs.length > maxLogs) logs.shift();
  });

  var originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };

  console.log = function() {
    addLog('info', arguments);
    originals.log.apply(console, arguments);
  };
  console.info = function() {
    addLog('info', arguments);
    originals.info.apply(console, arguments);
  };
  console.warn = function() {
    addLog('warn', arguments);
    originals.warn.apply(console, arguments);
  };
  console.error = function() {
    addLog('error', arguments);
    originals.error.apply(console, arguments);
  };

  /** 定时 flush 日志到服务端 */
  setInterval(function() {
    if (logs.length > lastSavedIndex) {
      var newLogs = logs.slice(lastSavedIndex);
      if (newLogs.length > 0) {
        fetch('/__pilot/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Pilot-Instance': __pilot_instanceId },
          body: JSON.stringify(newLogs)
        }).then(function() {
          lastSavedIndex = logs.length;
        }).catch(function() {});
      }
    }
  }, flushInterval);
})();
`
