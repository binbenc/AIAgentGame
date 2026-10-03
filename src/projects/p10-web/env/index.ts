/**
 * P10 的环境：一个全新的模拟网站 + 交给玩家的浏览器 API（BrowserEnv）。
 * 所有动作都通过 ctx.traced 记录到 trace；判定器读取网站的最终状态（订单、购物车、地址、商家后台）。
 */
import type { EnvCtx } from '../../types'
import { WebApp, type AppOptions } from './app'
import { freshData, type ShopData } from './data'

/** 交给玩家 browse() 的浏览器 */
export interface BrowserEnv {
  /** 当前页面的无障碍树文本：第一行“页面：标题”，第二行“URL：路径”，可交互元素带 [编号] */
  observe(): Promise<string>
  /** 点击元素（链接、按钮、单选框、复选框） */
  click(id: number): Promise<string>
  /** 在输入框里输入文字（覆盖原内容）；pressEnter 为 true 时随后按下回车（例如提交搜索） */
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  /** 在下拉框里选择一个选项 */
  select(id: number, option: string): Promise<string>
  /** 打开本站的一个地址，例如 "/cart" */
  goto(url: string): Promise<string>
  /** 返回上一页 */
  back(): Promise<string>
  /** 滚动页面（"down" / "up"）；有的列表要向下滚动才会加载更多 */
  scroll(direction: 'up' | 'down'): Promise<string>
}

export interface WebEnv {
  browser: BrowserEnv
  app: WebApp
  /** 初始数据（判定时用来比较“哪些东西被改了”） */
  initial: ShopData
}

export function createWebEnv(opts: AppOptions, ctx: EnvCtx): WebEnv {
  const app = new WebApp(opts)
  const initial = structuredClone(app.data)
  const step = <A extends unknown[]>(name: string, ms: number, fn: (...args: A) => string) =>
    ctx.traced(name, async (...args: A) => {
      await ctx.delay(ms)
      const out = fn(...args)
      ctx.log(`🌐 ${name}(${args.map((a) => JSON.stringify(a)).join(', ')}) → ${out.split('\n')[0].slice(0, 100)}`)
      return out
    })
  const browser: BrowserEnv = {
    observe: step('observe', 50, () => app.observe()),
    click: step('click', 200, (id: number) => app.click(id)),
    type: step('type', 150, (id: number, text: string, pressEnter?: boolean) => app.type(id, text, pressEnter)),
    select: step('select', 150, (id: number, option: string) => app.select(id, option)),
    goto: step('goto', 300, (url: string) => app.goto(url)),
    back: step('back', 200, () => app.back()),
    scroll: step('scroll', 100, (direction: 'up' | 'down') => app.scroll(direction)),
  }
  return { browser, app, initial: initial ?? freshData() }
}
