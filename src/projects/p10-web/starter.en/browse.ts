import { runAgent } from '../../agent'
import type { Tool } from '../../tools'
// Tip: the security helpers from level 17 (marking untrusted content) can be reused as-is
// import { UNTRUSTED_POLICY, wrapUntrusted } from '../../guardrails'

/** The browser provided by the environment (raw API). How you wrap it into tools for the model is up to you. */
export interface BrowserEnv {
  /** Accessibility tree of the current page: first line "Page: title", second line "URL: path"; interactive elements carry an [id] */
  observe(): Promise<string>
  /** Click an element (link, button, radio, checkbox); returns a one-line result */
  click(id: number): Promise<string>
  /** Type into a text field (replaces its content); pressEnter = true presses Enter afterwards */
  type(id: number, text: string, pressEnter?: boolean): Promise<string>
  /** Pick an option in a dropdown */
  select(id: number, option: string): Promise<string>
  /** Open a path on this site, e.g. "/cart" */
  goto(url: string): Promise<string>
  /** Go back to the previous page */
  back(): Promise<string>
  /** Scroll the page ("down" / "up") */
  scroll(direction: 'up' | 'down'): Promise<string>
}

/**
 * Entry point of the web agent: accomplish the user's goal on the site; for lookups, put the answer in `answer`.
 * This is a project: there's no TODO list and the architecture is up to you. Read the brief first, then the task list.
 */
export async function browse(goal: string, browser: BrowserEnv): Promise<{ answer?: string }> {
  // The most naive version: hand the raw browser actions to the model as tools.
  // Actions return only "Clicked …", not the new page, and there's no system prompt at all. See where it gets lost.
  const tools: Tool[] = [
    { spec: { name: 'observe', description: 'View the current page', input_schema: { type: 'object', properties: {} } }, run: () => browser.observe() },
    { spec: { name: 'click', description: 'Click an element', input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } }, run: (i) => browser.click(i.id) },
    {
      spec: { name: 'type', description: 'Type text', input_schema: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, enter: { type: 'boolean' } }, required: ['id', 'text'] } },
      run: (i) => browser.type(i.id, i.text, i.enter),
    },
    { spec: { name: 'select', description: 'Pick a dropdown option', input_schema: { type: 'object', properties: { id: { type: 'integer' }, option: { type: 'string' } }, required: ['id', 'option'] } }, run: (i) => browser.select(i.id, i.option) },
    { spec: { name: 'goto', description: 'Open a URL', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }, run: (i) => browser.goto(i.url) },
    { spec: { name: 'back', description: 'Go back', input_schema: { type: 'object', properties: {} } }, run: () => browser.back() },
    { spec: { name: 'scroll', description: 'Scroll', input_schema: { type: 'object', properties: { direction: { type: 'string' } }, required: ['direction'] } }, run: (i) => browser.scroll(i.direction) },
  ]
  const res = await runAgent(goal, tools, { maxSteps: 20 })
  return { answer: res.output }
}
