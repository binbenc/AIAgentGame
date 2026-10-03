import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, findTool, lastToolResults, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import { requestTokens, messageTokens } from '../../../engine/llm/tokens'
import { LLMError, type ChatRequest, type Message } from '../../../engine/llm/types'
import { basicNovaTools, createNova, type Tool } from '../../shared/nova'

type Session = { messages: Message[]; send(text: string): Promise<string> }
type Mod = {
  ChatSession: new (o: { system?: string; maxContextTokens: number; keepLastTurns?: number; tools?: Tool[] }) => Session
  splitForCompaction(messages: Message[], keepLastTurns: number): { older: Message[]; recent: Message[] }
}

const SYSTEM = '你是 Nova 科技的客服助手，用简洁友好的中文回答。'
/** 模型的“硬上限”：超过就像真实 API 一样返回 400 */
const HARD_LIMIT = 1000
const BUDGET = 640

/** 一段真实感的长对话：关键信息只在第 1 轮出现，最后一轮才被问到 */
const TURNS: [string, string][] = [
  ['你好，我叫陈静，上个月买的智能门锁 L2，订单号是 NV-100002。我白天上班，只能晚上 8 点以后收货。', '陈静您好！已了解您的情况，请问门锁使用上遇到了什么问题？'],
  ['门锁装好之后，App 里一直显示“设备离线”，怎么办？', '请先确认门锁电量充足，再在 App 中长按设备卡片选择“重新配网”，配网时手机要靠近门锁。'],
  ['顺便帮我查一下 NV-100001 的物流到哪了？', ''],
  ['好的。门锁的 Wi-Fi 是不是只支持 2.4G？', '是的，L2 目前只支持 2.4GHz Wi-Fi，暂不支持 5GHz 频段。'],
  ['我家路由器是双频合一的，需要拆开吗？', '建议在路由器后台把 2.4G 和 5G 拆分成两个名称，配网成功后可以再合并回来。'],
  ['拆开之后连上了！指纹怎么录入？', '在 App 里进入“门锁 → 用户管理 → 添加指纹”，按提示把同一根手指按压 6 次即可。'],
  ['能录几个指纹？我家有 5 口人。', 'L2 最多可以录入 100 个指纹，每位家庭成员建议录 2 根手指，以防手指受伤时无法开门。'],
  ['临时密码功能怎么用？保洁阿姨每周来一次。', '在 App 里选择“临时密码”，可以生成单次有效或周期有效的密码，非常适合保洁阿姨使用。'],
  ['临时密码可以设置有效期吗？', '可以，周期密码支持设置生效日期、星期和时间段，比如每周三上午 9 点到 12 点。'],
  ['门锁电池一般能用多久？', '正常使用下，8 节 5 号电池大约可以用 10 到 12 个月，电量低于 20% 时 App 会提醒您。'],
  ['没电了怎么开门？', '可以用充电宝连接锁体底部的应急供电口临时供电，再用指纹或密码开门；也可以用机械钥匙。'],
  ['应急供电接口是 Type-C 吗？', '是的，L2 底部的应急供电接口是 Type-C，普通手机充电宝就可以使用。'],
  ['门锁能和智能空调 X1 联动吗？比如开门自动开空调。', '可以。在 App 的“智能场景”里新建场景，触发条件选“门锁开门”，执行动作选“空调开机”。'],
  ['联动规则在哪里设置？', '首页右下角“智能”标签页，点击右上角加号就可以新建联动规则。'],
  ['我想设置成只在工作日生效，可以吗？', '可以，在场景的“生效时间段”里勾选周一到周五即可。'],
  ['门锁有防撬报警吗？', '有的，锁体被暴力撬动时会发出约 85 分贝的本地报警声。'],
  ['报警会推送到我手机上吗？', '会，只要门锁在线，防撬、试错次数过多等报警都会实时推送到 App。'],
  ['家里老人不会用 App，可以用卡片开锁吗？', '可以，L2 支持 NFC 门卡，老人用卡片轻触感应区就能开门。'],
  ['卡片在哪里买？', 'Nova 官方商城有售，配件分类里搜索“L2 门卡”即可，一套 3 张。'],
  ['门锁可以换成静音模式吗？晚上开门怕吵到孩子。', '可以，在“门锁设置 → 声音”里打开静音模式，开门提示音会关闭。'],
  ['门锁的固件怎么升级？', '有新固件时 App 会推送提醒，进入设备详情页点击“固件升级”即可，升级约需 3 分钟。'],
  ['升级的时候会不会把指纹清掉？', '不会，固件升级不会清除已录入的指纹、密码和门卡。'],
  ['保修期是多久？', 'L2 整机保修 2 年，电子元件保修 3 年，自签收之日起计算。'],
  ['保修需要保留发票吗？', '不需要纸质发票，系统里有您的订单记录就可以享受保修服务。'],
  ['好的，谢谢你这么耐心。', '不客气，这是我应该做的。'],
  ['对了，最后确认一下：我叫什么名字？我最开始说的那个订单号是多少？我方便什么时间收货？', ''],
]
const FINAL_Q = TURNS[TURNS.length - 1][0]

const SHORT: [string, string][] = [
  ['你好，扫地机器人 R5 能自动回充吗？', '可以，R5 电量低于 15% 时会自动返回充电座。'],
  ['充满电需要多久？', '大约 4 个小时可以充满。'],
  ['好的，谢谢！', '不客气，祝您使用愉快！'],
]

const strip = (s: string) => s.split('[对话摘要]').join('')

function isSummaryRequest(req: ChatRequest): boolean {
  return /摘要|总结|压缩|summar/i.test(strip(req.system ?? '') + '\n' + strip(lastUserText(req)))
}

/** 只能从“看得见”的文本里提取事实——没发给模型的，模型就不知道 */
function extractFacts(text: string) {
  const name = text.match(/(?:我叫|姓名[:：]\s*)([一-龥]{2,3}?)(?=[，。,；;\s]|$)/)?.[1]
  const orders = [...new Set(text.match(/NV-\d{6}/g) ?? [])]
  const pref = /晚上\s*8\s*点(以后|后)/.test(text) ? '只能晚上 8 点以后收货' : undefined
  return { name, orders, pref }
}

function isSummaryMessage(m: Message): boolean {
  const t = typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return t.startsWith('[对话摘要]')
}

function summaryCalls(ctx: { trace: { llmCalls(): { request: ChatRequest }[] } }) {
  return ctx.trace.llmCalls().filter((c) => isSummaryRequest(c.request))
}

export const suite: LevelSuite = {
  budgets: { calls: 33, tokens: 16500 },
  maxCallsPerScenario: 60,
  mock(req, ctx) {
    const n = requestTokens(req)
    if (n > HARD_LIMIT)
      throw new LLMError(`400 invalid_request_error: prompt is too long: ${n} tokens > ${HARD_LIMIT} maximum`, 400, false)

    if (isSummaryRequest(req)) {
      const f = extractFacts(visibleText(req))
      const parts = [
        f.name && `用户姓名：${f.name}`,
        f.orders.length && `提到的订单：${f.orders.join('、')}`,
        f.pref && `收货偏好：${f.pref}`,
        '已咨询过门锁的配网、指纹、密码、电池、联动等使用问题，均已解答',
      ].filter(Boolean)
      return say(parts.join('；') + '。')
    }

    const q = lastUserText(req)
    if (q === FINAL_Q) {
      // 去掉最后这条提问本身，只看之前的上下文
      const before = visibleText({ ...req, messages: req.messages.slice(0, -1) })
      const f = extractFacts(before)
      const out = [
        f.name ? `您叫${f.name}` : '抱歉，我不记得您的名字了',
        f.orders[0] ? `最开始提到的订单号是 ${f.orders[0]}` : '也不记得您的订单号',
        f.pref ? `您${f.pref}` : '收货时间我也不清楚',
      ]
      return say(out.join('，') + '。')
    }
    if (q.includes('NV-100001 的物流')) {
      const shipping = findTool(req, (t) => /shipping|物流/i.test(`${t.name} ${t.description}`))
      if (shipping) return callTool(ctx, shipping.name, { order_id: 'NV-100001' })
      return say('抱歉，我暂时无法查询物流。')
    }
    const results = lastToolResults(req)
    if (results.length) {
      const s = JSON.parse(results[0].content) as { carrier: string; status: string }
      return say(`NV-100001 由${s.carrier}承运，目前${s.status}。`)
    }
    const hit = [...TURNS, ...SHORT].find(([u]) => u === q)
    return say(hit?.[1] || '好的，还有其他问题吗？')
  },
  scenarios: [
    {
      id: 'split-unit',
      title: '按轮切分（单元测试）',
      async run(ctx: ScenarioCtx) {
        const { splitForCompaction } = ctx.load<Mod>('session.ts')
        const msgs: Message[] = [
          { role: 'user', content: '第一轮：NV-100001 到哪了？' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_shipping', input: { order_id: 'NV-100001' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"status":"派送中"}' }] },
          { role: 'assistant', content: '派送中。' },
          { role: 'user', content: '第二轮' },
          { role: 'assistant', content: '好的' },
          { role: 'user', content: '第三轮：再查 NV-100004' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'get_shipping', input: { order_id: 'NV-100004' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: '{"status":"派送中"}' }] },
          { role: 'assistant', content: '也在派送中。' },
        ]
        const a = splitForCompaction(msgs, 2)
        ctx.eq([a.older.length, a.recent.length], [4, 6], 'keepLastTurns=2：前 4 条（第一轮，含工具往返）是 older，后 6 条是 recent')
        const b = splitForCompaction(msgs, 1)
        ctx.eq(b.recent.length, 4, 'keepLastTurns=1：最后一轮包含 tool_use/tool_result，要整轮保留（4 条）')
        ctx.eq(b.recent[0].content, '第三轮：再查 NV-100004', 'recent 必须从用户发言开始——不能从 tool_result 切开，否则会留下孤立的 tool_result')
        const c = splitForCompaction(msgs, 5)
        ctx.eq([c.older.length, c.recent.length], [0, 10], '轮数不足 keepLastTurns 时，不需要压缩：older 为空')
        ctx.eq([...a.older, ...a.recent], msgs, 'older + recent 应该正好是原来的消息（不增不减、顺序不变）')
      },
    },
    {
      id: 'short-chat',
      title: '短对话不压缩',
      async run(ctx: ScenarioCtx) {
        const { ChatSession } = ctx.load<Mod>('session.ts')
        const s = new ChatSession({ system: SYSTEM, maxContextTokens: BUDGET })
        for (const [u] of SHORT) await s.send(u)
        ctx.eq(summaryCalls(ctx).length, 0, '没超预算时不应该做摘要——每次摘要都是一次额外的模型调用')
        ctx.eq(ctx.trace.llmCalls().length, 3, '3 轮对话应该只调用 3 次模型')
        ctx.eq(s.messages.length, 6, '对话历史应原样保留：3 × (user + assistant)')
      },
    },
    {
      id: 'long-chat',
      title: '长对话：压缩后仍记得关键信息',
      async run(ctx: ScenarioCtx) {
        const { ChatSession } = ctx.load<Mod>('session.ts')
        const shipping = basicNovaTools(createNova()).filter((t) => t.spec.name === 'get_shipping')
        const s = new ChatSession({ system: SYSTEM, maxContextTokens: BUDGET, keepLastTurns: 3, tools: shipping })
        let answer = ''
        for (const [i, [u]] of TURNS.entries()) {
          try {
            answer = await s.send(u)
          } catch (e) {
            return ctx.fail(`第 ${i + 1} 轮出错：${(e as Error).message}\n上下文超过了模型的窗口。发送前要检查 token 数，超出 maxContextTokens 就先压缩历史。`)
          }
        }
        const calls = ctx.trace.llmCalls()
        const main = calls.filter((c) => !isSummaryRequest(c.request))
        const biggest = Math.max(...main.map((c) => requestTokens(c.request)))
        ctx.assert(biggest <= BUDGET, `有一次对话请求用了 ${biggest} tokens，超过了 maxContextTokens=${BUDGET}。检查时要把 system、messages 和 tools 都算上：countTokens({ system, messages, tools })`)
        ctx.assert(summaryCalls(ctx).length >= 1, '长对话应该至少做一次摘要（单独调用一次模型，system 或提示里写明是“摘要”任务）')
        ctx.assert(isSummaryMessage(s.messages[0]), `压缩后的第一条消息应该是以 "[对话摘要]" 开头的 user 消息，实际：${JSON.stringify(s.messages[0]).slice(0, 80)}`)
        ctx.includes(answer, '陈静', '模型应该还记得用户的名字——摘要时要把较早的对话完整交给摘要模型，并要求保留姓名')
        ctx.includes(answer, 'NV-100002', '模型应该还记得最开始的订单号——摘要要保留订单号')
        ctx.includes(answer, '8 点', '模型应该还记得收货时间偏好')

        // 和“把整段历史一直带着”的朴素做法比较
        const naive: Message[] = []
        let naiveTotal = 0
        for (const [u, a] of TURNS) {
          naive.push({ role: 'user', content: u })
          naiveTotal += naive.reduce((n, m) => n + messageTokens(m), 0)
          naive.push({ role: 'assistant', content: a || '好的。' })
        }
        const total = ctx.trace.totalTokens().input
        ctx.assert(total < naiveTotal * 0.75, `输入 token 合计 ${total}，和不压缩的 ${naiveTotal} 差不多。摘要后历史应该明显变短，keepLastTurns 不要太大`)
      },
    },
  ],
}
