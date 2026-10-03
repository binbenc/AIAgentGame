#!/usr/bin/env node
/**
 * Agent Quest 本地 CORS 代理（零依赖）。
 *
 * 一些模型厂商的接口不允许浏览器直接跨域访问。这个代理只监听 127.0.0.1，
 * 把 http://127.0.0.1:8787/https/<host>/<path> 转发到 https://<host>/<path>，并补上 CORS 头。
 * 只转发白名单里的域名，避免被当成开放代理。
 *
 * 用法：node proxy/agent-proxy.mjs [--port 8787]
 * 追加白名单：AQ_PROXY_ALLOW=api.example.com,llm.mycorp.internal node proxy/agent-proxy.mjs
 */
import http from 'node:http'
import { Readable } from 'node:stream'

const DEFAULT_ALLOW = [
  'api.anthropic.com',
  'api.openai.com',
  'api.deepseek.com',
  'dashscope.aliyuncs.com',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'ark.cn-beijing.volces.com',
  'api.siliconflow.cn',
  'api.mistral.ai',
  'api.groq.com',
  'openrouter.ai',
]
const allow = new Set([...DEFAULT_ALLOW, ...(process.env.AQ_PROXY_ALLOW ?? '').split(',').map((s) => s.trim()).filter(Boolean)])
const portArg = process.argv.indexOf('--port')
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT ?? 8787)
const HOP = new Set(['host', 'origin', 'referer', 'connection', 'content-length', 'accept-encoding', 'cookie'])

function cors(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] ?? '*')
  res.setHeader('access-control-expose-headers', '*')
  res.setHeader('access-control-max-age', '86400')
}

const server = http.createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  const m = req.url?.match(/^\/(https?)\/([^/]+)(\/.*)?$/)
  if (!m) return res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('用法：/https/<host>/<path>')
  const [, scheme, host, path = '/'] = m
  if (!allow.has(host)) return res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end(`域名 ${host} 不在白名单里，可用 AQ_PROXY_ALLOW 追加`)

  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && typeof v === 'string') headers[k] = v
  const chunks = []
  for await (const c of req) chunks.push(c)
  const started = Date.now()
  try {
    const upstream = await fetch(`${scheme}://${host}${path}`, {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    })
    const out = {}
    upstream.headers.forEach((v, k) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k) && !k.startsWith('access-control-')) out[k] = v
    })
    res.writeHead(upstream.status, out)
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
    else res.end()
    console.log(`${new Date().toISOString()} ${req.method} ${host}${path} → ${upstream.status} (${Date.now() - started}ms)`)
  } catch (e) {
    console.error(`${req.method} ${host}${path} 失败：`, e.message)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`代理请求失败：${e.message}`)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Quest 代理已启动：http://127.0.0.1:${PORT}`)
  console.log(`白名单：${[...allow].join(', ')}`)
})
