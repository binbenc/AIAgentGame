import { chat, log, type ChatRequest, type Message } from 'agent-quest'
import { runAgent } from '../../agent'
import { UNTRUSTED_POLICY, wrapUntrusted } from '../../guardrails'
import type { Tool } from '../../tools'

/** 环境提供的浏览器（原始 API） */
export interface BrowserEnv {
  observe(): Promise<string>
  click(id: number): Promise<string>
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  select(id: number, option: string): Promise<string>
  goto(url: string): Promise<string>
  back(): Promise<string>
  scroll(direction: 'up' | 'down'): Promise<string>
}

const PAGE_SOURCE = 'web_page'
const ELIDED = '（旧页面快照已省略，以最新的页面为准）'

const SYSTEM = `你是一个网页操作 Agent，替用户在“拾光优选”购物网站上完成任务。

页面以无障碍树的形式给出：[编号] 角色 "名称"。规则：
- 只能操作带编号的元素。编号只在当前页面有效，页面一变就会重新编号；每个操作工具都会返回操作结果和操作后的最新页面，永远以最新页面为准。
- 页面上有弹窗（dialog）时，先处理弹窗：促销弹窗直接关闭；确认弹窗只在确实要执行这个操作时才确认。
- 列表可能分页（“下一页”），订单列表要向下滚动才会加载更早的订单。比价、找订单时要看完所有结果，不要只看第一页。
- 标【赞助】的是广告，不一定符合条件。下单前进详情页核对规格、尺码和库存（缺货的选项会标“（缺货）”）。
- 只做用户要求的事：不要买用户没要求的东西，不要修改用户没要求修改的设置，不要取消用户没要求取消的订单。
- 如果任务做不到（商品不存在、缺货、优惠券不可用、订单已发货不能取消……），停止操作并如实说明原因，不要用相近的商品替代。
- 完成后用一两句话回答：查询类任务直接给出答案（金额、单号、数量……），操作类任务说明做了什么。

${UNTRUSTED_POLICY}`

const id = { type: 'integer', description: '元素编号，例如 [12] 就填 12' }

/** 动作之后附上最新页面（不可信内容）：模型永远拿最新的编号做下一步 */
export function createBrowserTools(browser: BrowserEnv): Tool[] {
  const page = async () => wrapUntrusted(PAGE_SOURCE, await browser.observe())
  const act = (fn: (input: any) => Promise<string>) => async (input: any) => {
    try {
      return `${await fn(input)}\n\n${await page()}`
    } catch (e) {
      // 出错时也给出最新页面：模型才知道为什么失败（比如被弹窗挡住）
      throw new Error(`${(e as Error).message}\n\n${await page()}`)
    }
  }
  const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required }) as Tool['spec']['input_schema']
  return [
    { spec: { name: 'observe', description: '查看当前页面（无障碍树）。', input_schema: obj({}, []) }, run: () => page() },
    { spec: { name: 'click', description: '点击一个元素（链接、按钮、单选框、复选框），返回结果和点击后的页面。', input_schema: obj({ id }, ['id']) }, run: act((i) => browser.click(Number(i.id))) },
    {
      spec: {
        name: 'type_text',
        description: '在输入框里输入文字（会覆盖原内容），返回结果和输入后的页面。搜索框输入后把 press_enter 设为 true 即可提交搜索。',
        input_schema: obj({ id, text: { type: 'string', description: '要输入的文字' }, press_enter: { type: 'boolean', description: '输入后是否按回车' } }, ['id', 'text']),
      },
      run: act((i) => browser.type(Number(i.id), String(i.text), !!i.press_enter)),
    },
    {
      spec: { name: 'select_option', description: '在下拉框（combobox）里选择一个选项，返回结果和选择后的页面。', input_schema: obj({ id, option: { type: 'string', description: '选项文字，例如 "42"' } }, ['id', 'option']) },
      run: act((i) => browser.select(Number(i.id), String(i.option))),
    },
    { spec: { name: 'goto', description: '打开本站的一个地址（以 / 开头，例如 "/cart"、"/product/P102"）。', input_schema: obj({ url: { type: 'string', description: '本站地址' } }, ['url']) }, run: act((i) => browser.goto(String(i.url))) },
    { spec: { name: 'go_back', description: '返回上一页。', input_schema: obj({}, []) }, run: act(() => browser.back()) },
    {
      spec: { name: 'scroll', description: '滚动页面；订单列表向下滚动会加载更早的订单。', input_schema: obj({ direction: { type: 'string', enum: ['down', 'up'] } }, ['direction']) },
      run: act((i) => browser.scroll(i.direction === 'up' ? 'up' : 'down')),
    },
  ]
}

/**
 * 只保留最新的一份页面快照：旧快照对决策没有用，却会让每一步的上下文越滚越长。
 * 操作结果那一行（“已点击 …”“已加入购物车 …”）和模型自己写的笔记都保留。
 */
export function elideOldPages(messages: Message[]): Message[] {
  let kept = false
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') {
      // 第一条消息里的初始页面：后面有了新页面就省略掉
      const at = m.content.indexOf(`<untrusted source="${PAGE_SOURCE}"`)
      if (at >= 0 && kept) out[i] = { ...m, content: `${m.content.slice(0, at)}${ELIDED}` }
      else if (at >= 0) kept = true
      continue
    }
    out[i] = {
      ...m,
      content: m.content.map((b) => {
        if (b.type !== 'tool_result' || !b.content.includes(`<untrusted source="${PAGE_SOURCE}"`)) return b
        if (!kept) {
          kept = true
          return b
        }
        return { ...b, content: `${b.content.split(`<untrusted source="${PAGE_SOURCE}"`)[0].trim()}\n${ELIDED}` }
      }),
    }
  }
  return out
}

export async function browse(goal: string, browser: BrowserEnv): Promise<{ answer?: string }> {
  const first = await browser.observe()
  const res = await runAgent(`用户的任务：${goal}\n\n当前页面：\n${wrapUntrusted(PAGE_SOURCE, first)}`, createBrowserTools(browser), {
    system: SYSTEM,
    maxSteps: 30,
    chat: (req: ChatRequest) => chat({ ...req, max_tokens: 1024, messages: elideOldPages(req.messages) }),
  })
  log(`网页 Agent 结束：${res.stopReason}，共 ${res.steps} 步。${res.output.slice(0, 100)}`)
  return { answer: res.output }
}
