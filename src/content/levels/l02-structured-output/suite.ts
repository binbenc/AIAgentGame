import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { firstUserText, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'

type Ticket = { category: string; priority: string; summary: string; orderId: string | null }
type Mod = { extractTicket(email: string, maxRetries?: number): Promise<Ticket>; parseJsonLoose(t: string): unknown }

const EMAILS: Record<string, { email: string; ticket: Ticket }> = {
  clean: {
    email: '你好，我的订单 NV-102938 被重复扣款了两次，请尽快处理！',
    ticket: { category: 'billing', priority: 'high', summary: '订单 NV-102938 重复扣款', orderId: 'NV-102938' },
  },
  fenced: {
    email: 'App 在 iOS 18 上一打开设备页面就闪退，重装也没用。',
    ticket: { category: 'bug', priority: 'medium', summary: 'iOS 18 打开设备页面闪退', orderId: null },
  },
  'self-correct': {
    email: '我忘记密码了，绑定的手机号也换了，订单 NV-554433 的状态也看不到。',
    ticket: { category: 'account', priority: 'medium', summary: '无法登录：忘记密码且手机号已更换', orderId: 'NV-554433' },
  },
  hopeless: { email: '？？？', ticket: { category: 'other', priority: 'low', summary: '', orderId: null } },
}

export const suite: LevelSuite = {
  budgets: { calls: 7, tokens: 1600 },
  mock(req, ctx) {
    const sc = EMAILS[ctx.scenario] ?? EMAILS.clean
    const wantsJson = /json/i.test(visibleText(req))
    if (!wantsJson) return say(`这封邮件看起来是关于${sc.ticket.category}的问题，优先级${sc.ticket.priority}。`)
    const json = JSON.stringify(sc.ticket)
    switch (ctx.scenario) {
      case 'fenced':
        return say(`好的，分拣结果如下：\n\`\`\`json\n${JSON.stringify(sc.ticket, null, 2)}\n\`\`\`\n如需调整请告诉我。`)
      case 'self-correct': {
        const feedback = req.messages.length > 1 ? lastUserText(req) : ''
        if (/priority/.test(feedback) && /orderId/.test(feedback)) return say(json)
        return say(JSON.stringify({ ...sc.ticket, priority: 'urgent', orderId: '554433' }))
      }
      case 'hopeless':
        return say('抱歉，我看不懂这封邮件。')
      default:
        return say(firstUserText(req) ? json : '{}')
    }
  },
  scenarios: [
    {
      id: 'clean',
      title: '干净 JSON',
      async run(ctx: ScenarioCtx) {
        const { extractTicket } = ctx.load<Mod>('structured.ts')
        const t = await extractTicket(EMAILS.clean.email)
        ctx.eq(t, EMAILS.clean.ticket, '提取结果不对（prompt 里有没有要求只输出 JSON？）')
        ctx.eq(ctx.trace.llmCalls().length, 1, '格式正确时应该只调用一次模型')
      },
    },
    {
      id: 'fenced',
      title: '代码块包裹',
      async run(ctx: ScenarioCtx) {
        const { extractTicket, parseJsonLoose } = ctx.load<Mod>('structured.ts')
        ctx.eq(parseJsonLoose('前言 {"a":1} 后记'), { a: 1 }, 'parseJsonLoose 应该能忽略 JSON 前后的文字')
        const t = await extractTicket(EMAILS.fenced.email)
        ctx.eq(t, EMAILS.fenced.ticket, '应该能剥掉 ```json 代码块')
        ctx.eq(ctx.trace.llmCalls().length, 1, '能解析出来就不应该重试')
      },
    },
    {
      id: 'self-correct',
      title: '校验失败 → 自我修正',
      async run(ctx: ScenarioCtx) {
        const { extractTicket } = ctx.load<Mod>('structured.ts')
        let t: Ticket
        try {
          t = await extractTicket(EMAILS['self-correct'].email)
        } catch (e) {
          return ctx.fail(`修正失败：${(e as Error).message}\n提示：反馈给模型的错误信息要具体，至少点名出错的字段（priority、orderId）`)
        }
        ctx.eq(t, EMAILS['self-correct'].ticket, '最终应得到通过校验的工单')
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 2, '应该恰好重试一次')
        const retry = calls[1].request
        ctx.eq(
          retry.messages.map((m) => m.role),
          ['user', 'assistant', 'user'],
          '重试时应带上：原邮件(user) → 模型的错误回答(assistant) → 错误反馈(user)',
        )
      },
    },
    {
      id: 'hopeless',
      title: '重试上限',
      async run(ctx: ScenarioCtx) {
        const { extractTicket } = ctx.load<Mod>('structured.ts')
        let threw = false
        try {
          await extractTicket(EMAILS.hopeless.email, 2)
        } catch {
          threw = true
        }
        ctx.assert(threw, '所有重试都失败后应该抛出错误')
        ctx.eq(ctx.trace.llmCalls().length, 3, 'maxRetries=2 时最多调用 3 次模型')
      },
    },
  ],
}
