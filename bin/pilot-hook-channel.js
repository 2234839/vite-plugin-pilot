#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit Hook
 *
 * 读取 .pilot/channel-pending.txt 中浏览器通过 Alt+Click 发送的消息，
 * 作为 additionalContext 注入到用户下一次输入中，然后删除文件。
 *
 * 由 .claude/settings.local.json 中的 hooks.UserPromptSubmit 配置调用。
 */

import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PILOT_DIR = join(PROJECT_ROOT, '.pilot')
const PENDING_FILE = join(PILOT_DIR, 'channel-pending.txt')

if (existsSync(PENDING_FILE)) {
  const message = readFileSync(PENDING_FILE, 'utf-8')
  unlinkSync(PENDING_FILE)
  if (message.trim()) {
    /** 纯文本 stdout 作为 additionalContext 注入，比 JSON 格式更稳定 */
    console.log('[pilot-channel] 用户从浏览器发送了一条消息，请处理：\n' + message.trim())
  }
}
