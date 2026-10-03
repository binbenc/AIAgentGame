import { chat, type ToolSpec } from 'agent-quest'

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
      name: 'TODO',
      description: 'TODO: written for the model: what this tool does and when to use it',
      input_schema: {
        type: 'object',
        properties: {
          // TODO: the city parameter
        },
        required: [],
      },
    },
    run: (input) => getWeather(input.city),
  }
}

export async function answerOnce(question: string, tool: Tool): Promise<string> {
  // TODO 1: first chat call, with tools: [tool.spec]
  // TODO 2: if stop_reason === 'tool_use', run every tool_use block
  // TODO 3: second chat call: user(question) → assistant(full content) → user(list of tool_results)
  // TODO 4: return the final text
  throw new Error('TODO: implement answerOnce()')
}
