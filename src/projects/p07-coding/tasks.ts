/**
 * P7 的任务：每个任务 = 一个 issue + 植入 bug 的仓库 + 隐藏测试。
 * 判定方式照搬 SWE-bench：在 Agent 改完的仓库上，
 * - FAIL_TO_PASS：隐藏测试（issue 对应的测试）必须通过；
 * - PASS_TO_PASS：仓库原有的测试不能被改坏；
 * - 测试文件不允许修改。
 */
import { L } from '../../engine/locale'
import type { CheckResult, ProjectTask } from '../types'
import { applyPatch, BASE_REPOS, runSuite, testFilesOf, type CodingEnv, type Files, type Patch, type RepoName, type SuiteResult } from './env'

const HIDDEN = L(
  import.meta.glob('./hidden/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  import.meta.glob('./hidden.en/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)

/** 判定时隐藏测试放在这个路径（会覆盖 Agent 写的同名文件） */
export const HIDDEN_PATH = 'test/issue.hidden.test.ts'

/** 模拟模型对核心任务的“领域知识”：知道该怎么修，但只能通过玩家的工具、在看到代码之后才能动手 */
export interface MockSpec {
  /** issue 里点名的文件（可能是误导），模型会先去看它 */
  mentions?: string
  /**
   * issue 猜错原因时的“照猜测去改”：模型没法调查（一次性 prompt，或者找不到真正的文件）时，
   * 它会相信 issue，在点名的文件里做一个看似合理、实际无效的修改
   */
  decoy?: { patch: Patch; summary: string }
  /** 模型会用来搜索的关键词 */
  search: string
  /** 回归陷阱：模型第一次会照 issue 的建议做一个“朴素修复”，它会弄坏一个已有测试 */
  trap?: { naive: string; naiveSummary: string; brokenTest: string; cheat: Patch }
  summary: string
}

export interface CodingTaskDef {
  id: string
  title: string
  core: boolean
  repo: RepoName
  /** 题型标签 */
  kind: string
  issue: string
  /** 把基线仓库变成“有 bug 的仓库”的补丁；核心任务的标准修复就是它的逆补丁 */
  seed: Patch[]
  mock?: MockSpec
}

const t = (x: CodingTaskDef) => x

const ZH_TASKS: CodingTaskDef[] = [
  // ———————————————— 核心任务（模拟模型可解，参与评星） ————————————————
  t({
    id: 'cart-min-spend',
    title: '满减门槛差一分',
    core: true,
    repo: 'cartcalc',
    kind: '边界条件（off-by-one）',
    issue: `### 满 100 减 20 的券，刚好 100 元时用不了

**复现步骤**
1. 购物车里放 2 个 50 元的帆布包（小计 10000 分）
2. 使用满减券 \`F20\`：\`{ code: 'F20', kind: 'fixed', value: 2000, minSpend: 10000 }\`
3. 调用 \`checkout(items, [F20])\`

**期望**：total = 8000，coupons = ['F20']
**实际**：total = 10000，券没有生效

活动规则写的是“满 100 元减 20 元”，满 100 当然包括正好 100。运营那边已经收到好几个投诉了。`,
    seed: [
      {
        path: 'src/coupons.ts',
        find: '    if (c.minSpend !== undefined && subtotal < c.minSpend) continue',
        replace: '    if (c.minSpend !== undefined && subtotal <= c.minSpend) continue',
      },
    ],
    mock: { search: 'minSpend', summary: '满减门槛的比较从 `<=` 改成 `<`，小计恰好等于门槛时也能使用满减券' },
  }),
  t({
    id: 'cart-tax-rounding',
    title: '税额少一分钱',
    core: true,
    repo: 'cartcalc',
    kind: '舍入错误（issue 猜错了原因）',
    issue: `### 含税总价少了 1 分钱（浮点精度问题？）

商品 19.99 元（1999 分），税率 13%：

\`\`\`ts
checkout([{ sku: 'MUG', name: '马克杯', unitPrice: 1999, quantity: 1 }], [], 0.13)
\`\`\`

**期望**：tax = 260（1999 × 0.13 = 259.87，四舍五入是 260），total = 2259
**实际**：tax = 259，total = 2258

我猜是 \`src/checkout.ts\` 里金额加来加去产生了浮点误差？财务对账每天都对不上几分钱。`,
    seed: [{ path: 'src/tax.ts', find: '  return Math.round(cents * rate)', replace: '  return Math.floor(cents * rate)' }],
    mock: {
      mentions: 'src/checkout.ts',
      decoy: {
        patch: {
          path: 'src/checkout.ts',
          find: '  const tax = taxFor(afterCoupons, taxRate)',
          replace: '  // 修复浮点误差：先取整到分再计税\n  const tax = taxFor(Math.round(afterCoupons), taxRate)',
        },
        summary: '按 issue 的判断，在 checkout.ts 里先把金额取整再计税，避免浮点误差',
      },
      search: 'taxFor',
      summary: '问题不在 checkout.ts，而是 tax.ts 里税额用了 `Math.floor` 向下取整；改成 `Math.round` 四舍五入到分' },
  }),
  t({
    id: 'md-escape-order',
    title: '转义了两次',
    core: true,
    repo: 'mdlite',
    kind: '转义顺序',
    issue: `### 标题里的 \`<\` 被渲染成了 \`&amp;lt;\`

输入：

\`\`\`md
# a < b
\`\`\`

**期望**：\`<h1>a &lt; b</h1>\`
**实际**：\`<h1>a &amp;lt; b</h1>\`，页面上直接显示出了 \`&lt;\` 这几个字符。

\`>\` 也一样。看起来是被转义了两次——是不是渲染标题的时候又调用了一次 escapeHtml？`,
    seed: [
      {
        path: 'src/escape.ts',
        find: `  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')`,
        replace: `  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;').replace(/"/g, '&quot;')`,
      },
    ],
    mock: { search: 'escapeHtml', summary: 'escapeHtml 先替换了 `<`/`>`，再替换 `&` 时把刚生成的 `&lt;` 又转义成了 `&amp;lt;`；改成先替换 `&`' },
  }),
  t({
    id: 'md-underscore',
    title: '下划线误伤（回归陷阱）',
    core: true,
    repo: 'mdlite',
    kind: '回归陷阱：照 issue 的建议改会弄坏已有测试',
    issue: `### \`snake_case\` 变量名被渲染成了斜体

我们的 API 文档里到处是变量名：

\`\`\`md
调用 get_user_by_id() 获取用户
\`\`\`

渲染结果是 \`调用 get<em>user</em>by_id() 获取用户\`，变量名直接变成了斜体。

建议：干脆去掉 \`_斜体_\` 的支持吧，反正大家都用 \`*斜体*\`。`,
    seed: [
      {
        path: 'src/inline.ts',
        find: String.raw`  out = out.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')`,
        replace: String.raw`  out = out.replace(/_([^_]+)_/g, '<em>$1</em>')`,
      },
    ],
    mock: {
      search: 'renderInline',
      trap: {
        naive: '  // _斜体_ 会误伤 snake_case 变量名，按 issue 的建议去掉',
        naiveSummary: '按 issue 的建议去掉了 `_斜体_` 语法的支持，snake_case 不会再被渲染成斜体',
        brokenTest: '下划线斜体',
        cheat: {
          path: 'test/inline.test.ts',
          find: `  expect(renderInline('_italic_')).toBe('<em>italic</em>')`,
          replace: `  expect(renderInline('_italic_')).toBe('_italic_')`,
        },
      },
      summary: '`_斜体_` 只在两侧不是单词字符时才生效（`(^|[^\\w])_..._(?!\\w)`），单词内部的下划线不再被当成强调，原有的 `_italic_` 语法保持可用',
    },
  }),
  t({
    id: 'date-leap-year',
    title: '2000 年不是闰年？',
    core: true,
    repo: 'datekit',
    kind: 'bug 不在 issue 说的文件里',
    issue: `### addMonths 在 2000 年 2 月算错了

\`\`\`ts
addMonths({ year: 2000, month: 1, day: 31 }, 1)
\`\`\`

**期望**：\`{ year: 2000, month: 2, day: 29 }\`（2000 年是闰年）
**实际**：\`{ year: 2000, month: 2, day: 28 }\`

2024 年是对的，只有 2000 年不对。我看了一下 \`src/add.ts\` 里 \`addMonths\` 的月末截断逻辑，是不是 \`Math.min(d.day, ...)\` 这里有问题？`,
    seed: [
      {
        path: 'src/date.ts',
        find: '  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0',
        replace: '  return year % 4 === 0 && year % 100 !== 0',
      },
    ],
    mock: {
      mentions: 'src/add.ts',
      decoy: {
        patch: {
          path: 'src/add.ts',
          find: '  const day = Math.min(d.day, daysInMonth(year, month))',
          replace: '  // 月末截断：结果必须落在目标月的有效日期范围内\n  const day = Math.max(1, Math.min(d.day, daysInMonth(year, month)))',
        },
        summary: '按 issue 的判断，加固了 addMonths 的月末截断逻辑',
      },
      search: 'daysInMonth',
      summary: 'addMonths 本身没问题，根因是 date.ts 的 isLeapYear 漏了“能被 400 整除的是闰年”这条规则' },
  }),
  t({
    id: 'date-end-of-month',
    title: '新增 endOfMonth',
    core: true,
    repo: 'datekit',
    kind: '小功能（要改两个文件）',
    issue: `### 功能请求：增加 endOfMonth()

做账单周期时经常需要“这个月的最后一天”，现在只能自己拿 \`daysInMonth\` 拼。希望增加：

\`\`\`ts
import { endOfMonth } from 'datekit' // 包入口是 src/index.ts
endOfMonth({ year: 2024, month: 2, day: 10 }) // → { year: 2024, month: 2, day: 29 }
\`\`\`

和 \`addMonths\` 放在同一个文件里就行。`,
    seed: [
      {
        path: 'src/add.ts',
        find: `/** 当月的最后一天 */
export function endOfMonth(d: SimpleDate): SimpleDate {
  return { year: d.year, month: d.month, day: daysInMonth(d.year, d.month) }
}

/** 加 n 天（n 可以为负） */`,
        replace: '/** 加 n 天（n 可以为负） */',
      },
      { path: 'src/index.ts', find: "export { addDays, addMonths, endOfMonth } from './add'", replace: "export { addDays, addMonths } from './add'" },
    ],
    mock: { mentions: 'src/index.ts', search: 'addMonths', summary: '在 src/add.ts 新增 endOfMonth，并在 src/index.ts 里导出' },
  }),

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  t({
    id: 'date-add-days-back',
    title: '3 月 0 日',
    core: false,
    repo: 'datekit',
    kind: '边界条件（off-by-one）',
    issue: `### addDays 往前减一天得到了“3 月 0 日”

\`\`\`ts
addDays({ year: 2024, month: 3, day: 1 }, -1)
\`\`\`

**期望**：\`{ year: 2024, month: 2, day: 29 }\`
**实际**：\`{ year: 2024, month: 3, day: 0 }\`

往前减 5 天之类的是好的，只有正好跨到上个月最后一天时出问题。`,
    seed: [{ path: 'src/add.ts', find: '  while (day < 1) {', replace: '  while (day < 0) {' }],
  }),
  t({
    id: 'date-format-pad',
    title: '9 月没补零',
    core: false,
    repo: 'datekit',
    kind: '边界条件（off-by-one）',
    issue: `### formatDate 九月份没有补零

\`formatDate({ year: 2024, month: 9, day: 9 })\` 得到 \`2024-9-9\`，期望 \`2024-09-09\`。

一月到八月都正常，十月以后也正常，就九月（还有 9 号）不对，太诡异了。`,
    seed: [{ path: 'src/format.ts', find: '  return n < 10 ? `0${n}` : String(n)', replace: '  return n < 9 ? `0${n}` : String(n)' }],
  }),
  t({
    id: 'date-add-months-negative',
    title: '减月份跨年',
    core: false,
    repo: 'datekit',
    kind: '负数取整',
    issue: `### addMonths 传负数时年份不对

\`\`\`ts
addMonths({ year: 2024, month: 1, day: 15 }, -1)
\`\`\`

**期望**：\`{ year: 2023, month: 12, day: 15 }\`
**实际**：\`{ year: 2024, month: 12, day: 15 }\`——直接跑到年底去了。

文档说 n 可以为负数。`,
    seed: [
      { path: 'src/add.ts', find: '  const year = d.year + Math.floor(zeroBased / 12)', replace: '  const year = d.year + Math.trunc(zeroBased / 12)' },
    ],
  }),
  t({
    id: 'date-parse-invalid',
    title: '不存在的日期',
    core: false,
    repo: 'datekit',
    kind: '缺少校验',
    issue: `### parseDate 接受了不存在的日期

\`parseDate('2023-02-30')\` 没有报错，返回了 \`{ year: 2023, month: 2, day: 30 }\`。\`2024-04-31\` 也一样。

README 说“格式不对或日期不存在时抛错”。用户在表单里随便输个日期就能下单了。`,
    seed: [
      {
        path: 'src/date.ts',
        find: '  if (d.day < 1 || d.day > daysInMonth(d.year, d.month)) throw new RangeError(`无效的日期：${s}`)',
        replace: '  if (d.day < 1 || d.day > 31) throw new RangeError(`无效的日期：${s}`)',
      },
    ],
  }),
  t({
    id: 'cart-best-percent',
    title: '多张折扣券',
    core: false,
    repo: 'cartcalc',
    kind: '业务规则',
    issue: `### 同时有 9 折和 8 折券，只给我打了 9 折

\`applyCoupons(10000, [P10, P20])\`（P10 = 减 10%，P20 = 减 20%）结果是 9000，期望 8000。

README 写的是“自动选折扣力度最大的那张”。把 P20 放在前面就对了，看起来和顺序有关。`,
    seed: [{ path: 'src/coupons.ts', find: '    const best = percents.reduce((a, b) => (b.value > a.value ? b : a))', replace: '    const best = percents[0]' }],
  }),
  t({
    id: 'cart-negative-total',
    title: '总价变成负数',
    core: false,
    repo: 'cartcalc',
    kind: '缺少边界处理',
    issue: `### 礼品卡金额大于订单金额时，总价是负数

50 元的钢笔用了 100 元礼品卡（\`{ code: 'GIFT100', kind: 'fixed', value: 10000 }\`），\`checkout\` 返回 total = -5000，税也变成了负数。

期望：total = 0，tax = 0，discount = 5000。`,
    seed: [{ path: 'src/coupons.ts', find: '  return { total: Math.max(0, total), applied }', replace: '  return { total, applied }' }],
  }),
  t({
    id: 'cart-quantity',
    title: '数量校验',
    core: false,
    repo: 'cartcalc',
    kind: '功能：输入校验',
    issue: `### subtotal 应该拒绝无效的数量

现在 \`quantity: 0\`、\`quantity: -2\`、\`quantity: 1.5\` 都能算出小计（负数还会让总价变少）。

希望和单价校验保持一致：数量不是正整数时抛 \`RangeError\`，错误信息包含“数量无效”。`,
    seed: [
      {
        path: 'src/cart.ts',
        find:
          '    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new RangeError(`商品 ${item.sku} 的数量无效：${item.quantity}`)\n' +
          '    if (!Number.isInteger(item.unitPrice)',
        replace: '    if (!Number.isInteger(item.unitPrice)',
      },
    ],
  }),
  t({
    id: 'md-heading-7',
    title: '七级标题',
    core: false,
    repo: 'mdlite',
    kind: '边界条件（off-by-one）',
    issue: `### \`#######\` 被渲染成了 \`<h7>\`

HTML 里没有 h7。按 CommonMark，超过 6 个 # 就不是标题，应该当普通段落：

\`renderMarkdown('####### seven')\` 期望 \`<p>####### seven</p>\`。`,
    seed: [{ path: 'src/block.ts', find: String.raw`/^(#{1,6})\s+(.*)$/`, replace: String.raw`/^(#{1,7})\s+(.*)$/` }],
  }),
  t({
    id: 'md-list-close',
    title: '列表没闭合',
    core: false,
    repo: 'mdlite',
    kind: '缺少边界处理',
    issue: `### 文档以列表结尾时少了 \`</ul>\`

\`renderMarkdown('- a\\n- b')\` 输出 \`<ul>\\n<li>a</li>\\n<li>b</li>\`，没有 \`</ul>\`，后面拼接的 HTML 全都缩进到列表里了。列表后面跟空行或段落时是正常的。`,
    seed: [
      {
        path: 'src/block.ts',
        find: String.raw`  closeList()
  return out.join('\n')`,
        replace: String.raw`  return out.join('\n')`,
      },
    ],
  }),
  t({
    id: 'md-code-span',
    title: '代码里的星号',
    core: false,
    repo: 'mdlite',
    kind: '处理顺序',
    issue: `### 行内代码里的 \`*\` 被当成了斜体

\`\`\`md
\`a*b*c\`
\`\`\`

期望 \`<code>a*b*c</code>\`，实际 \`<code>a<em>b</em>c</code>\`。代码里的 \`_x_\` 也有同样的问题。代码片段里的内容应该原样输出（当然还是要做 HTML 转义）。`,
    seed: [
      {
        path: 'src/inline.ts',
        find: String.raw`  // 先把行内代码抠出来换成占位符，避免代码里的 * 和 _ 被当成强调
  const codes: string[] = []
  let out = text.replace(/` + '`([^`]+)`' + String.raw`/g, (_m, code: string) => {
    codes.push(code)
    return ` + '`\\u0000${codes.length - 1}\\u0000`' + String.raw`
  })

  out = escapeHtml(out)`,
        replace: '  let out = escapeHtml(text)',
      },
      {
        path: 'src/inline.ts',
        find: String.raw`  // 把代码放回去（代码内容同样要转义）
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => ` + '`<code>${escapeHtml(codes[Number(i)])}</code>`)',
        replace: "  return out.replace(/`([^`]+)`/g, '<code>$1</code>')",
      },
    ],
  }),
  t({
    id: 'md-strikethrough',
    title: '支持删除线',
    core: false,
    repo: 'mdlite',
    kind: '功能请求',
    issue: `### 功能请求：支持 \`~~删除线~~\`

价格调整的公告里想写 \`原价 ~~100~~ 现价 80\`。希望 \`~~文字~~\` 渲染成 \`<del>文字</del>\`，和粗体、斜体一样在行内生效。`,
    seed: [
      {
        path: 'src/inline.ts',
        find: String.raw`  out = out.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')`,
        replace: String.raw`  out = out.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')`,
      },
    ],
  }),
]

/** English version of each task: text, plus seeds / mock patches whose code contains comments or messages (they must match repos.en/) */
type EnTask = Pick<CodingTaskDef, 'title' | 'kind' | 'issue'> & Partial<Pick<CodingTaskDef, 'seed' | 'mock'>>

const EN_TASKS: Record<string, EnTask> = {
  // ———————————————— core ————————————————
  'cart-min-spend': {
    title: 'Off by one cent at the minimum spend',
    kind: 'Boundary condition (off-by-one)',
    issue: `### "¥20 off ¥100" coupon doesn't apply at exactly ¥100

**Steps to reproduce**
1. Put 2 tote bags at ¥50 each in the cart (subtotal 10000 cents)
2. Use the coupon \`F20\`: \`{ code: 'F20', kind: 'fixed', value: 2000, minSpend: 10000 }\`
3. Call \`checkout(items, [F20])\`

**Expected**: total = 8000, coupons = ['F20']
**Actual**: total = 10000, the coupon is ignored

The promo says "¥20 off orders of ¥100 or more" — exactly ¥100 obviously counts. Support has already had several complaints.`,
    mock: { search: 'minSpend', summary: 'changed the minimum-spend check from `<=` to `<`, so the coupon applies when the subtotal equals the minimum' },
  },
  'cart-tax-rounding': {
    title: 'Tax is one cent short',
    kind: 'Rounding bug (the issue guesses the wrong cause)',
    issue: `### Total with tax is 1 cent short (floating-point precision?)

Item at ¥19.99 (1999 cents), 13% tax:

\`\`\`ts
checkout([{ sku: 'MUG', name: 'Mug', unitPrice: 1999, quantity: 1 }], [], 0.13)
\`\`\`

**Expected**: tax = 260 (1999 × 0.13 = 259.87, which rounds to 260), total = 2259
**Actual**: tax = 259, total = 2258

My guess is floating-point error from all the additions in \`src/checkout.ts\`? Finance's reconciliation is off by a few cents every day.`,
    mock: {
      mentions: 'src/checkout.ts',
      decoy: {
        patch: {
          path: 'src/checkout.ts',
          find: '  const tax = taxFor(afterCoupons, taxRate)',
          replace: '  // Fix floating-point error: round to cents before computing tax\n  const tax = taxFor(Math.round(afterCoupons), taxRate)',
        },
        summary: 'following the issue, rounded the amount to cents in checkout.ts before computing tax to avoid floating-point error',
      },
      search: 'taxFor',
      summary: "the bug isn't in checkout.ts: tax.ts used `Math.floor`, which always rounds down; changed it to `Math.round` to round to the nearest cent",
    },
  },
  'md-escape-order': {
    title: 'Escaped twice',
    kind: 'Escaping order',
    issue: `### \`<\` in a heading renders as \`&amp;lt;\`

Input:

\`\`\`md
# a < b
\`\`\`

**Expected**: \`<h1>a &lt; b</h1>\`
**Actual**: \`<h1>a &amp;lt; b</h1>\`, so the page literally shows \`&lt;\`.

Same with \`>\`. Looks like it's escaped twice — does the heading renderer call escapeHtml a second time?`,
    mock: { search: 'escapeHtml', summary: 'escapeHtml replaced `<`/`>` first, so replacing `&` afterwards turned the new `&lt;` into `&amp;lt;`; it now replaces `&` first' },
  },
  'md-underscore': {
    title: 'Underscores gone wrong (regression trap)',
    kind: "Regression trap: following the issue's suggestion breaks an existing test",
    issue: `### \`snake_case\` names render as italics

Our API docs are full of variable names:

\`\`\`md
Call get_user_by_id() to fetch the user
\`\`\`

renders as \`Call get<em>user</em>by_id() to fetch the user\` — the name turns into italics.

Suggestion: just drop \`_italic_\` support, everyone uses \`*italic*\` anyway.`,
    mock: {
      search: 'renderInline',
      trap: {
        naive: '  // _italic_ breaks snake_case names; removed as suggested in the issue',
        naiveSummary: 'removed `_italic_` support as the issue suggested, so snake_case is no longer rendered as italics',
        brokenTest: 'underscore italic',
        cheat: {
          path: 'test/inline.test.ts',
          find: `  expect(renderInline('_italic_')).toBe('<em>italic</em>')`,
          replace: `  expect(renderInline('_italic_')).toBe('_italic_')`,
        },
      },
      summary:
        '`_italic_` now only applies when neither side is a word character (`(^|[^\\w])_..._(?!\\w)`), so underscores inside words are no longer emphasis and the existing `_italic_` syntax still works',
    },
  },
  'date-leap-year': {
    title: 'Is 2000 not a leap year?',
    kind: "The bug isn't in the file the issue names",
    issue: `### addMonths gets February 2000 wrong

\`\`\`ts
addMonths({ year: 2000, month: 1, day: 31 }, 1)
\`\`\`

**Expected**: \`{ year: 2000, month: 2, day: 29 }\` (2000 is a leap year)
**Actual**: \`{ year: 2000, month: 2, day: 28 }\`

2024 works, only 2000 is wrong. I looked at the end-of-month clamping in \`addMonths\` in \`src/add.ts\` — is the \`Math.min(d.day, ...)\` the problem?`,
    mock: {
      mentions: 'src/add.ts',
      decoy: {
        patch: {
          path: 'src/add.ts',
          find: '  const day = Math.min(d.day, daysInMonth(year, month))',
          replace: '  // Clamp to end of month: the result must be a valid day of the target month\n  const day = Math.max(1, Math.min(d.day, daysInMonth(year, month)))',
        },
        summary: "following the issue, hardened addMonths' end-of-month clamping",
      },
      search: 'daysInMonth',
      summary: 'addMonths was fine; the root cause was isLeapYear in date.ts missing the "divisible by 400 is a leap year" rule',
    },
  },
  'date-end-of-month': {
    title: 'Add endOfMonth',
    kind: 'Small feature (touches two files)',
    issue: `### Feature request: add endOfMonth()

Billing cycles keep needing "the last day of this month", and right now we build it by hand from \`daysInMonth\`. Please add:

\`\`\`ts
import { endOfMonth } from 'datekit' // the package entry is src/index.ts
endOfMonth({ year: 2024, month: 2, day: 10 }) // → { year: 2024, month: 2, day: 29 }
\`\`\`

Putting it in the same file as \`addMonths\` is fine.`,
    seed: [
      {
        path: 'src/add.ts',
        find: `/** Last day of the month */
export function endOfMonth(d: SimpleDate): SimpleDate {
  return { year: d.year, month: d.month, day: daysInMonth(d.year, d.month) }
}

/** Add n days (n may be negative) */`,
        replace: '/** Add n days (n may be negative) */',
      },
      { path: 'src/index.ts', find: "export { addDays, addMonths, endOfMonth } from './add'", replace: "export { addDays, addMonths } from './add'" },
    ],
    mock: { mentions: 'src/index.ts', search: 'addMonths', summary: 'added endOfMonth to src/add.ts and exported it from src/index.ts' },
  },

  // ———————————————— full set ————————————————
  'date-add-days-back': {
    title: 'March 0th',
    kind: 'Boundary condition (off-by-one)',
    issue: `### addDays going back one day gives "March 0"

\`\`\`ts
addDays({ year: 2024, month: 3, day: 1 }, -1)
\`\`\`

**Expected**: \`{ year: 2024, month: 2, day: 29 }\`
**Actual**: \`{ year: 2024, month: 3, day: 0 }\`

Going back 5 days and so on works; it only breaks when you land exactly on the last day of the previous month.`,
  },
  'date-format-pad': {
    title: 'September not padded',
    kind: 'Boundary condition (off-by-one)',
    issue: `### formatDate doesn't zero-pad September

\`formatDate({ year: 2024, month: 9, day: 9 })\` returns \`2024-9-9\`; expected \`2024-09-09\`.

January to August are fine, October onwards is fine, only September (and the 9th) is wrong. Weird.`,
  },
  'date-add-months-negative': {
    title: 'Subtracting months across a year',
    kind: 'Rounding negative numbers',
    issue: `### addMonths gets the year wrong for negative n

\`\`\`ts
addMonths({ year: 2024, month: 1, day: 15 }, -1)
\`\`\`

**Expected**: \`{ year: 2023, month: 12, day: 15 }\`
**Actual**: \`{ year: 2024, month: 12, day: 15 }\` — it jumps to the end of the same year.

The docs say n may be negative.`,
  },
  'date-parse-invalid': {
    title: 'Dates that do not exist',
    kind: 'Missing validation',
    issue: `### parseDate accepts dates that don't exist

\`parseDate('2023-02-30')\` doesn't throw; it returns \`{ year: 2023, month: 2, day: 30 }\`. Same for \`2024-04-31\`.

The README says it "throws on a bad format or a date that doesn't exist". Users can place orders with any made-up date in the form.`,
    seed: [
      {
        path: 'src/date.ts',
        find: '  if (d.day < 1 || d.day > daysInMonth(d.year, d.month)) throw new RangeError(`Invalid date: ${s}`)',
        replace: '  if (d.day < 1 || d.day > 31) throw new RangeError(`Invalid date: ${s}`)',
      },
    ],
  },
  'cart-best-percent': {
    title: 'Several percent coupons',
    kind: 'Business rule',
    issue: `### I have a 10% and a 20% coupon but only got 10% off

\`applyCoupons(10000, [P10, P20])\` (P10 = 10% off, P20 = 20% off) returns 9000; expected 8000.

The README says "the biggest discount is picked automatically". Putting P20 first works, so it seems to depend on the order.`,
  },
  'cart-negative-total': {
    title: 'Negative total',
    kind: 'Missing boundary handling',
    issue: `### Total goes negative when a gift card exceeds the order

A ¥50 pen paid with a ¥100 gift card (\`{ code: 'GIFT100', kind: 'fixed', value: 10000 }\`): \`checkout\` returns total = -5000, and the tax is negative too.

Expected: total = 0, tax = 0, discount = 5000.`,
  },
  'cart-quantity': {
    title: 'Quantity validation',
    kind: 'Feature: input validation',
    issue: `### subtotal should reject invalid quantities

Right now \`quantity: 0\`, \`quantity: -2\` and \`quantity: 1.5\` all produce a subtotal (and negatives even lower the total).

Please match the unit price validation: throw a \`RangeError\` when the quantity isn't a positive integer, with a message containing "Invalid quantity".`,
    seed: [
      {
        path: 'src/cart.ts',
        find:
          '    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new RangeError(`Invalid quantity for ${item.sku}: ${item.quantity}`)\n' +
          '    if (!Number.isInteger(item.unitPrice)',
        replace: '    if (!Number.isInteger(item.unitPrice)',
      },
    ],
  },
  'md-heading-7': {
    title: 'Level-7 heading',
    kind: 'Boundary condition (off-by-one)',
    issue: `### \`#######\` renders as \`<h7>\`

There is no h7 in HTML. Per CommonMark, more than 6 #s is not a heading and should be a plain paragraph:

\`renderMarkdown('####### seven')\` should give \`<p>####### seven</p>\`.`,
  },
  'md-list-close': {
    title: 'Unclosed list',
    kind: 'Missing boundary handling',
    issue: `### Missing \`</ul>\` when a document ends with a list

\`renderMarkdown('- a\\n- b')\` outputs \`<ul>\\n<li>a</li>\\n<li>b</li>\`, with no \`</ul>\`, so all the HTML we append afterwards ends up inside the list. A list followed by a blank line or a paragraph is fine.`,
  },
  'md-code-span': {
    title: 'Asterisks in code',
    kind: 'Processing order',
    issue: `### \`*\` inside inline code is treated as italics

\`\`\`md
\`a*b*c\`
\`\`\`

Expected \`<code>a*b*c</code>\`, got \`<code>a<em>b</em>c</code>\`. \`_x_\` inside code has the same problem. Code spans should be output verbatim (still HTML-escaped, of course).`,
    seed: [
      {
        path: 'src/inline.ts',
        find: String.raw`  // Pull inline code out into placeholders first so * and _ inside code aren't treated as emphasis
  const codes: string[] = []
  let out = text.replace(/` + '`([^`]+)`' + String.raw`/g, (_m, code: string) => {
    codes.push(code)
    return ` + '`\\u0000${codes.length - 1}\\u0000`' + String.raw`
  })

  out = escapeHtml(out)`,
        replace: '  let out = escapeHtml(text)',
      },
      {
        path: 'src/inline.ts',
        find: String.raw`  // Put the code back (code content is escaped too)
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => ` + '`<code>${escapeHtml(codes[Number(i)])}</code>`)',
        replace: "  return out.replace(/`([^`]+)`/g, '<code>$1</code>')",
      },
    ],
  },
  'md-strikethrough': {
    title: 'Strikethrough support',
    kind: 'Feature request',
    issue: `### Feature request: support \`~~strikethrough~~\`

For price change announcements we want to write \`was ~~100~~ now 80\`. Please render \`~~text~~\` as \`<del>text</del>\`, inline like bold and italics.`,
  },
}

export const CODING_TASKS: CodingTaskDef[] = L(
  ZH_TASKS,
  ZH_TASKS.map((d) => ({ ...d, ...EN_TASKS[d.id] })),
)

/** 标准修复 = 植入补丁的逆补丁（按顺序） */
export function fixOf(def: CodingTaskDef): Patch[] {
  return def.seed.map((p) => ({ path: p.path, find: p.replace, replace: p.find }))
}

const initialCache = new Map<string, Files>()
/** 任务的初始仓库（基线 + 植入的 bug） */
export function initialFiles(def: CodingTaskDef): Files {
  let files = initialCache.get(def.id)
  if (!files) {
    files = def.seed.reduce(applyPatch, BASE_REPOS[def.repo])
    initialCache.set(def.id, files)
  }
  return files
}

export function hiddenTestOf(def: CodingTaskDef): string {
  const key = Object.keys(HIDDEN).find((k) => k.endsWith(`/${def.id}.test.ts.txt`))
  if (!key) throw new Error(L(`缺少隐藏测试：hidden/${def.id}.test.ts.txt`, `Missing hidden test: hidden.en/${def.id}.test.ts.txt`))
  return HIDDEN[key]
}

const oneLine = (s = '') => s.replace(/\s*\n\s*/g, L('；', '; ')).slice(0, 160)

function describeFailures(r: SuiteResult, label: (file: string) => string): string[] {
  return [
    ...r.loadErrors.map((l) => L(`${label(l.file)}无法加载：${oneLine(l.error)}`, `${label(l.file)}failed to load: ${oneLine(l.error)}`)),
    ...r.cases.filter((c) => !c.ok).map((c) => L(`${label(c.file)}「${c.name}」失败：${oneLine(c.error)}`, `${label(c.file)}"${c.name}" failed: ${oneLine(c.error)}`)),
  ]
}

/** SWE-bench 式判定：只看最终文件，和 Agent 怎么实现无关 */
export async function judge(def: CodingTaskDef, files: Files): Promise<CheckResult> {
  const original = initialFiles(def)
  const tests = testFilesOf(original)
  const tampered = tests.filter((p) => files[p] !== original[p])
  if (tampered.length)
    return {
      pass: false,
      reason: L(
        `不能修改测试来让测试通过：${tampered.join('、')} 被${tampered.some((p) => !(p in files)) ? '删除或' : ''}修改了。应该修源码；在 system prompt 里明确“不要修改测试”，最好在编辑工具里直接拒绝写 *.test.ts`,
        `Don't edit tests to make them pass: ${tampered.join(', ')} ${tampered.length > 1 ? 'were' : 'was'} ${tampered.some((p) => !(p in files)) ? 'deleted or ' : ''}modified. Fix the source instead; say "never modify tests" in the system prompt, and ideally have the edit tool refuse to write *.test.ts`,
      ),
    }

  // 判定用的仓库：Agent 的最终源码 + 原始测试 + 隐藏测试，在全新的模块系统里运行
  const judged: Files = { ...files, [HIDDEN_PATH]: hiddenTestOf(def) }
  for (const p of tests) judged[p] = original[p]
  const f2p = await runSuite(judged, [HIDDEN_PATH])
  const p2p = await runSuite(judged, tests)

  const fixFails = describeFailures(f2p, () => L('隐藏测试', 'Hidden test '))
  const regressions = describeFailures(p2p, (f) => L(`原有测试 ${f} `, `Existing test ${f} `))
  if (!f2p.cases.length && !f2p.loadErrors.length) fixFails.push(L('隐藏测试没有运行', 'hidden tests did not run'))
  const problems: string[] = []
  if (fixFails.length)
    problems.push(
      L(
        `issue 没有修好（FAIL_TO_PASS）：${fixFails.slice(0, 2).join('；')}${fixFails.length > 2 ? ` 等 ${fixFails.length} 项` : ''}`,
        `Issue not fixed (FAIL_TO_PASS): ${fixFails.slice(0, 2).join('; ')}${fixFails.length > 2 ? ` (${fixFails.length} in total)` : ''}`,
      ),
    )
  if (regressions.length)
    problems.push(
      L(
        `修改引入了回归（PASS_TO_PASS）：${regressions.slice(0, 2).join('；')}${regressions.length > 2 ? ` 等 ${regressions.length} 项` : ''}。改完代码一定要跑一遍已有测试`,
        `The change introduced regressions (PASS_TO_PASS): ${regressions.slice(0, 2).join('; ')}${regressions.length > 2 ? ` (${regressions.length} in total)` : ''}. Always run the existing tests after changing code`,
      ),
    )
  if (problems.length) {
    if ([...f2p.loadErrors, ...p2p.loadErrors].length)
      problems.push(L('（代码加载失败通常意味着写入了不完整或有语法错误的文件）', '(Load failures usually mean a file was written incomplete or with a syntax error)'))
    return { pass: false, reason: problems.join('\n') }
  }
  return {
    pass: true,
    reason: L(
      `修复正确：隐藏测试 ${f2p.cases.length}/${f2p.cases.length} 通过，原有测试 ${p2p.cases.length}/${p2p.cases.length} 通过`,
      `Fixed: hidden tests ${f2p.cases.length}/${f2p.cases.length} passed, existing tests ${p2p.cases.length}/${p2p.cases.length} passed`,
    ),
  }
}

export function toTasks(): ProjectTask<CodingEnv, unknown>[] {
  return CODING_TASKS.map((def) => ({
    id: def.id,
    title: def.title,
    core: def.core,
    input: def.issue,
    check: ({ env }) => judge(def, env.files),
  }))
}
