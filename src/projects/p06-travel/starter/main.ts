import { chat, textOf } from 'agent-quest'
import { parseJsonLoose } from '../../structured'
import { TravelPlanSchema, type TravelEnv, type TravelPlan } from './types'
// 提示：前面关卡写好的模块都可以复用，例如
// import { runAgent } from '../../agent'              // 工具循环
// import { writeWithReview } from '../../refine'      // 生成 → 评审 → 修改

/**
 * 旅行规划的入口：读懂客户的需求，用产品库里的交通 / 酒店 / 餐厅 / 景点拼出一份满足全部约束的行程。
 * 需求无法满足时返回 { feasible: false, reason }。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function plan(request: string, env: TravelEnv): Promise<TravelPlan> {
  // 最朴素的版本：把需求里提到的城市的数据一股脑塞给模型，让它一次写出计划。
  // 能跑，但模型既不会算账、也记不住所有要求——试试看它能拿几分。
  const cities = (await env.cities()).filter((c) => request.includes(c))
  const month = /(\d{1,2})\s*月/.exec(request)?.[1] ?? '11'
  const dates = [...request.matchAll(/(\d{1,2})\s*[日号]/g)].map((m) => `2026-${month.padStart(2, '0')}-${m[1].padStart(2, '0')}`)
  const data: Record<string, unknown> = {}
  for (const c of cities) {
    data[`${c}的酒店`] = await env.searchHotels(c)
    data[`${c}的餐厅`] = await env.searchRestaurants(c)
    data[`${c}的景点`] = await env.searchAttractions(c)
    for (const d of cities) if (c !== d) for (const date of new Set(dates)) data[`${date} ${c}→${d}`] = await env.searchTransport(c, d, date)
  }
  const res = await chat({
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `${request}

可选的交通、酒店、餐厅和景点：
${JSON.stringify(data)}

请输出行程计划 JSON：{"feasible": true, "days": [{"date": "YYYY-MM-DD", "city": "城市", "transport": ["交通id"], "attractions": ["景点id"], "meals": {"lunch": "餐厅id", "dinner": "餐厅id"}, "hotel": "酒店id 或 null"}]}`,
      },
    ],
  })
  return TravelPlanSchema.parse(parseJsonLoose(textOf(res.content)))
}
