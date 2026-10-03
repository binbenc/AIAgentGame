import { chat, type ContentBlock, type ToolResultBlock, type ToolSpec } from 'agent-quest'

/** 一个工具 = 给模型看的说明书(spec) + 你自己的实现(run) */
export interface Tool {
  spec: ToolSpec
  run(input: any): unknown | Promise<unknown>
}

export interface Weather {
  city: string
  tempC: number
  condition: string
}

export function makeWeatherTool(getWeather: (city: string) => Promise<Weather>): Tool {
  return {
    spec: {
      name: 'get_weather',
      description: '查询某个城市当前的实时天气（气温和天气状况）。当用户询问天气、气温，或需要根据天气给出建议时使用。',
      input_schema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市中文名，例如 "上海"' },
        },
        required: ['city'],
      },
    },
    run: (input) => getWeather(input.city),
  }
}

export function textOf(content: ContentBlock[]): string {
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

export function toToolContent(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output)
}

export async function answerOnce(question: string, tool: Tool): Promise<string> {
  const first = await chat({ tools: [tool.spec], messages: [{ role: 'user', content: question }] })
  if (first.stop_reason !== 'tool_use') return textOf(first.content)

  const results: ToolResultBlock[] = []
  for (const block of first.content) {
    if (block.type !== 'tool_use') continue
    const output = await tool.run(block.input)
    results.push({ type: 'tool_result', tool_use_id: block.id, content: toToolContent(output) })
  }
  const second = await chat({
    tools: [tool.spec],
    messages: [
      { role: 'user', content: question },
      { role: 'assistant', content: first.content },
      { role: 'user', content: results },
    ],
  })
  return textOf(second.content)
}
