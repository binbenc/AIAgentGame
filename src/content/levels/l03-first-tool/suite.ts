import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, firstRequiredParam, lastToolResults, lastUserText, say, toolMatching } from '../../../engine/llm/mock-kit'
import type { ToolSpec } from '../../../engine/llm/types'
import { __traced } from '../../../engine/runtime/api'

const WEATHER: Record<string, { city: string; tempC: number; condition: string }> = {
  上海: { city: '上海', tempC: 23, condition: '多云' },
  北京: { city: '北京', tempC: 17, condition: '晴' },
}
const getWeather = __traced('getWeather', async (city: string) => {
  const w = WEATHER[city]
  if (!w) throw new Error(`未知城市：${city}`)
  return w
})

type Tool = { spec: ToolSpec; run(input: unknown): unknown }
type Mod = { makeWeatherTool(fn: typeof getWeather): Tool; answerOnce(q: string, t: Tool): Promise<string> }

export const suite: LevelSuite = {
  budgets: { calls: 3, tokens: 520 },
  mock(req, ctx) {
    const results = lastToolResults(req)
    if (results.length) {
      try {
        const w = JSON.parse(results[0].content)
        return say(`${w.city}现在 ${w.tempC}°C，${w.condition}。${w.tempC > 26 ? '建议提前开空调降温。' : '体感舒适，暂时不用开空调。'}`)
      } catch {
        return say(`根据查询结果：${results[0].content}`)
      }
    }
    const q = lastUserText(req)
    const city = Object.keys(WEATHER).find((c) => q.includes(c))
    if (!/天气|温度|多少度/.test(q) || !city) return say('你好！我是 Nova 客服，有什么可以帮你？')
    const tool = toolMatching(req, ['weather', '天气'])
    if (!tool) return say('抱歉，我无法获取实时天气信息。')
    const param = firstRequiredParam(tool) ?? 'city'
    return callTool(ctx, tool.name, { [param]: city }, '我来查一下。')
  },
  scenarios: [
    {
      id: 'spec',
      title: '工具定义规范',
      async run(ctx: ScenarioCtx) {
        const { makeWeatherTool } = ctx.load<Mod>('tools.ts')
        const { spec } = makeWeatherTool(getWeather)
        ctx.assert(/^[a-z][a-z0-9_]*$/.test(spec.name), `工具名 "${spec.name}" 应该用 snake_case，例如 get_weather`)
        ctx.assert(spec.description.length >= 15 && !spec.description.includes('TODO'), 'description 太短了：写清楚做什么、什么时候用')
        ctx.assert(/天气|weather/i.test(spec.description), 'description 里应该说明这是查天气的工具')
        const city = spec.input_schema.properties?.city
        ctx.assert(city, 'input_schema.properties 里需要 city 参数')
        ctx.eq(city.type, 'string', 'city 的类型应该是 string')
        ctx.assert(typeof city.description === 'string' && city.description.length > 0, 'city 参数也要写 description')
        ctx.eq(spec.input_schema.required, ['city'], 'city 应该是必填参数')
      },
    },
    {
      id: 'weather',
      title: '查询天气',
      async run(ctx: ScenarioCtx) {
        const { makeWeatherTool, answerOnce } = ctx.load<Mod>('tools.ts')
        const answer = await answerOnce('上海今天天气怎么样？要不要开空调？', makeWeatherTool(getWeather))
        const calls = ctx.trace.toolCalls('getWeather')
        ctx.eq(calls.length, 1, '应该执行一次天气工具')
        ctx.eq(calls[0].input, '上海', '工具应该用模型给出的参数 city="上海" 来调用')
        ctx.eq(ctx.trace.llmCalls().length, 2, '一次工具往返应该调用 2 次模型')
        ctx.includes(answer, '23°C', '最终回答应基于工具返回的温度')
      },
    },
    {
      id: 'chitchat',
      title: '闲聊不调工具',
      async run(ctx: ScenarioCtx) {
        const { makeWeatherTool, answerOnce } = ctx.load<Mod>('tools.ts')
        const answer = await answerOnce('你好呀', makeWeatherTool(getWeather))
        ctx.eq(ctx.trace.toolCalls().length, 0, '模型没有要求调用工具，就不应该执行工具')
        ctx.eq(ctx.trace.llmCalls().length, 1, '不需要工具时，一次调用就够了')
        ctx.includes(answer, 'Nova', '应该直接返回模型的回答')
      },
    },
  ],
}
