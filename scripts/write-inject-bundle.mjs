#!/usr/bin/env node

/**
 * build 后处理：写入 version.txt 和 inject-bundle.txt
 * inject-bundle.txt 供 transformIndexHtml 动态读取，确保 build 后浏览器 reload 加载最新代码
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { buildInjectScript } from '../dist/index.js'

const pilotDir = join(process.cwd(), '.pilot')
mkdirSync(pilotDir, { recursive: true })

const version = String(Date.now())
writeFileSync(join(pilotDir, 'version.txt'), version)

const options = {
  logLevels: ['log', 'warn', 'error'],
  maxBufferSize: 1024,
  flushInterval: 1000,
  execTimeout: 30000,
  maxResultSize: 262144,
  inspector: true,
  locale: 'zh',
  pilotDir,
}
writeFileSync(join(pilotDir, 'inject-bundle.txt'), buildInjectScript(options, version), 'utf-8')
