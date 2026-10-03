import { useState } from 'react'
import { toAnthropicParams } from '../../engine/llm/providers/anthropic'
import { toOpenAIBody } from '../../engine/llm/providers/openai'
import type { ChatRequest, ContentBlock, Message } from '../../engine/llm/types'
import type { TraceEvent } from '../../engine/trace'
import { L } from '../../engine/locale'

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-2 font-mono text-[11px] leading-relaxed text-slate-300">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

function blockSummary(b: ContentBlock): string {
  switch (b.type) {
    case 'text':
      return b.text
    case 'tool_use':
      return `🔧 ${b.name}(${JSON.stringify(b.input)})`
    case 'tool_result':
      return `${b.is_error ? '❌' : '↩︎'} ${b.content}`
    case 'opaque':
      return `[${(b.raw as { type?: string })?.type ?? 'opaque'}${L(' 块', ' block')}]`
  }
}

function MessageView({ m }: { m: Message }) {
  const blocks: ContentBlock[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
  return (
    <div className="rounded border border-slate-800 p-2">
      <div className={`mb-1 text-[10px] font-semibold uppercase ${m.role === 'user' ? 'text-sky-400' : 'text-violet-400'}`}>{m.role}</div>
      {blocks.map((b, i) => (
        <div key={i} className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-300">
          {blockSummary(b)}
        </div>
      ))}
    </div>
  )
}

function LlmDetail({ e }: { e: Extract<TraceEvent, { kind: 'llm' }> }) {
  const [tab, setTab] = useState<'chat' | 'anthropic' | 'openai' | 'wire'>(e.wire ? 'wire' : 'chat')
  const req = e.request as ChatRequest
  type T = 'chat' | 'anthropic' | 'openai' | 'wire'
  const tabs: [T, string][] = [
    ['chat', L('对话', 'Conversation')],
    ['anthropic', L('Anthropic 报文', 'Anthropic wire format')],
    ['openai', L('OpenAI 报文', 'OpenAI wire format')],
    ...(e.wire ? ([['wire', L('实际发出的请求', 'Request actually sent')]] as [T, string][]) : []),
  ]
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-2 py-0.5 text-[11px] ${tab === k ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'chat' && (
        <div className="space-y-1.5">
          {req.system && (
            <div className="rounded border border-amber-900/50 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase text-amber-400">system</div>
              <div className="whitespace-pre-wrap font-mono text-[11px] text-slate-300">{req.system}</div>
            </div>
          )}
          {req.tools?.length ? <div className="text-[11px] text-slate-500">tools: {req.tools.map((t) => t.name).join(', ')}</div> : null}
          {req.messages.map((m, i) => (
            <MessageView key={i} m={m} />
          ))}
          {e.response && (
            <div className="border-t border-dashed border-slate-700 pt-1.5">
              <div className="mb-1 text-[10px] text-slate-500">
                {L('响应', 'Response')} · stop_reason={e.response.stop_reason} · in {e.response.usage.input_tokens} / out {e.response.usage.output_tokens} tokens · {e.response.model}
              </div>
              <MessageView m={{ role: 'assistant', content: e.response.content }} />
            </div>
          )}
          {e.error && <div className="rounded bg-rose-950/60 p-2 font-mono text-[11px] text-rose-300">{e.error}</div>}
        </div>
      )}
      {tab === 'anthropic' && (
        <>
          <div className="text-[11px] text-slate-500">POST https://api.anthropic.com/v1/messages</div>
          <Json value={toAnthropicParams(req, 'claude-opus-5-5')} />
        </>
      )}
      {tab === 'openai' && (
        <>
          <div className="text-[11px] text-slate-500">POST {'{baseURL}'}/chat/completions</div>
          <Json value={toOpenAIBody(req, 'gpt-5')} />
        </>
      )}
      {tab === 'wire' && e.wire && (
        <>
          <div className="break-all text-[11px] text-slate-500">POST {e.wire.url} {L('（请求头里的密钥已隐去）', '(secrets in headers redacted)')}</div>
          <Json value={e.wire.body} />
        </>
      )}
    </div>
  )
}

function Row({ e }: { e: TraceEvent }) {
  const [open, setOpen] = useState(false)
  let icon = '•'
  let title = ''
  let meta = ''
  let tone = 'text-slate-300'
  switch (e.kind) {
    case 'llm': {
      icon = '🧠'
      const tools = e.response?.content.filter((b) => b.type === 'tool_use').map((b) => (b as { name: string }).name) ?? []
      title = e.error
        ? `${L('模型调用失败：', 'Model call failed: ')}${e.error}`
        : tools.length
          ? `${L('模型 → 调用 ', 'Model → calls ')}${tools.join(', ')}`
          : `${L('模型', 'Model')} → ${e.response?.stop_reason}`
      meta = `${fmtMs(e.durationMs)}${e.response ? ` · ${e.response.usage.input_tokens}+${e.response.usage.output_tokens} tok` : ''}${e.streamed ? L(' · 流式', ' · streamed') : ''}`
      tone = e.error ? 'text-rose-300' : 'text-violet-200'
      break
    }
    case 'tool':
      icon = '🔧'
      title = `${e.name}(${JSON.stringify(e.input)?.slice(0, 80)})${e.error ? ` ✗ ${e.error}` : ''}`
      meta = fmtMs(e.durationMs)
      tone = e.error ? 'text-rose-300' : 'text-emerald-200'
      break
    case 'sleep':
      icon = '⏳'
      title = `sleep(${e.ms})`
      tone = 'text-slate-400'
      break
    case 'log':
      icon = '📝'
      title = e.message
      tone = 'text-sky-200'
      break
    case 'error':
      icon = '💥'
      title = e.message
      tone = 'text-rose-300'
      break
  }
  const expandable = e.kind === 'llm' || e.kind === 'tool'
  return (
    <li className="border-b border-slate-800/70">
      <button
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-slate-800/50"
        onClick={() => expandable && setOpen(!open)}
      >
        <span className="w-12 shrink-0 font-mono text-[10px] leading-5 text-slate-600">{fmtMs(e.t)}</span>
        <span className="shrink-0 leading-5">{icon}</span>
        <span className={`min-w-0 flex-1 truncate text-xs leading-5 ${tone}`}>{title}</span>
        {meta && <span className="shrink-0 font-mono text-[10px] leading-5 text-slate-500">{meta}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3">
          {e.kind === 'llm' ? (
            <LlmDetail e={e} />
          ) : e.kind === 'tool' ? (
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] text-slate-500">{L('输入', 'Input')}</div>
                <Json value={e.input} />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-slate-500">{e.error ? L('错误', 'Error') : L('输出', 'Output')}</div>
                <Json value={e.error ?? e.output} />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </li>
  )
}

export function TracePanel({ events }: { events: TraceEvent[] }) {
  if (!events.length) return <div className="p-4 text-xs text-slate-500">{L('这个场景没有产生任何事件。', 'This scenario produced no events.')}</div>
  return (
    <ul className="text-sm">
      {events.map((e) => (
        <Row key={e.seq} e={e} />
      ))}
    </ul>
  )
}
