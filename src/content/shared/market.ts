/**
 * 市场调研环境（第 14 关）：模拟“搜索引擎 / 规格库 / 电商评价”三个数据源。
 * 它们的返回值都是**又长又杂的原始数据**（网页摘录、规格表、评价列表），
 * 真正有用的只有其中一两句——这正是“上下文隔离 + 摘要回传”要解决的问题。
 */
import { __delay, __traced } from '../../engine/runtime/api'
import type { Tool } from './nova'
import { L } from '../../engine/locale'

export const PRODUCT_LINES: readonly string[] = L(['智能门锁', '扫地机器人', '智能音箱'], ['Smart lock', 'Robot vacuum', 'Smart speaker'])
export type ProductLine = string

export type Dimension = 'pricing' | 'specs' | 'reviews'

/** 每个维度：对应的工具集名称、工具名、原始数据标记、标签 */
export const DIMENSIONS: Record<Dimension, { toolset: string; tool: string; marker: string; label: string }> = {
  pricing: { toolset: 'web', tool: 'web_search', marker: '[RAW-WEB', label: L('价格', 'Pricing') },
  specs: { toolset: 'specs', tool: 'get_spec_sheet', marker: '[RAW-SPEC', label: L('参数', 'Specs') },
  reviews: { toolset: 'reviews', tool: 'get_reviews', marker: '[RAW-REVIEW', label: L('口碑', 'Reviews') },
}

/** 每条产品线、每个维度真正有用的那一句 */
const FACTS_ZH: Record<Dimension, Record<ProductLine, string>> = {
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

const FACTS_EN: Record<Dimension, Record<ProductLine, string>> = {
  pricing: {
    'Smart lock': 'Nova L2 sells for ¥1299, Rival A ¥1599, Rival B ¥999',
    'Robot vacuum': 'Nova R5 sells for ¥2499, Rival A ¥2999',
    'Smart speaker': 'Nova S1 sells for ¥399, Rival B ¥299',
  },
  specs: {
    'Smart lock': 'Nova L2 supports 3D face recognition, Rival B supports fingerprint only',
    'Robot vacuum': 'Nova R5 has 5000Pa suction, Rival A 6000Pa',
    'Smart speaker': 'Nova S1 supports the Matter protocol, no rival does',
  },
  reviews: {
    'Smart lock': 'Nova L2 has a 96% positive rating, complaints focus on difficult installation',
    'Robot vacuum': 'Nova R5 has a 91% positive rating, Rival A 94%',
    'Smart speaker': 'Nova S1 has an 89% positive rating, main complaint is weak bass',
  },
}

/** 每条产品线、每个维度真正有用的那一句（英文版：第一个 ", " 之前是关键信息，句中没有句号） */
export const FACTS: Record<Dimension, Record<ProductLine, string>> = L(FACTS_ZH, FACTS_EN)

const NOISE_ZH: Record<Dimension, string[]> = {
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

const NOISE_EN: Record<Dimension, string[]> = {
  pricing: [
    '[Ad] Singles Day best-sellers on sale! Grab a store-wide coupon: ¥100 off orders over ¥999, limited to 5000 coupons, first come first served!',
    'Related searches: best smart home brand / whole-home smart home cost / recommended smart home installers / trade-in subsidies',
    'Q: Does this price include installation? A (from a helpful user): Depends on the city, ask support. Mine was installed for free, but I waited a week',
    'Price tracker: the lowest price in the last 30 days was a promo price; price history fluctuates a lot, with extra discounts and freebies around 618 and Singles Day',
    'This page is provided by a third-party seller; prices are subject to the checkout page, see the event page for promo rules; the seller reserves the right of final interpretation',
  ],
  specs: [
    'Spec sheet version v3.2.1; sources: public manufacturer data and third-party lab tests; some values are nominal and measured results may differ',
    'In the box: main unit ×1, mounting bracket ×1, screw pack ×1, manual ×1, warranty card ×1, certificate ×1, power adapter ×1',
    'Operating temperature -10℃ ~ 55℃, storage temperature -20℃ ~ 70℃, relative humidity 10% ~ 90% (non-condensing), altitude ≤ 3000m',
    'Certifications: CCC, SRRC, CTA, RoHS, energy efficiency grade 2; dimensions and weight may vary, colors may look different depending on your display',
    'Firmware changelog: fixed several known issues, improved connection stability, more accurate low-battery alerts, added night quiet mode and child lock',
  ],
  reviews: [
    'User j***8: Fast shipping, well packed, friendly support. Only used it a few days, five stars for now, will update if anything comes up',
    'User x***i: Looks great and fits our decor, but the manual is way too short, took me ages to figure out the Wi-Fi setup',
    'User a***n: Default positive review. (This user did not write a review)',
    "User w***g: Second purchase, got one for my parents too. Easy enough for older folks, though the app has a few too many ads",
    'Platform note: the reviews above are from verified buyers, with meaningless content and ads filtered out; sorted by helpfulness and time',
  ],
}

const NOISE: Record<Dimension, string[]> = L(NOISE_ZH, NOISE_EN)

function rawPage(dim: Dimension, line: ProductLine): string {
  const noise = NOISE[dim]
  const { marker } = DIMENSIONS[dim]
  // 有用的信息埋在一大堆噪音中间
  return L(
    [
      `${marker}:${line}] ===== 原始数据 · ${line} =====`,
      ...noise.slice(0, 3),
      `要点：${FACTS[dim][line]}。`,
      ...noise.slice(3),
      ...noise.slice(0, 3).map((s) => `（转载）${s}`),
      `===== 以上为 ${line} 的原始数据，共 ${noise.length * 2 + 1} 条 =====`,
    ],
    [
      `${marker}:${line}] ===== Raw data · ${line} =====`,
      ...noise.slice(0, 3),
      `Key point: ${FACTS[dim][line]}.`,
      ...noise.slice(3),
      ...noise.slice(0, 3).map((s) => `(Repost) ${s}`),
      `===== End of raw data for ${line}, ${noise.length * 2 + 1} entries =====`,
    ],
  ).join('\n')
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
          product_line: { type: 'string', enum: [...PRODUCT_LINES], description: L('要调研的产品线', 'Product line to research') },
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
    web: [lineTool('web_search', L('搜索某条产品线上 Nova 与竞品的售价、促销信息。返回原始网页摘录（很长）。', 'Search prices and promotions for Nova and its rivals in a product line. Returns raw web page excerpts (long).'), api.webSearch)],
    specs: [lineTool('get_spec_sheet', L('获取某条产品线上 Nova 与竞品的规格参数表。返回完整规格表（很长）。', 'Get the spec sheets of Nova and its rivals in a product line. Returns the full spec sheet (long).'), api.specSheet)],
    reviews: [lineTool('get_reviews', L('获取某条产品线上 Nova 与竞品的电商用户评价。返回评价原文列表（很长）。', 'Get e-commerce user reviews of Nova and its rivals in a product line. Returns the full list of reviews (long).'), api.reviews)],
  }
}
