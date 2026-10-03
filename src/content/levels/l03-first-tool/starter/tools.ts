import { chat, type ToolSpec } from 'agent-quest'

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
      name: 'TODO',
      description: 'TODO：写给模型看——这个工具做什么、什么时候用',
      input_schema: {
        type: 'object',
        properties: {
          // TODO：city 参数
        },
        required: [],
      },
    },
    run: (input) => getWeather(input.city),
  }
}

export async function answerOnce(question: string, tool: Tool): Promise<string> {
  // TODO 1：第一次 chat，带上 tools: [tool.spec]
  // TODO 2：如果 stop_reason === 'tool_use'，执行每个 tool_use 块
  // TODO 3：第二次 chat：user(问题) → assistant(完整 content) → user(tool_result 列表)
  // TODO 4：返回最终文本
  throw new Error('TODO：实现 answerOnce()')
}
