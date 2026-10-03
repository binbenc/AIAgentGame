/**
 * P1 的模拟模型：像一个“只看上下文回答”的 LLM。
 * - 只有当答案真的出现在玩家发来的上下文里，它才能答对；
 * - 只有 system 要求标注出处时，它才会带 [块id]；
 * - 新旧文档冲突时，只有 system 要求“以最新为准”且上下文里带了更新日期，它才会用新的；
 * - 上下文里没有答案时，只有 system 允许拒答，它才会说“没有相关信息”，否则会一本正经地编。
 */
import { L } from '../../engine/locale'
import type { MockModel } from '../../engine/llm/providers/mock'
import { say, visibleText } from '../../engine/llm/mock-kit'
import { HELP_DOCS } from './docs'
import { QAS } from './tasks'

const LABEL = /\[([\w-]+(?:#\d+)?)\]/g

function labelBefore(text: string, pos: number): string | undefined {
  let last: string | undefined
  for (const m of text.matchAll(LABEL)) {
    if (m.index! > pos) break
    last = m[1]
  }
  return last
}

function occurrences(text: string, needle: string): number[] {
  const out: number[] = []
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i)
  return out
}

const HALLUCINATIONS: Record<string, string> = L(
  {
    'datacenter-city': '我们的数据中心位于上海和深圳两地。',
    'ceo-name': '极光网盘的 CEO 是王志远先生。',
    poem: '春风拂面柳丝长，桃花朵朵映山岗……',
    weather: '明天北京晴转多云，不会下雨。',
  },
  {
    'datacenter-city': 'Our data centers are in Shanghai and Shenzhen.',
    'ceo-name': "Aurora Drive's CEO is Mr. Zhiyuan Wang.",
    poem: 'Spring breeze on the willow bough, peach blossoms on the hill...',
    weather: "Tomorrow in Beijing will be sunny turning cloudy, with no rain.",
  },
)

// 关键词识别双语、不随语言切换：玩家用中文或英文写 system prompt 都能识别
const CITE_RE = /\[|引用|出处|标注|cite|citation|source/i
const REFUSE_RE =
  /没有相关信息|不知道|无法回答|拒答|不要编造|如实|no (relevant )?information|not in the (docs|sources|context|material)|don'?t know|do not know|can'?t answer|cannot answer|refuse|don'?t (make|invent|fabricate|guess)|do not (make|invent|fabricate|guess)|never (make|invent|fabricate|guess)|made[- ]up/i
const LATEST_RE = /最新|更新日期|更新时间|以新为准|最近更新|latest|most recent|newest|more recent|outdated|supersede/i

const REFUSAL = L('抱歉，资料中没有相关信息。', "Sorry, there's no information about that in the docs.")

export const mock: MockModel = (req, ctx) => {
  const qa = QAS.find((x) => x.id === ctx.scenario.split('#')[0])
  const system = req.system ?? ''
  const text = visibleText(req)
  const wantsCite = CITE_RE.test(system)
  const allowsRefuse = REFUSE_RE.test(system)
  const refuse = () => say(REFUSAL)
  if (!qa || qa.kind !== 'answer') return allowsRefuse ? refuse() : say(HALLUCINATIONS[qa?.id ?? ''] ?? L('这个问题的答案是肯定的。', 'Yes, absolutely.'))

  const parts: string[] = []
  for (const group of qa.facts ?? []) {
    let hit: { fact: string; label?: string } | undefined
    for (const fact of group)
      for (const pos of occurrences(text, fact)) {
        const label = labelBefore(text, pos)
        const fromRequired = label && qa.docs?.includes(label.split('#')[0])
        if (!hit || (fromRequired && !qa.docs?.includes(hit.label?.split('#')[0] ?? ''))) hit = { fact, label }
      }
    if (!hit) return allowsRefuse ? refuse() : say(HALLUCINATIONS[qa.id] ?? L('根据我的了解，这个功能是支持的。', 'As far as I know, that feature is supported.'))
    parts.push(`${hit.fact}${wantsCite && hit.label ? ` [${hit.label}]` : ''}`)
  }

  // 新旧文档冲突：模型只有在“知道哪篇更新”并被要求以最新为准时，才会选对
  if (qa.avoid) {
    const old = HELP_DOCS.find((d) => d.id === qa.avoid!.doc)!
    const fresh = HELP_DOCS.find((d) => d.id === qa.docs![0])!
    const oldVisible = occurrences(text, old.text.slice(0, 12)).length > 0
    const knowsDates = text.includes(old.updatedAt) && text.includes(fresh.updatedAt)
    const prefersLatest = LATEST_RE.test(system)
    if (oldVisible && !(knowsDates && prefersLatest)) {
      const pos = text.indexOf(old.text.slice(0, 12))
      const label = labelBefore(text, pos)
      return say(L(`根据资料，${old.text.slice(0, 40)}……`, `According to the docs: ${old.text.slice(0, 60)}...`) + (wantsCite && label ? ` [${label}]` : ''))
    }
  }
  return say(L(`根据帮助中心的资料：${parts.join('；')}。`, `According to the help center: ${parts.join('; ')}.`))
}
