import { chat, log, type ChatRequest, type Message } from 'agent-quest'
import { runAgent } from '../../agent'
import { UNTRUSTED_POLICY, wrapUntrusted } from '../../guardrails'
import type { Tool } from '../../tools'

/** The browser provided by the environment (raw API) */
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
const ELIDED = '(older page snapshot omitted; the latest page is what counts)'

const SYSTEM = `You are a web agent that completes tasks for the user on the "Glimmer Mart" shopping site.

Pages are given as an accessibility tree: [id] role "name". Rules:
- You can only act on elements that have an id. Ids are valid only for the current page and are reassigned whenever the page changes. Every action tool returns the result plus the latest page after the action; always go by the latest page.
- If a dialog is open, deal with it first: close promo popups; confirm a confirmation dialog only if you really mean to do that action.
- Lists may be paginated ("Next page"), and the order list loads older orders only when you scroll down. When comparing prices or looking for an order, go through all results, not just the first page.
- Items marked [Sponsored] are ads and may not match the request. Before buying, open the product page and check the options, size and stock (out-of-stock options are marked "(out of stock)").
- Only do what the user asked: don't buy anything they didn't ask for, don't change settings they didn't ask to change, don't cancel orders they didn't ask to cancel.
- If the task can't be done (the product doesn't exist, it's out of stock, the coupon doesn't work, the order has shipped and can't be cancelled…), stop and honestly explain why. Don't substitute a similar product.
- When done, answer in a sentence or two: for lookups give the answer directly (amount, tracking number, count…); for actions say what you did.

${UNTRUSTED_POLICY}`

const id = { type: 'integer', description: 'Element id, e.g. 12 for [12]' }

/** Attach the latest page (untrusted content) after every action, so the model always uses current ids */
export function createBrowserTools(browser: BrowserEnv): Tool[] {
  const page = async () => wrapUntrusted(PAGE_SOURCE, await browser.observe())
  const act = (fn: (input: any) => Promise<string>) => async (input: any) => {
    try {
      return `${await fn(input)}\n\n${await page()}`
    } catch (e) {
      // Return the latest page on errors too, so the model can see why it failed (e.g. a popup is in the way)
      throw new Error(`${(e as Error).message}\n\n${await page()}`)
    }
  }
  const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required }) as Tool['spec']['input_schema']
  return [
    { spec: { name: 'observe', description: 'View the current page (accessibility tree).', input_schema: obj({}, []) }, run: () => page() },
    { spec: { name: 'click', description: 'Click an element (link, button, radio, checkbox). Returns the result and the page after the click.', input_schema: obj({ id }, ['id']) }, run: act((i) => browser.click(Number(i.id))) },
    {
      spec: {
        name: 'type_text',
        description: 'Type into a text field (replaces its content). Returns the result and the page afterwards. For the search box, set press_enter to true to submit the search.',
        input_schema: obj({ id, text: { type: 'string', description: 'Text to type' }, press_enter: { type: 'boolean', description: 'Press Enter after typing' } }, ['id', 'text']),
      },
      run: act((i) => browser.type(Number(i.id), String(i.text), !!i.press_enter)),
    },
    {
      spec: { name: 'select_option', description: 'Pick an option in a dropdown (combobox). Returns the result and the page afterwards.', input_schema: obj({ id, option: { type: 'string', description: 'Option text, e.g. "42"' } }, ['id', 'option']) },
      run: act((i) => browser.select(Number(i.id), String(i.option))),
    },
    { spec: { name: 'goto', description: 'Open a path on this site (starting with /, e.g. "/cart", "/product/P102").', input_schema: obj({ url: { type: 'string', description: 'Path on this site' } }, ['url']) }, run: act((i) => browser.goto(String(i.url))) },
    { spec: { name: 'go_back', description: 'Go back to the previous page.', input_schema: obj({}, []) }, run: act(() => browser.back()) },
    {
      spec: { name: 'scroll', description: 'Scroll the page. Scrolling down the order list loads older orders.', input_schema: obj({ direction: { type: 'string', enum: ['down', 'up'] } }, ['direction']) },
      run: act((i) => browser.scroll(i.direction === 'up' ? 'up' : 'down')),
    },
  ]
}

/**
 * Keep only the latest page snapshot: older snapshots don't help with the next decision, but they make every step's context longer.
 * Action results ("Clicked …", "Added to cart …") and the model's own notes are kept.
 */
export function elideOldPages(messages: Message[]): Message[] {
  let kept = false
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') {
      // The initial page in the first message: drop it once there's a newer page
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
  const res = await runAgent(`User's task: ${goal}\n\nCurrent page:\n${wrapUntrusted(PAGE_SOURCE, first)}`, createBrowserTools(browser), {
    system: SYSTEM,
    maxSteps: 30,
    chat: (req: ChatRequest) => chat({ ...req, max_tokens: 1024, messages: elideOldPages(req.messages) }),
  })
  log(`Web agent finished: ${res.stopReason}, ${res.steps} steps. ${res.output.slice(0, 100)}`)
  return { answer: res.output }
}
