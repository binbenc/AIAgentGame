import { chat, type ContentBlock, type ToolResultBlock, type ToolSpec } from 'agent-quest'

/** A tool = a manual for the model (spec) + your own implementation (run) */
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
      description:
        "Get the current weather in a city (temperature and conditions). Use it when the user asks about the weather or temperature, or when advice depends on the weather.",
      input_schema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name in English, e.g. "Shanghai"' },
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
