#!/usr/bin/env node
/**
 * vite-plugin-pilot Channel Server
 *
 * 作为 Claude Code 的 Channel MCP Server，将浏览器 Alt+Click 发送的
 * 提示词推送到当前 Claude Code session。
 *
 * 双模式运行：
 * 1. Channel 模式（MCP stdio）：通过 MCP notification 推送到 Claude Code session
 * 2. 降级模式（文件传递）：写入 .pilot/channel-pending.txt，
 *    通过 Claude Code 的 UserPromptSubmit hook 在用户下次输入时自动附加
 *
 * 前置条件：
 * - Claude Code v2.1.80+
 * - claude.ai 登录（API Key / Console 认证不支持）
 * - 启动时加 --dangerously-load-development-channels server:pilot-channel
 *
 * 使用方式（由 .mcp.json 自动启动，无需手动运行）：
 *   claude --dangerously-load-development-channels server:pilot-channel
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from 'http'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const CHANNEL_PORT = 8789
/** 降级文件路径（与 .pilot 目录一致） */
const PILOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.pilot')
const PENDING_FILE = join(PILOT_DIR, 'channel-pending.txt')

/** 创建 MCP Server，声明 claude/channel 能力 */
const mcp = new Server(
  { name: 'pilot-channel', version: '1.0.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
    },
    instructions:
      '用户通过 vite-plugin-pilot 在浏览器中 Alt+Click 选中元素后发送消息。' +
      '消息包含元素信息和用户的操作意图，请根据元素信息定位源码并执行操作。' +
      '这是单向通道：读取消息并执行操作，无需回复。',
  },
)

/** 连接到 Claude Code（stdio 传输） */
await mcp.connect(new StdioServerTransport())

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
        /** Channel 模式：推送到 Claude Code session */
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: message,
            meta: { source: 'pilot-inspector' },
          },
        })
        /** 降级模式：写入 pending 文件，UserPromptSubmit hook 会读取 */
        if (!existsSync(PILOT_DIR)) mkdirSync(PILOT_DIR, { recursive: true })
        writeFileSync(PENDING_FILE, message, 'utf-8')
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
