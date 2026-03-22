#!/usr/bin/env node
/**
 * vite-plugin-pilot Channel Server
 *
 * 作为 Claude Code 的 Channel MCP Server 运行，
 * 接收浏览器端 Alt+Click 选中元素的提示词，推送到当前 Claude Code session。
 *
 * 使用方式：
 *   claude --dangerously-load-development-channels server:pilot-channel
 *
 * 启动后浏览器端 Alt+Click 元素面板中的「发送给 Claude」按钮
 * 会通过 HTTP POST 将提示词发送到本 server，
 * 再通过 MCP notification 推送到 Claude Code session。
 *
 * 零外部依赖：手动实现 MCP stdio 协议（JSON-RPC 2.0 over stdin/stdout）
 */

import { createServer } from 'http'

const CHANNEL_PORT = 8789

/** 发送 JSON-RPC 2.0 消息到 stdout（Claude Code 读取 stdin） */
function sendJsonrpc(message) {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`
  process.stdout.write(header + json)
}

/** 处理来自 Claude Code 的 JSON-RPC 请求（仅响应 initialize） */
function handleMessage(data) {
  const msg = JSON.parse(data)
  if (msg.method === 'initialize') {
    sendJsonrpc({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          experimental: { 'claude/channel': {} },
          tools: {},
        },
        serverInfo: { name: 'pilot', version: '0.1.0' },
        instructions:
          '用户通过 vite-plugin-pilot 在浏览器中 Alt+Click 选中元素后发送消息。' +
          '消息包含元素信息和用户的操作意图，请根据元素信息定位源码并执行操作。',
      },
    })
  } else if (msg.method === 'notifications/initialized') {
    /** 初始化完成确认，无需响应 */
  }
}

/** 读取 stdin 上的 JSON-RPC 消息 */
let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const header = buffer.slice(0, headerEnd)
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue }
    const bodyLen = parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + bodyLen) break
    const body = buffer.slice(bodyStart, bodyStart + bodyLen)
    buffer = buffer.slice(bodyStart + bodyLen)
    try { handleMessage(body) } catch { /* ignore malformed messages */ }
  }
})

/** 推送消息到 Claude Code session（浏览器 HTTP POST 触发） */
function pushToClaude(message, meta) {
  sendJsonrpc({
    jsonrpc: '2.0',
    method: 'notifications/claude/channel',
    params: {
      content: message,
      meta: meta || {},
    },
  })
}

/** HTTP 服务器：接收浏览器端发送的提示词 */
const httpServer = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/message') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const message = data.message
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing message field' }))
          return
        }
        pushToClaude(message, data.meta)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid JSON' }))
      }
    })
    return
  }

  /** 健康检查 */
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', channel: 'pilot' }))
    return
  }

  res.writeHead(404)
  res.end()
})

httpServer.listen(CHANNEL_PORT, '0.0.0.0', () => {
  /** stderr 输出不会干扰 stdio MCP 通信 */
  console.error(`[pilot-channel] HTTP server listening on http://127.0.0.1:${CHANNEL_PORT}`)
})
