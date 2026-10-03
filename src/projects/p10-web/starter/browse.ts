import { runAgent } from '../../agent'
import type { Tool } from '../../tools'
// 提示：第 17 关写过的安全工具（不可信内容标记）可以直接复用
// import { UNTRUSTED_POLICY, wrapUntrusted } from '../../guardrails'

/** 环境提供的浏览器（原始 API）。怎么包装成给模型用的工具，由你决定。 */
export interface BrowserEnv {
  /** 当前页面的无障碍树：第一行“页面：标题”，第二行“URL：路径”，可交互元素带 [编号] */
  observe(): Promise<string>
  /** 点击元素（链接、按钮、单选框、复选框）；返回一句操作结果 */
  click(id: number): Promise<string>
  /** 在输入框里输入文字（覆盖原内容）；pressEnter 为 true 时随后按回车 */
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  /** 在下拉框里选择一个选项 */
  select(id: number, option: string): Promise<string>
  /** 打开本站的一个地址，例如 "/cart" */
  goto(url: string): Promise<string>
  /** 返回上一页 */
  back(): Promise<string>
  /** 滚动页面（"down" / "up"） */
  scroll(direction: 'up' | 'down'): Promise<string>
}

/**
 * 网页操作 Agent 的入口：在网站上完成用户的目标；查询类任务把答案放在 answer 里。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function browse(goal: string, browser: BrowserEnv): Promise<{ answer?: string }> {
  // 最朴素的版本：把浏览器的原始操作直接包成工具交给模型。
  // 动作只返回一句“已点击”，不返回新页面；也没有任何系统提示——试试看它会在哪里迷路。
  const tools: Tool[] = [
    { spec: { name: 'observe', description: '查看当前页面', input_schema: { type: 'object', properties: {} } }, run: () => browser.observe() },
    { spec: { name: 'click', description: '点击元素', input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } }, run: (i) => browser.click(i.id) },
    {
      spec: { name: 'type', description: '输入文字', input_schema: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, enter: { type: 'boolean' } }, required: ['id', 'text'] } },
      run: (i) => browser.type(i.id, i.text, i.enter),
    },
    { spec: { name: 'select', description: '选择下拉选项', input_schema: { type: 'object', properties: { id: { type: 'integer' }, option: { type: 'string' } }, required: ['id', 'option'] } }, run: (i) => browser.select(i.id, i.option) },
    { spec: { name: 'goto', description: '打开网址', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }, run: (i) => browser.goto(i.url) },
    { spec: { name: 'back', description: '后退', input_schema: { type: 'object', properties: {} } }, run: () => browser.back() },
    { spec: { name: 'scroll', description: '滚动', input_schema: { type: 'object', properties: { direction: { type: 'string' } }, required: ['direction'] } }, run: (i) => browser.scroll(i.direction) },
  ]
  const res = await runAgent(goal, tools, { maxSteps: 20 })
  return { answer: res.output }
}
