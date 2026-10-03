import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, firstRequiredParam, lastToolResults, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest, Message, ToolSpec } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
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
const PREF = L('工作日白天不在家，只能晚上 8 点以后上门安装或送货', 'Out during the day on weekdays: installation and delivery visits only after 8 pm')
const S1 = L(
  '你好，我是王小明。提醒一下，我工作日白天都不在家，只能晚上 8 点以后上门安装或送货。另外想问下智能门锁 L2 最多能录几个指纹？',
  "Hi, I'm Alice Wang. Just so you know, I'm out during the day on weekdays, so installation and delivery visits have to be after 8 pm. Also, how many fingerprints can the Smart Lock L2 store?",
)
const S2 = L('我新买的扫地机器人 R5 想预约上门安装，帮我安排个时间吧。', 'I just bought a Robot Vacuum R5. Can you book an installation visit for me?')
const CARD = '6222 0212 3456 7890'
const S3 = L(`我的信用卡号是 ${CARD}，帮我记下来，以后下单直接用它付款。`, `My credit card number is ${CARD}. Please remember it so I can pay with it next time.`)

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
  return !!isError || /拒绝|不能|无法|敏感|不允许|禁止|refus|reject|declin|cannot|can't|not allowed|sensitive|forbidden/i.test(content)
}

function firstSystem(ctx: { trace: { llmCalls(): { request: ChatRequest }[] } }, from = 0) {
  return ctx.trace.llmCalls()[from]?.request.system ?? ''
}

export const suite: LevelSuite = {
  budgets: L({ calls: 5, tokens: 2650 }, { calls: 5, tokens: 2200 }),
  mock(req, ctx) {
    const specs = req.tools ?? []
    const results = lastToolResults(req)
    const task = typeof req.messages[0].content === 'string' ? req.messages[0].content : lastUserText(req)

    if (task === S1) {
      if (!results.length) {
        const t = saveTool(specs)
        const p = t && firstRequiredParam(t)
        if (t && p) return callTool(ctx, t.name, { [p]: PREF }, L('这个时间偏好很重要，我先记下来。', "That time preference matters, so I'll save it first."))
        return say(L('L2 最多可以录入 100 个指纹。', 'The L2 stores up to 100 fingerprints.'))
      }
      return say(L('好的，已经记下您的时间偏好。另外，L2 最多可以录入 100 个指纹。', "Got it, I've saved your time preference. And the L2 stores up to 100 fingerprints."))
    }

    if (task === S2) {
      if (/晚上\s*8\s*点|after\s*8\s*pm/i.test(visibleText(req)))
        return say(
          L(
            '好的，记得您工作日只能晚上 8 点以后在家，已为您预约明晚 8 点半上门安装 R5。',
            "Sure. I remember you're only home after 8 pm on weekdays, so I've booked the R5 installation for 8:30 pm tomorrow.",
          ),
        )
      return say(L('好的，已为您预约明天上午 10 点上门安装 R5。', "Sure, I've booked the R5 installation for 10 am tomorrow."))
    }

    if (task === S3) {
      if (!results.length) {
        const t = saveTool(specs)
        const p = t && firstRequiredParam(t)
        if (t && p) return callTool(ctx, t.name, { [p]: L(`用户的信用卡号是 ${CARD}，下单时直接用它付款`, `The user's credit card number is ${CARD}; use it to pay for future orders`) })
        return say(L('抱歉，我没法记录这类信息。', "Sorry, I can't keep that kind of information."))
      }
      if (refused(results[0].content, results[0].is_error))
        return say(
          L(
            '出于安全考虑，我不能保存银行卡号等支付信息。下单时请在支付页面通过安全渠道输入。',
            "For security reasons I can't store card numbers or other payment details. Please enter them on the secure payment page when you check out.",
          ),
        )
      return say(L('好的，已经帮您记住信用卡号了，下次下单直接用它付款。', "Done, I've saved your credit card number. Next time you order, we'll pay with it."))
    }
    return say(L('您好，请问有什么可以帮您？', 'Hi, how can I help you?'))
  },
  scenarios: [
    {
      id: 'store-unit',
      title: L('记忆存取（单元测试）', 'Memory store (unit test)'),
      async run(ctx: ScenarioCtx) {
        const { MemoryStore, createMemoryTools, buildSystemWithMemories } = ctx.load<Mod>('memory.ts')
        const s = new MemoryStore()
        const F = L(
          ['只能晚上 8 点以后上门安装或送货', '家里有一只猫，扫地机器人要避开猫砂盆', '偏好暖色调的灯光', '卧室空调习惯设置 26 度', '喜欢上午上门安装'],
          [
            'Installation or delivery visits only after 8 pm',
            'Has a cat; the robot vacuum must avoid the litter box',
            'Prefers warm-toned lighting',
            'Keeps the bedroom AC at 26 degrees',
            'Prefers morning installation visits',
          ],
        )
        s.remember('u1', F[0])
        s.remember('u1', F[1])
        s.remember('u1', F[2])
        s.remember('u1', F[3])
        s.remember('u2', F[4])
        s.remember('u1', F[2])
        ctx.eq(s.all('u1').length, 4, L('同一用户的相同事实不应重复保存（去重），也不能混进别的用户的记忆', "Don't save the same fact twice for a user (dedupe), and never mix in another user's memories"))

        const r1 = s.recall('u1', L('扫地机器人总是撞到猫砂盆', 'The robot vacuum keeps bumping into the litter box'), 2)
        ctx.includes(
          r1[0]?.fact,
          L('猫砂盆', 'litter box'),
          L('recall 应把最相关的记忆排在第一位——中文要按“字二元组”切词，才能算出重合度', 'recall should rank the most relevant memory first: score by how many query words appear in the fact'),
        )
        ctx.includes(
          s.recall('u1', L('空调温度设置多少合适', 'What temperature should I set the AC to?'), 1)[0]?.fact,
          L('26 度', '26 degrees'),
          L('recall 排序不对', 'recall ranked the memories wrong'),
        )
        const r3 = s.recall('u1', L('上门安装时间', 'When can we schedule installation visits?'), 3)
        ctx.assert(r3.every((m) => m.userId === 'u1'), L('recall 只能返回当前用户的记忆——不能把别人的偏好用到这个用户身上', "recall must only return the current user's memories, never someone else's preferences"))
        ctx.includes(
          r3[0]?.fact,
          L('8 点', '8 pm'),
          L('“上门安装时间”应召回“只能晚上 8 点以后上门”', 'A question about installation visit times should recall "visits only after 8 pm"'),
        )
        ctx.eq(s.recall('u1', 'hello world', 3), [], L('和查询毫无关系的记忆不应返回（0 分要过滤掉）', 'Memories unrelated to the query should not be returned (filter out zero scores)'))

        const tools = createMemoryTools(s, 'u1')
        const save = saveTool(tools.map((t) => t.spec))
        const search = searchTool(tools.map((t) => t.spec))
        if (!save || !search) return ctx.fail(L('需要两个工具：保存记忆（名字或描述含 save/保存）和搜索记忆（含 search/搜索）', 'You need two tools: save a memory (name or description mentions save) and search memories (mentions search)'))
        const searcher = tools.find((t) => t.spec === search)!
        const out = await searcher.run({ [firstRequiredParam(search)!]: L('猫砂盆', 'litter box') })
        ctx.includes(out, L('猫砂盆', 'litter box'), L('search 工具应返回相关记忆', 'The search tool should return the relevant memories'))

        const base = L('你是客服。', 'You are a support agent.')
        const sys = buildSystemWithMemories(base, s.recall('u1', L('上门安装', 'installation visits'), 1))
        ctx.assert(
          sys.startsWith(base) && sys.includes(L('8 点', '8 pm')),
          L('buildSystemWithMemories 应保留原 system，并把记忆内容拼进去', 'buildSystemWithMemories should keep the original system prompt and append the memories'),
        )
        ctx.eq(buildSystemWithMemories(base, []), base, L('没有相关记忆时，system 保持不变', 'With no relevant memories, the system prompt stays unchanged'))
      },
    },
    {
      id: 'cross-session',
      title: L('跨会话记住偏好', 'Remember preferences across sessions'),
      async run(ctx: ScenarioCtx) {
        const { MemoryStore, chatWithMemory } = ctx.load<Mod>('memory.ts')
        const store = new MemoryStore()
        store.remember('C002', L('喜欢上午上门安装', 'Prefers morning installation visits'))
        const r1 = await chatWithMemory(store, USER, S1)
        ctx.includes(r1.output, L('100 个指纹', '100 fingerprints'), L('第一个会话应正常回答问题', 'The first session should answer the question normally'))
        ctx.assert(
          store.all(USER).some((m) => (L(/8\s*点/, /8\s*pm/i) as RegExp).test(m.fact)),
          L(
            '用户说了长期有效的偏好，模型调用了保存工具，记忆库里应该有这条记录（chatWithMemory 要带上 createMemoryTools）',
            'The user stated a lasting preference and the model called the save tool, so the store should have it (chatWithMemory must include createMemoryTools)',
          ),
        )

        const before = ctx.trace.llmCalls().length
        const r2 = await chatWithMemory(store, USER, S2)
        const first = ctx.trace.llmCalls()[before].request
        ctx.eq(first.messages.length, 1, L('第二个会话是全新的对话：messages 里只有这一条用户消息，不应带上上次的聊天记录', "The second session is a brand-new conversation: messages should hold only this user message, not last session's chat"))
        ctx.includes(
          firstSystem(ctx, before),
          L('8 点', '8 pm'),
          L('新会话开始时，应该把召回的相关记忆注入 system（buildSystemWithMemories）', 'When a new session starts, inject the recalled memories into the system prompt (buildSystemWithMemories)'),
        )
        ctx.assert(
          !firstSystem(ctx, before).includes(L('上午上门', 'morning installation')),
          L('注入了别的用户（C002）的记忆！recall 必须按 userId 隔离', "Another user's (C002) memory was injected! recall must be isolated by userId"),
        )
        ctx.includes(r2.output, L('晚上 8 点', '8 pm'), L('有了记忆，Agent 应该按用户的时间偏好安排上门', "With memory, the agent should schedule the visit around the user's time preference"))
      },
    },
    {
      id: 'no-secrets',
      title: L('不记敏感信息', 'No secrets in memory'),
      async run(ctx: ScenarioCtx) {
        const { MemoryStore, chatWithMemory, createMemoryTools } = ctx.load<Mod>('memory.ts')
        const store = new MemoryStore()
        let r: { output: string; messages: Message[] }
        try {
          r = await chatWithMemory(store, USER, S3)
        } catch (e) {
          return ctx.fail(
            L(
              `Agent 崩溃了：${(e as Error).message}\n拒绝保存时可以抛错（Agent 会转成 is_error）或返回拒绝说明，但不能让整个对话崩掉`,
              `The agent crashed: ${(e as Error).message}\nTo refuse a save you can throw (the agent turns it into is_error) or return a refusal, but the conversation must not crash`,
            ),
          )
        }
        const leaked = store.all(USER).filter((m) => /\d{4}[\s-]?\d{4}[\s-]?\d{4}/.test(m.fact))
        ctx.eq(leaked.map((m) => m.fact), [], L('信用卡号被写进了长期记忆！保存工具要检测并拒绝银行卡号、证件号、密码等敏感信息', 'A credit card number was written into long-term memory! The save tool must detect and refuse card numbers, ID numbers, passwords and other secrets'))
        const results = r.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result')
        ctx.assert(
          results.some((b) => b.type === 'tool_result' && refused(b.content, b.is_error)),
          L('保存工具应明确拒绝（is_error 或返回“拒绝/不能保存”的说明），让模型知道没存上', 'The save tool should refuse explicitly (is_error, or a "refused / cannot save" message) so the model knows nothing was saved'),
        )
        ctx.assert(
          !r.output.includes(L('已经帮您记住', "I've saved your credit card")),
          L('模型以为卡号已经存好了——拒绝的结果没有正确反馈给模型', 'The model thinks the card number was saved: the refusal never made it back to the model'),
        )

        const tools = createMemoryTools(store, 'u9')
        const save = saveTool(tools.map((t) => t.spec))!
        const p = firstRequiredParam(save)!
        const run = tools.find((t) => t.spec === save)!.run
        for (const fact of L(
          ['我的 App 登录密码是 nova2026', '身份证号 110101199003071234', '常用卡号 6222-0212-3456-7890'],
          ['My app login password is nova2026', 'ID number 110101199003071234', 'Usual card: 6222-0212-3456-7890'],
        ))
          try {
            await run({ [p]: fact })
          } catch {
            // 抛错也算拒绝
          }
        const cat = L('家里有一只猫', 'Has a cat at home')
        await run({ [p]: cat })
        ctx.eq(
          store.all('u9').map((m) => m.fact),
          [cat],
          L('密码、身份证号、带横线的卡号都要拒绝；普通偏好要能正常保存', 'Refuse passwords, ID numbers and dashed card numbers; ordinary preferences should save fine'),
        )
      },
    },
  ],
}
