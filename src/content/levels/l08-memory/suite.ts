import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, firstRequiredParam, lastToolResults, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest, Message, ToolSpec } from '../../../engine/llm/types'
import type { Tool } from '../../shared/nova'

type Item = { id: string; userId: string; fact: string }
type Store = { remember(u: string, f: string): Item; recall(u: string, q: string, k?: number): Item[]; all(u: string): Item[] }
type Mod = {
  MemoryStore: new () => Store
  createMemoryTools(store: Store, userId: string): Tool[]
  buildSystemWithMemories(base: string, memories: Item[]): string
  chatWithMemory(store: Store, userId: string, message: string, opts?: { system?: string; tools?: Tool[] }): Promise<{ output: string; messages: Message[] }>
}

const USER = 'C001'
const PREF = '工作日白天不在家，只能晚上 8 点以后上门安装或送货'
const S1 = '你好，我是王小明。提醒一下，我工作日白天都不在家，只能晚上 8 点以后上门安装或送货。另外想问下智能门锁 L2 最多能录几个指纹？'
const S2 = '我新买的扫地机器人 R5 想预约上门安装，帮我安排个时间吧。'
const CARD = '6222 0212 3456 7890'
const S3 = `我的信用卡号是 ${CARD}，帮我记下来，以后下单直接用它付款。`

const SAVE_KEYS = ['save', 'remember', 'store', '保存', '记住', '记下']
const SEARCH_KEYS = ['search', 'recall', 'query', 'find', '搜索', '查找', '检索']

/** 像模型一样挑工具：名字命中优先，其次描述命中 */
function pick(specs: ToolSpec[], keys: string[], exclude?: ToolSpec): ToolSpec | undefined {
  const pool = specs.filter((s) => s !== exclude)
  const hit = (s: string) => keys.some((k) => s.toLowerCase().includes(k))
  return pool.find((s) => hit(s.name)) ?? pool.find((s) => hit(s.description))
}
function saveTool(specs: ToolSpec[]) {
  return pick(specs, SAVE_KEYS)
}
function searchTool(specs: ToolSpec[]) {
  return pick(specs, SEARCH_KEYS, saveTool(specs))
}

function refused(content: string, isError?: boolean) {
  return !!isError || /拒绝|不能|无法|敏感|不允许|禁止/.test(content)
}

function firstSystem(ctx: { trace: { llmCalls(): { request: ChatRequest }[] } }, from = 0) {
  return ctx.trace.llmCalls()[from]?.request.system ?? ''
}

export const suite: LevelSuite = {
  budgets: { calls: 5, tokens: 2650 },
  mock(req, ctx) {
    const specs = req.tools ?? []
    const results = lastToolResults(req)
    const task = typeof req.messages[0].content === 'string' ? req.messages[0].content : lastUserText(req)

    if (task === S1) {
      if (!results.length) {
        const t = saveTool(specs)
        const p = t && firstRequiredParam(t)
        if (t && p) return callTool(ctx, t.name, { [p]: PREF }, '这个时间偏好很重要，我先记下来。')
        return say('L2 最多可以录入 100 个指纹。')
      }
      return say('好的，已经记下您的时间偏好。另外，L2 最多可以录入 100 个指纹。')
    }

    if (task === S2) {
      if (/晚上\s*8\s*点/.test(visibleText(req)))
        return say('好的，记得您工作日只能晚上 8 点以后在家，已为您预约明晚 8 点半上门安装 R5。')
      return say('好的，已为您预约明天上午 10 点上门安装 R5。')
    }

    if (task === S3) {
      if (!results.length) {
        const t = saveTool(specs)
        const p = t && firstRequiredParam(t)
        if (t && p) return callTool(ctx, t.name, { [p]: `用户的信用卡号是 ${CARD}，下单时直接用它付款` })
        return say('抱歉，我没法记录这类信息。')
      }
      if (refused(results[0].content, results[0].is_error))
        return say('出于安全考虑，我不能保存银行卡号等支付信息。下单时请在支付页面通过安全渠道输入。')
      return say('好的，已经帮您记住信用卡号了，下次下单直接用它付款。')
    }
    return say('您好，请问有什么可以帮您？')
  },
  scenarios: [
    {
      id: 'store-unit',
      title: '记忆存取（单元测试）',
      async run(ctx: ScenarioCtx) {
        const { MemoryStore, createMemoryTools, buildSystemWithMemories } = ctx.load<Mod>('memory.ts')
        const s = new MemoryStore()
        s.remember('u1', '只能晚上 8 点以后上门安装或送货')
        s.remember('u1', '家里有一只猫，扫地机器人要避开猫砂盆')
        s.remember('u1', '偏好暖色调的灯光')
        s.remember('u1', '卧室空调习惯设置 26 度')
        s.remember('u2', '喜欢上午上门安装')
        s.remember('u1', '偏好暖色调的灯光')
        ctx.eq(s.all('u1').length, 4, '同一用户的相同事实不应重复保存（去重），也不能混进别的用户的记忆')

        const r1 = s.recall('u1', '扫地机器人总是撞到猫砂盆', 2)
        ctx.includes(r1[0]?.fact, '猫砂盆', 'recall 应把最相关的记忆排在第一位——中文要按“字二元组”切词，才能算出重合度')
        ctx.includes(s.recall('u1', '空调温度设置多少合适', 1)[0]?.fact, '26 度', 'recall 排序不对')
        const r3 = s.recall('u1', '上门安装时间', 3)
        ctx.assert(r3.every((m) => m.userId === 'u1'), 'recall 只能返回当前用户的记忆——不能把别人的偏好用到这个用户身上')
        ctx.includes(r3[0]?.fact, '8 点', '“上门安装时间”应召回“只能晚上 8 点以后上门”')
        ctx.eq(s.recall('u1', 'hello world', 3), [], '和查询毫无关系的记忆不应返回（0 分要过滤掉）')

        const tools = createMemoryTools(s, 'u1')
        const save = saveTool(tools.map((t) => t.spec))
        const search = searchTool(tools.map((t) => t.spec))
        if (!save || !search) return ctx.fail('需要两个工具：保存记忆（名字或描述含 save/保存）和搜索记忆（含 search/搜索）')
        const searcher = tools.find((t) => t.spec === search)!
        const out = await searcher.run({ [firstRequiredParam(search)!]: '猫砂盆' })
        ctx.includes(out, '猫砂盆', 'search 工具应返回相关记忆')

        const sys = buildSystemWithMemories('你是客服。', s.recall('u1', '上门安装', 1))
        ctx.assert(sys.startsWith('你是客服。') && sys.includes('8 点'), 'buildSystemWithMemories 应保留原 system，并把记忆内容拼进去')
        ctx.eq(buildSystemWithMemories('你是客服。', []), '你是客服。', '没有相关记忆时，system 保持不变')
      },
    },
    {
      id: 'cross-session',
      title: '跨会话记住偏好',
      async run(ctx: ScenarioCtx) {
        const { MemoryStore, chatWithMemory } = ctx.load<Mod>('memory.ts')
        const store = new MemoryStore()
        store.remember('C002', '喜欢上午上门安装')
        const r1 = await chatWithMemory(store, USER, S1)
        ctx.includes(r1.output, '100 个指纹', '第一个会话应正常回答问题')
        ctx.assert(
          store.all(USER).some((m) => /8\s*点/.test(m.fact)),
          '用户说了长期有效的偏好，模型调用了保存工具，记忆库里应该有这条记录（chatWithMemory 要带上 createMemoryTools）',
        )

        const before = ctx.trace.llmCalls().length
        const r2 = await chatWithMemory(store, USER, S2)
        const first = ctx.trace.llmCalls()[before].request
        ctx.eq(first.messages.length, 1, '第二个会话是全新的对话：messages 里只有这一条用户消息，不应带上上次的聊天记录')
        ctx.includes(firstSystem(ctx, before), '8 点', '新会话开始时，应该把召回的相关记忆注入 system（buildSystemWithMemories）')
        ctx.assert(!firstSystem(ctx, before).includes('上午上门'), '注入了别的用户（C002）的记忆！recall 必须按 userId 隔离')
        ctx.includes(r2.output, '晚上 8 点', '有了记忆，Agent 应该按用户的时间偏好安排上门')
      },
    },
    {
      id: 'no-secrets',
      title: '不记敏感信息',
      async run(ctx: ScenarioCtx) {
        const { MemoryStore, chatWithMemory, createMemoryTools } = ctx.load<Mod>('memory.ts')
        const store = new MemoryStore()
        let r: { output: string; messages: Message[] }
        try {
          r = await chatWithMemory(store, USER, S3)
        } catch (e) {
          return ctx.fail(`Agent 崩溃了：${(e as Error).message}\n拒绝保存时可以抛错（Agent 会转成 is_error）或返回拒绝说明，但不能让整个对话崩掉`)
        }
        const leaked = store.all(USER).filter((m) => /\d{4}[\s-]?\d{4}[\s-]?\d{4}/.test(m.fact))
        ctx.eq(leaked.map((m) => m.fact), [], '信用卡号被写进了长期记忆！保存工具要检测并拒绝银行卡号、证件号、密码等敏感信息')
        const results = r.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result')
        ctx.assert(
          results.some((b) => b.type === 'tool_result' && refused(b.content, b.is_error)),
          '保存工具应明确拒绝（is_error 或返回“拒绝/不能保存”的说明），让模型知道没存上',
        )
        ctx.assert(!r.output.includes('已经帮您记住'), '模型以为卡号已经存好了——拒绝的结果没有正确反馈给模型')

        const tools = createMemoryTools(store, 'u9')
        const save = saveTool(tools.map((t) => t.spec))!
        const p = firstRequiredParam(save)!
        const run = tools.find((t) => t.spec === save)!.run
        for (const fact of ['我的 App 登录密码是 nova2026', '身份证号 110101199003071234', '常用卡号 6222-0212-3456-7890'])
          try {
            await run({ [p]: fact })
          } catch {
            // 抛错也算拒绝
          }
        await run({ [p]: '家里有一只猫' })
        ctx.eq(store.all('u9').map((m) => m.fact), ['家里有一只猫'], '密码、身份证号、带横线的卡号都要拒绝；普通偏好要能正常保存')
      },
    },
  ],
}
