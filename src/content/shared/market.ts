/**
 * 市场调研环境（第 14 关）：模拟“搜索引擎 / 规格库 / 电商评价”三个数据源。
 * 它们的返回值都是**又长又杂的原始数据**（网页摘录、规格表、评价列表），
 * 真正有用的只有其中一两句——这正是“上下文隔离 + 摘要回传”要解决的问题。
 */
import { __delay, __traced } from '../../engine/runtime/api'
import type { Tool } from './nova'

export const PRODUCT_LINES = ['智能门锁', '扫地机器人', '智能音箱'] as const
export type ProductLine = (typeof PRODUCT_LINES)[number]

export type Dimension = 'pricing' | 'specs' | 'reviews'

/** 每个维度：对应的工具集名称、工具名、原始数据标记、标签 */
export const DIMENSIONS: Record<Dimension, { toolset: string; tool: string; marker: string; label: string }> = {
  pricing: { toolset: 'web', tool: 'web_search', marker: '[RAW-WEB', label: '价格' },
  specs: { toolset: 'specs', tool: 'get_spec_sheet', marker: '[RAW-SPEC', label: '参数' },
  reviews: { toolset: 'reviews', tool: 'get_reviews', marker: '[RAW-REVIEW', label: '口碑' },
}

/** 每条产品线、每个维度真正有用的那一句 */
export const FACTS: Record<Dimension, Record<ProductLine, string>> = {
  pricing: {
    智能门锁: 'Nova L2 售价 1299 元，竞品甲 1599 元，竞品乙 999 元',
    扫地机器人: 'Nova R5 售价 2499 元，竞品甲 2999 元',
    智能音箱: 'Nova S1 售价 399 元，竞品乙 299 元',
  },
  specs: {
    智能门锁: 'Nova L2 支持 3D 人脸识别，竞品乙仅支持指纹',
    扫地机器人: 'Nova R5 吸力 5000Pa，竞品甲 6000Pa',
    智能音箱: 'Nova S1 支持 Matter 协议，竞品均不支持',
  },
  reviews: {
    智能门锁: 'Nova L2 好评率 96%，差评集中在安装复杂',
    扫地机器人: 'Nova R5 好评率 91%，竞品甲 94%',
    智能音箱: 'Nova S1 好评率 89%，主要抱怨低音偏弱',
  },
}

const NOISE: Record<Dimension, string[]> = {
  pricing: [
    '【广告】双十一爆款直降，点击领取满 999 减 100 跨店优惠券，限量 5000 张先到先得。',
    '相关搜索：智能家居哪个牌子好 / 智能家居全屋方案多少钱 / 智能家居安装师傅推荐 / 以旧换新补贴政策。',
    '网友提问：这个价格含不含安装？回答（来自热心网友）：不同城市不一样，建议问客服，我当时是免费装的，但是等了一周。',
    '比价插件显示：近 30 天最低价为活动价，历史价格曲线波动较大，618 与双十一期间通常有额外满减和赠品。',
    '本页面内容由第三方商家提供，价格以实际下单页面为准，促销规则详见活动页，最终解释权归商家所有。',
  ],
  specs: [
    '规格表版本 v3.2.1，数据来源：厂商公开资料与第三方实验室测试，部分参数为标称值，实测可能存在差异。',
    '包装清单：主机 ×1、安装支架 ×1、螺丝包 ×1、说明书 ×1、保修卡 ×1、合格证 ×1、电源适配器 ×1。',
    '工作温度 -10℃ ~ 55℃，存储温度 -20℃ ~ 70℃，相对湿度 10% ~ 90%（无冷凝），海拔 ≤ 3000m。',
    '认证信息：CCC、SRRC、CTA、RoHS、能效标识二级；外观尺寸与重量请以实物为准，颜色可能因显示器设置不同而有差异。',
    '固件更新记录：修复若干已知问题，优化联网稳定性，提升低电量提醒的准确度，新增夜间静音模式与童锁功能。',
  ],
  reviews: [
    '用户 j***8：物流很快，包装完好，客服态度好，还没用几天，先给个好评，后续使用有问题再来追评。',
    '用户 小***子：颜值在线，和家里装修风格很搭，就是说明书写得太简单了，研究了半天才弄明白怎么配网。',
    '用户 a***n：默认好评。（此用户未填写评价内容）',
    '用户 王***：第二次购买了，给爸妈家也装了一台，老人用起来也挺方便的，就是 App 广告有点多。',
    '平台提示：以上评价为买家真实评价，已过滤无意义内容与广告，评价排序综合考虑有用度和时间。',
  ],
}

function rawPage(dim: Dimension, line: ProductLine): string {
  const noise = NOISE[dim]
  const { marker } = DIMENSIONS[dim]
  // 有用的信息埋在一大堆噪音中间
  return [
    `${marker}:${line}] ===== 原始数据 · ${line} =====`,
    ...noise.slice(0, 3),
    `要点：${FACTS[dim][line]}。`,
    ...noise.slice(3),
    ...noise.slice(0, 3).map((s) => `（转载）${s}`),
    `===== 以上为 ${line} 的原始数据，共 ${noise.length * 2 + 1} 条 =====`,
  ].join('\n')
}

export function createMarket() {
  return {
    webSearch: __traced('webSearch', async (line: ProductLine) => (await __delay(300), rawPage('pricing', line))),
    specSheet: __traced('specSheet', async (line: ProductLine) => (await __delay(500), rawPage('specs', line))),
    reviews: __traced('reviews', async (line: ProductLine) => (await __delay(800), rawPage('reviews', line))),
  }
}

export type MarketApi = ReturnType<typeof createMarket>

function lineTool(name: string, description: string, run: (line: ProductLine) => Promise<string>): Tool {
  return {
    spec: {
      name,
      description,
      input_schema: {
        type: 'object',
        properties: {
          product_line: { type: 'string', enum: [...PRODUCT_LINES], description: '要调研的产品线' },
        },
        required: ['product_line'],
      },
    },
    run: (i) => run(i.product_line),
  }
}

/** 按“工具集”分组的工具：编排者给每个子任务指定一个工具集，worker 只能拿到这一组工具 */
export function marketToolsets(api: MarketApi): Record<string, Tool[]> {
  return {
    web: [lineTool('web_search', '搜索某条产品线上 Nova 与竞品的售价、促销信息。返回原始网页摘录（很长）。', api.webSearch)],
    specs: [lineTool('get_spec_sheet', '获取某条产品线上 Nova 与竞品的规格参数表。返回完整规格表（很长）。', api.specSheet)],
    reviews: [lineTool('get_reviews', '获取某条产品线上 Nova 与竞品的电商用户评价。返回评价原文列表（很长）。', api.reviews)],
  }
}
