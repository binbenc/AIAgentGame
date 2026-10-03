import type { ChatResponse, StreamEvent, ContentBlock, StopReason, Usage } from './types'

/** 把一个完整响应切成确定性的流式事件（mock 用）。 */
export function* responseToEvents(res: ChatResponse, chunkSize = 6): Generator<StreamEvent> {
  for (const b of res.content) {
    if (b.type === 'text') {
      const chars = [...b.text]
      for (let i = 0; i < chars.length; i += chunkSize) yield { type: 'text_delta', text: chars.slice(i, i + chunkSize).join('') }
    } else if (b.type === 'tool_use') {
      yield { type: 'tool_use_start', id: b.id, name: b.name }
      const json = JSON.stringify(b.input)
      for (let i = 0; i < json.length; i += chunkSize * 2)
        yield { type: 'tool_input_delta', id: b.id, partial_json: json.slice(i, i + chunkSize * 2) }
    }
  }
  yield { type: 'message_end', response: res }
}

/** 从事件流里累积出部分响应（被中途取消时用）。 */
export class StreamAccumulator {
  private blocks: ContentBlock[] = []
  private json = new Map<string, string>()
  apply(e: StreamEvent): void {
    if (e.type === 'text_delta') {
      const last = this.blocks[this.blocks.length - 1]
      if (last && last.type === 'text') last.text += e.text
      else this.blocks.push({ type: 'text', text: e.text })
    } else if (e.type === 'tool_use_start') {
      this.blocks.push({ type: 'tool_use', id: e.id, name: e.name, input: {} })
      this.json.set(e.id, '')
    } else if (e.type === 'tool_input_delta') {
      this.json.set(e.id, (this.json.get(e.id) ?? '') + e.partial_json)
    }
  }
  partial(stop: StopReason, usage: Usage, model: string): ChatResponse {
    const content = this.blocks.map((b) => {
      if (b.type !== 'tool_use') return b
      try {
        return { ...b, input: JSON.parse(this.json.get(b.id) || '{}') }
      } catch {
        return b
      }
    })
    return { content, stop_reason: stop, usage, model }
  }
}
