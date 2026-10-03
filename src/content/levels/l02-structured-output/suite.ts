import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { firstUserText, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import { L } from '../../../engine/locale'

type Ticket = { category: string; priority: string; summary: string; orderId: string | null }
type Mod = { extractTicket(email: string, maxRetries?: number): Promise<Ticket>; parseJsonLoose(t: string): unknown }

const EMAILS_ZH: Record<string, { email: string; ticket: Ticket }> = {
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

const EMAILS_EN: Record<string, { email: string; ticket: Ticket }> = {
  clean: {
    email: 'Hi, my order NV-102938 was charged twice. Please sort this out ASAP!',
    ticket: { category: 'billing', priority: 'high', summary: 'Order NV-102938 charged twice', orderId: 'NV-102938' },
  },
  fenced: {
    email: "The app crashes on iOS 18 as soon as I open the device page. Reinstalling didn't help.",
    ticket: { category: 'bug', priority: 'medium', summary: 'App crashes on iOS 18 when opening the device page', orderId: null },
  },
  'self-correct': {
    email: "I forgot my password and I've changed my phone number, and I can't see the status of order NV-554433 either.",
    ticket: { category: 'account', priority: 'medium', summary: "Can't log in: forgot password and changed phone number", orderId: 'NV-554433' },
  },
  hopeless: { email: '???', ticket: { category: 'other', priority: 'low', summary: '', orderId: null } },
}

const EMAILS = L(EMAILS_ZH, EMAILS_EN)

export const suite: LevelSuite = {
  budgets: L({ calls: 7, tokens: 1600 }, { calls: 7, tokens: 1360 }),
  mock(req, ctx) {
    const sc = EMAILS[ctx.scenario] ?? EMAILS.clean
    const wantsJson = /json/i.test(visibleText(req))
    if (!wantsJson) return say(
        L(
          `这封邮件看起来是关于${sc.ticket.category}的问题，优先级${sc.ticket.priority}。`,
          `This email looks like a ${sc.ticket.category} issue, priority ${sc.ticket.priority}.`,
        ),
      )
    const json = JSON.stringify(sc.ticket)
    switch (ctx.scenario) {
      case 'fenced':
        return say(
          L(
            `好的，分拣结果如下：\n\`\`\`json\n${JSON.stringify(sc.ticket, null, 2)}\n\`\`\`\n如需调整请告诉我。`,
            `Sure, here's the triage result:\n\`\`\`json\n${JSON.stringify(sc.ticket, null, 2)}\n\`\`\`\nLet me know if anything needs changing.`,
          ),
        )
      case 'self-correct': {
        const feedback = req.messages.length > 1 ? lastUserText(req) : ''
        if (/priority/.test(feedback) && /orderId/.test(feedback)) return say(json)
        return say(JSON.stringify({ ...sc.ticket, priority: 'urgent', orderId: '554433' }))
      }
      case 'hopeless':
        return say(L('抱歉，我看不懂这封邮件。', "Sorry, I can't make sense of this email."))
      default:
        return say(firstUserText(req) ? json : '{}')
    }
  },
  scenarios: [
    {
      id: 'clean',
      title: L('干净 JSON', 'Clean JSON'),
      async run(ctx: ScenarioCtx) {
        const { extractTicket } = ctx.load<Mod>('structured.ts')
        const t = await extractTicket(EMAILS.clean.email)
        ctx.eq(t, EMAILS.clean.ticket, L('提取结果不对（prompt 里有没有要求只输出 JSON？）', 'Wrong extraction result (does your prompt ask for JSON only?)'))
        ctx.eq(ctx.trace.llmCalls().length, 1, L('格式正确时应该只调用一次模型', 'When the format is right, call the model only once'))
      },
    },
    {
      id: 'fenced',
      title: L('代码块包裹', 'Fenced JSON'),
      async run(ctx: ScenarioCtx) {
        const { extractTicket, parseJsonLoose } = ctx.load<Mod>('structured.ts')
        ctx.eq(
          parseJsonLoose(L('前言 {"a":1} 后记', 'Preamble {"a":1} trailing notes')),
          { a: 1 },
          L('parseJsonLoose 应该能忽略 JSON 前后的文字', 'parseJsonLoose should ignore text before and after the JSON'),
        )
        const t = await extractTicket(EMAILS.fenced.email)
        ctx.eq(t, EMAILS.fenced.ticket, L('应该能剥掉 ```json 代码块', 'Strip the ```json fence'))
        ctx.eq(ctx.trace.llmCalls().length, 1, L('能解析出来就不应该重试', "Don't retry when the answer parses"))
      },
    },
    {
      id: 'self-correct',
      title: L('校验失败 → 自我修正', 'Validation error → self-correction'),
      async run(ctx: ScenarioCtx) {
        const { extractTicket } = ctx.load<Mod>('structured.ts')
        let t: Ticket
        try {
          t = await extractTicket(EMAILS['self-correct'].email)
        } catch (e) {
          return ctx.fail(
            L(
              `修正失败：${(e as Error).message}\n提示：反馈给模型的错误信息要具体，至少点名出错的字段（priority、orderId）`,
              `Self-correction failed: ${(e as Error).message}\nHint: the error you feed back must be specific; at least name the invalid fields (priority, orderId)`,
            ),
          )
        }
        ctx.eq(t, EMAILS['self-correct'].ticket, L('最终应得到通过校验的工单', 'The final result should be a ticket that passes validation'))
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 2, L('应该恰好重试一次', 'Retry exactly once'))
        const retry = calls[1].request
        ctx.eq(
          retry.messages.map((m) => m.role),
          ['user', 'assistant', 'user'],
          L('重试时应带上：原邮件(user) → 模型的错误回答(assistant) → 错误反馈(user)', "The retry should send: original email (user) → model's invalid answer (assistant) → error feedback (user)"),
        )
      },
    },
    {
      id: 'hopeless',
      title: L('重试上限', 'Retry cap'),
      async run(ctx: ScenarioCtx) {
        const { extractTicket } = ctx.load<Mod>('structured.ts')
        let threw = false
        try {
          await extractTicket(EMAILS.hopeless.email, 2)
        } catch {
          threw = true
        }
        ctx.assert(threw, L('所有重试都失败后应该抛出错误', 'Throw once every retry has failed'))
        ctx.eq(ctx.trace.llmCalls().length, 3, L('maxRetries=2 时最多调用 3 次模型', 'With maxRetries=2, call the model at most 3 times'))
      },
    },
  ],
}
