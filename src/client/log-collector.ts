/**
 * 日志收集器客户端代码（字符串形式，用于注入到浏览器）
 *
 * 功能：
 * 1. 拦截 console.log/info/warn/error，保留原始行为
 * 2. 监听 window.onerror 和 unhandledrejection
 * 3. 缓冲日志到内存数组，ws-client 在 exec 时截取新增日志附加到 result
 * 4. 维护 window.__pilot_errorCount 供 snapshot 使用
 */

export const logCollectorCode = `
(function() {
  var maxLogs = __MAX_BUFFER_SIZE__;
  var logs = [];
  window.__pilot_errorCount = 0;

  /** 安全字符串化，限制深度和长度，防止复杂对象（Vue 实例、DOM 等）卡死主线程 */
  var MAX_STRINGIFY_DEPTH = 3;
  var MAX_STRINGIFY_LEN = 500;

  function stringify(arg, depth) {
    if (depth === undefined) depth = 0;
    if (typeof arg === 'string') return arg.length > MAX_STRINGIFY_LEN ? arg.slice(0, MAX_STRINGIFY_LEN) + '...' : arg;
    if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
    if (arg === null || arg === undefined) return String(arg);
    if (arg instanceof Error) return arg.message;
    if (depth >= MAX_STRINGIFY_DEPTH) return '[Object]';
    try {
      /** 数组特殊处理：只取前 5 项 */
      if (Array.isArray(arg)) {
        if (arg.length > 5) return '[' + arg.slice(0, 5).map(function(a) { return stringify(a, depth + 1); }).join(', ') + ', ...(' + arg.length + ')]';
        return '[' + arg.map(function(a) { return stringify(a, depth + 1); }).join(', ') + ']';
      }
      /** 普通对象：只取前 5 个 key */
      var keys = Object.keys(arg);
      if (keys.length > 5) {
        var parts = keys.slice(0, 5).map(function(k) { return k + ': ' + stringify(arg[k], depth + 1); });
        var result = '{' + parts.join(', ') + ', ...(' + keys.length + ')}';
        return result.length > MAX_STRINGIFY_LEN ? result.slice(0, MAX_STRINGIFY_LEN) + '...' : result;
      }
      var parts = keys.map(function(k) { return k + ': ' + stringify(arg[k], depth + 1); });
      var result = '{' + parts.join(', ') + '}';
      return result.length > MAX_STRINGIFY_LEN ? result.slice(0, MAX_STRINGIFY_LEN) + '...' : result;
    } catch(e) { return String(arg); }
  }

  /** 存储最近 3 条错误信息，供 snapshot 采集 */
  window.__pilot_lastErrors = [];
  /** 暴露日志数组，ws-client 在 exec 前后截取新增日志附加到 result */
  window.__pilot_logs = logs;

  /** 已知噪音日志（vite 警告等），不计入 errorCount 也不纳入 lastErrors */
  var ERROR_NOISE = ['[vite]', 'failed to connect to websocket', '[Vue warn]'];

  /** 将 args 延迟转换为 message 字符串（首次访问时缓存），暴露给 ws-client 消费 */
  window.__pilot_logToMessage = function(entry) {
    if (entry.message !== undefined) return entry.message;
    entry.message = Array.from(entry.args).map(stringify).join(' ');
    entry.args = null;
    return entry.message;
  }

  function addLog(type, args) {
    if (type === 'error') {
      /** error 路径仍需立即 stringify（噪音检测+lastErrors），但 error 频率低 */
      var msg = Array.from(args).map(stringify).join(' ').slice(0, 100);
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
      args: args
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
})();
`
