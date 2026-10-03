import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, firstRequiredParam, lastToolResults, lastUserText, say, toolMatching } from '../../../engine/llm/mock-kit'
import type { ToolSpec } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
import { __traced } from '../../../engine/runtime/api'

type Weather = { city: string; tempC: number; condition: string }
const WEATHER = L<Record<string, Weather>>(
  {
    上海: { city: '上海', tempC: 23, condition: '多云' },
    北京: { city: '北京', tempC: 17, condition: '晴' },
  },
  {
    Shanghai: { city: 'Shanghai', tempC: 23, condition: 'cloudy' },
    Beijing: { city: 'Beijing', tempC: 17, condition: 'sunny' },
  },
)
const CITY = L('上海', 'Shanghai')
const getWeather = __traced('getWeather', async (city: string) => {
  const w = WEATHER[city]
  if (!w) throw new Error(L(`未知城市：${city}`, `Unknown city: ${city}`))
  return w
})

type Tool = { spec: ToolSpec; run(input: unknown): unknown }
type Mod = { makeWeatherTool(fn: typeof getWeather): Tool; answerOnce(q: string, t: Tool): Promise<string> }

export const suite: LevelSuite = {
  budgets: L({ calls: 3, tokens: 520 }, { calls: 3, tokens: 430 }),
  mock(req, ctx) {
    const results = lastToolResults(req)
    if (results.length) {
      try {
        const w = JSON.parse(results[0].content)
        return say(
          L(
            `${w.city}现在 ${w.tempC}°C，${w.condition}。${w.tempC > 26 ? '建议提前开空调降温。' : '体感舒适，暂时不用开空调。'}`,
            `It's ${w.tempC}°C and ${w.condition} in ${w.city} right now. ${w.tempC > 26 ? 'You may want to turn the AC on early to cool down.' : "It's comfortable, so there's no need for the AC yet."}`,
          ),
        )
      } catch {
        return say(L(`根据查询结果：${results[0].content}`, `According to the lookup: ${results[0].content}`))
      }
    }
    const q = lastUserText(req)
    const city = Object.keys(WEATHER).find((c) => q.includes(c))
    if (!/天气|温度|多少度|weather|temperature|how (hot|cold|warm)/i.test(q) || !city)
      return say(L('你好！我是 Nova 客服，有什么可以帮你？', "Hi! I'm Nova support. How can I help?"))
    const tool = toolMatching(req, ['weather', '天气'])
    if (!tool) return say(L('抱歉，我无法获取实时天气信息。', "Sorry, I can't get live weather data."))
    const param = firstRequiredParam(tool) ?? 'city'
    return callTool(ctx, tool.name, { [param]: city }, L('我来查一下。', 'Let me check.'))
  },
  scenarios: [
    {
      id: 'spec',
      title: L('工具定义规范', 'Tool definition conventions'),
      async run(ctx: ScenarioCtx) {
        const { makeWeatherTool } = ctx.load<Mod>('tools.ts')
        const { spec } = makeWeatherTool(getWeather)
        ctx.assert(/^[a-z][a-z0-9_]*$/.test(spec.name), L(`工具名 "${spec.name}" 应该用 snake_case，例如 get_weather`, `Tool name "${spec.name}" should be snake_case, e.g. get_weather`))
        ctx.assert(spec.description.length >= 15 && !spec.description.includes('TODO'), L('description 太短了：写清楚做什么、什么时候用', 'The description is too short: say what the tool does and when to use it'))
        ctx.assert(/天气|weather/i.test(spec.description), L('description 里应该说明这是查天气的工具', 'The description should say this tool looks up the weather'))
        const city = spec.input_schema.properties?.city
        ctx.assert(city, L('input_schema.properties 里需要 city 参数', 'input_schema.properties needs a city parameter'))
        ctx.eq(city.type, 'string', L('city 的类型应该是 string', 'city should be of type string'))
        ctx.assert(typeof city.description === 'string' && city.description.length > 0, L('city 参数也要写 description', 'The city parameter needs a description too'))
        ctx.eq(spec.input_schema.required, ['city'], L('city 应该是必填参数', 'city should be required'))
      },
    },
    {
      id: 'weather',
      title: L('查询天气', 'Weather lookup'),
      async run(ctx: ScenarioCtx) {
        const { makeWeatherTool, answerOnce } = ctx.load<Mod>('tools.ts')
        const answer = await answerOnce(
          L('上海今天天气怎么样？要不要开空调？', "What's the weather like in Shanghai today? Should I turn on the AC?"),
          makeWeatherTool(getWeather),
        )
        const calls = ctx.trace.toolCalls('getWeather')
        ctx.eq(calls.length, 1, L('应该执行一次天气工具', 'The weather tool should run once'))
        ctx.eq(calls[0].input, CITY, L('工具应该用模型给出的参数 city="上海" 来调用', 'Call the tool with the argument the model gave: city="Shanghai"'))
        ctx.eq(ctx.trace.llmCalls().length, 2, L('一次工具往返应该调用 2 次模型', 'One tool round trip takes 2 model calls'))
        ctx.includes(answer, '23°C', L('最终回答应基于工具返回的温度', 'The final answer should be based on the temperature the tool returned'))
      },
    },
    {
      id: 'chitchat',
      title: L('闲聊不调工具', 'Small talk: no tool call'),
      async run(ctx: ScenarioCtx) {
        const { makeWeatherTool, answerOnce } = ctx.load<Mod>('tools.ts')
        const answer = await answerOnce(L('你好呀', 'Hi there!'), makeWeatherTool(getWeather))
        ctx.eq(ctx.trace.toolCalls().length, 0, L('模型没有要求调用工具，就不应该执行工具', "Don't run any tool when the model didn't ask for one"))
        ctx.eq(ctx.trace.llmCalls().length, 1, L('不需要工具时，一次调用就够了', 'Without a tool, one model call is enough'))
        ctx.includes(answer, 'Nova', L('应该直接返回模型的回答', "Return the model's answer directly"))
      },
    },
  ],
}
