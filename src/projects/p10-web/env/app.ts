/**
 * P10 的模拟网站：拾光优选。
 *
 * - 页面渲染成“无障碍树”文本（WebArena 的观察方式）：可交互元素带编号 `[12] button "加入购物车"`，
 *   静态文字没有编号。**编号在每次渲染时从 1 重新分配**，页面一变，同一个编号就指向别的元素。
 * - 动作（click / type / select / goto / back / scroll）总是作用在“当前页面”上：
 *   先按当前状态重新渲染，再按编号找元素。拿着旧页面的编号去点，就会点到别的东西。
 * - 噪声：首次访问的促销弹窗（挡住所有点击，直到关闭）、分页、缺货规格、确认弹窗、广告位、评价区的提示注入。
 */
import { L } from '../../../engine/locale'
import { CATEGORIES, CATEGORY_ORDER, COLOR, freshData, isOutOfStock, lineName, ORDERS_PAGE, PAGE_SIZE, productOf, PRODUCTS, SIZE, STATUS, TODAY, type Order, type Product, type ShopData } from './data'

/** 页面上的固定文案（模拟模型也按这些文字读页面） */
export const UI = L(
  {
    site: '拾光优选',
    pageLabel: '页面：',
    urlLabel: 'URL：',
    searchBox: '搜索商品',
    searchBtn: '搜索',
    next: '下一页',
    prev: '上一页',
    promoTitle: '新人专享福利',
    claim: '立即领取',
    close: '关闭',
    pay: '确认支付',
    cancel: '取消',
    placeOrder: '提交订单',
    addToCart: '加入购物车',
    couponBox: '优惠券码',
    applyCoupon: '使用优惠券',
    checkout: '去结算',
    cancelOrder: '取消订单',
    confirmCancel: '确定取消',
    keepOrder: '再想想',
    confirmDelete: '确定删除',
    choose: '请选择',
    oos: '（缺货）',
    loadMore: '向下滚动加载更多',
    setDefault: '设为默认：',
    isDefault: '（默认）',
    order: '订单 ',
    rating: '评分 ',
    colors: '颜色：',
    paid: '实付',
    sponsored: '【赞助】',
    sep: '：',
  },
  {
    site: 'Glimmer Mart',
    pageLabel: 'Page: ',
    urlLabel: 'URL: ',
    searchBox: 'Search products',
    searchBtn: 'Search',
    next: 'Next page',
    prev: 'Previous page',
    promoTitle: 'New member gift',
    claim: 'Claim now',
    close: 'Close',
    pay: 'Confirm payment',
    cancel: 'Cancel',
    placeOrder: 'Place order',
    addToCart: 'Add to cart',
    couponBox: 'Coupon code',
    applyCoupon: 'Apply coupon',
    checkout: 'Check out',
    cancelOrder: 'Cancel order',
    confirmCancel: 'Yes, cancel it',
    keepOrder: 'Keep order',
    confirmDelete: 'Delete',
    choose: 'Select',
    oos: ' (out of stock)',
    loadMore: 'Scroll down to load more',
    setDefault: 'Set as default: ',
    isDefault: ' (default)',
    order: 'Order ',
    rating: 'Rating ',
    colors: 'Colors: ',
    paid: 'Paid',
    sponsored: '[Sponsored] ',
    sep: ': ',
  },
)
const T = (title: string) => `${UI.site} · ${title}`

export interface AppOptions {
  /** 首次访问时弹出促销弹窗（挡住页面，直到点击“关闭”或“立即领取”） */
  popup?: boolean
  /** 初始购物车（默认空） */
  cart?: ShopData['cart']
  /** 初始页面（默认首页） */
  start?: string
}

interface Node {
  role: string
  name: string
  attrs?: string
  indent: number
  click?: () => string | void
  type?: (text: string, enter: boolean) => string | void
  select?: (option: string) => string | void
  inDialog?: boolean
}

interface Dialog {
  kind: 'promo' | 'pay' | 'cancel' | 'delete'
  title: string
  text: string
  /** 被确认的对象（订单号 / 地址 id） */
  target?: string
}

const fail = (msg: string): never => {
  throw new Error(msg)
}

const money = (n: number) => `¥${Math.round(n * 100) / 100}`
const q = (s: string) => s.replace(/"/g, '“')
const SITE = /^https?:\/\/[^/]+/

export class WebApp {
  data: ShopData
  url = '/'
  private history: string[] = []
  private dialog?: Dialog
  private promoOpen: boolean
  private inputs: Record<string, string> = {}
  private selections: Record<string, Record<string, string>> = {}
  private qty: Record<string, string> = {}
  private appliedCoupon?: string
  private checkoutAddress?: string
  private ordersShown = ORDERS_PAGE
  private flash?: string
  private seq = 1
  /** 最近一次渲染的元素（按编号） */
  private nodes: Node[] = []

  constructor(opts: AppOptions = {}) {
    this.data = freshData()
    if (opts.cart) this.data.cart = structuredClone(opts.cart)
    this.promoOpen = !!opts.popup
    if (opts.start) this.url = opts.start
  }

  // ———————————————————— 观察 ————————————————————

  /** 当前页面的无障碍树（同时刷新编号表） */
  observe(): string {
    const { title, body } = this.render()
    const header = this.header()
    const all = [...header, { role: 'main', name: '', indent: 0 } as Node, ...body]
    const dialog = this.currentDialog()
    if (dialog) all.push(...dialog)
    this.nodes = []
    const lines = [`${UI.pageLabel}${title}`, `${UI.urlLabel}${this.url}`]
    if (this.flash) lines.push(`status "${q(this.flash)}"`)
    for (const n of all) {
      const pad = '  '.repeat(n.indent)
      const interactive = n.click || n.type || n.select
      if (n.role === 'main') {
        lines.push('main')
        continue
      }
      if (interactive) {
        this.nodes.push(n)
        lines.push(`${pad}[${this.nodes.length}] ${n.role} "${q(n.name)}"${n.attrs ?? ''}`)
      } else lines.push(`${pad}${n.role} "${q(n.name)}"`)
    }
    return lines.join('\n')
  }

  get title(): string {
    return this.render().title
  }

  // ———————————————————— 动作 ————————————————————

  private resolve(id: unknown): Node {
    this.observe() // 按当前页面重新编号
    const n = Number(typeof id === 'string' ? id.replace(/[[\]\s]/g, '') : id)
    if (!Number.isInteger(n) || n < 1) fail(L(`元素编号必须是正整数，收到：${JSON.stringify(id)}`, `Element id must be a positive integer, got: ${JSON.stringify(id)}`))
    const node = this.nodes[n - 1] ?? fail(
      L(
        `当前页面上没有编号为 [${n}] 的元素（当前页面共 ${this.nodes.length} 个可交互元素；编号在页面变化后会重新分配）`,
        `There is no element [${n}] on the current page (it has ${this.nodes.length} interactive elements; ids are reassigned whenever the page changes)`,
      ),
    )
    if (this.blocking() && !node.inDialog) fail(L(`对 [${n}] ${node.role} "${node.name}" 的操作失败：元素被遮挡（另一个元素拦截了点击：div.modal-mask）`, `Action on [${n}] ${node.role} "${node.name}" failed: element is covered (another element would receive the click: div.modal-mask)`))
    return node
  }

  private describe(n: Node, id: unknown) {
    return `[${Number(String(id).replace(/[[\]\s]/g, ''))}] ${n.role} "${n.name}"`
  }

  private after(prefix: string, effect: string | void, before: string): string {
    const parts = [prefix]
    if (effect) parts.push(L(`页面提示：${effect}`, `Page message: ${effect}`))
    if (this.url !== before) parts.push(L(`→ 已跳转：${this.title}（${this.url}）`, `→ navigated to: ${this.title} (${this.url})`))
    return parts.join(L('。', '. '))
  }

  click(id: unknown): string {
    const node = this.resolve(id)
    if (!node.click)
      fail(
        L(
          `${this.describe(node, id)} 不能点击（${node.role === 'textbox' || node.role === 'spinbutton' ? '请用 type 输入' : '请用 select 选择'}）`,
          `${this.describe(node, id)} is not clickable (${node.role === 'textbox' || node.role === 'spinbutton' ? 'use type to enter text' : 'use select to pick an option'})`,
        ),
      )
    const before = this.url
    this.flash = undefined
    const effect = node.click!()
    this.flash = effect || undefined
    return this.after(L(`已点击 ${this.describe(node, id)}`, `Clicked ${this.describe(node, id)}`), effect, before)
  }

  type(id: unknown, text: unknown, pressEnter?: unknown): string {
    const node = this.resolve(id)
    if (!node.type) fail(L(`${this.describe(node, id)} 不是输入框，不能输入文字`, `${this.describe(node, id)} is not a text field; you can't type into it`))
    if (typeof text !== 'string') fail(L(`text 必须是字符串，收到：${JSON.stringify(text)}`, `text must be a string, got: ${JSON.stringify(text)}`))
    const before = this.url
    this.flash = undefined
    const effect = node.type!(text as string, !!pressEnter)
    this.flash = effect || undefined
    return this.after(
      L(`已在 ${this.describe(node, id)} 中输入“${text}”${pressEnter ? '并按下回车' : ''}`, `Typed “${text}” into ${this.describe(node, id)}${pressEnter ? ' and pressed Enter' : ''}`),
      effect,
      before,
    )
  }

  select(id: unknown, option: unknown): string {
    const node = this.resolve(id)
    if (!node.select) fail(L(`${this.describe(node, id)} 不是下拉框，不能选择`, `${this.describe(node, id)} is not a dropdown; you can't select from it`))
    const before = this.url
    this.flash = undefined
    const effect = node.select!(String(option ?? '').replace(L(/（缺货）$/, /\s*\(out of stock\)$/i), '').trim())
    this.flash = effect || undefined
    return this.after(L(`已在 ${this.describe(node, id)} 中选择“${option}”`, `Selected “${option}” in ${this.describe(node, id)}`), effect, before)
  }

  goto(url: unknown): string {
    if (typeof url !== 'string' || !url.trim()) fail(L(`url 必须是非空字符串，收到：${JSON.stringify(url)}`, `url must be a non-empty string, got: ${JSON.stringify(url)}`))
    const path = (url as string).trim().replace(SITE, '') || '/'
    if (!path.startsWith('/')) fail(L(`只能打开本站的地址（以 / 开头），收到：${url}`, `You can only open paths on this site (starting with /), got: ${url}`))
    this.flash = undefined
    this.navigate(path)
    return L(`已打开 ${path}。→ 当前：${this.title}（${this.url}）`, `Opened ${path}. → now on: ${this.title} (${this.url})`)
  }

  back(): string {
    const prev = this.history.pop()
    if (!prev) return L('没有可以返回的页面', 'There is no previous page')
    this.flash = undefined
    this.dialog = undefined
    this.url = prev
    this.resetPage()
    return L(`已返回上一页。→ 当前：${this.title}（${this.url}）`, `Went back. → now on: ${this.title} (${this.url})`)
  }

  scroll(direction: unknown): string {
    const dir = String(direction ?? 'down').toLowerCase()
    if (this.blocking()) fail(L('页面被弹窗遮挡，无法滚动', "A dialog is covering the page; can't scroll"))
    if (this.path() === '/orders' && /down|下/.test(dir)) {
      const total = this.data.orders.length
      if (this.ordersShown >= total) return L('已经到底了，没有更多订单', 'Reached the bottom: no more orders')
      this.ordersShown = Math.min(total, this.ordersShown + ORDERS_PAGE)
      return L(`已向下滚动，加载了更多订单（现在显示 ${this.ordersShown}/${total} 笔）`, `Scrolled down and loaded more orders (showing ${this.ordersShown}/${total})`)
    }
    return /down|下/.test(dir) ? L('已向下滚动：页面没有更多内容', 'Scrolled down: nothing more on this page') : L('已向上滚动', 'Scrolled up')
  }

  // ———————————————————— 导航 ————————————————————

  private path() {
    return this.url.split('?')[0]
  }
  private params() {
    return new URLSearchParams(this.url.split('?')[1] ?? '')
  }

  private navigate(url: string) {
    if (url !== this.url) this.history.push(this.url)
    this.url = url
    this.dialog = undefined
    this.resetPage()
  }

  private resetPage() {
    this.ordersShown = ORDERS_PAGE
    for (const k of Object.keys(this.inputs)) if (!k.startsWith('search')) delete this.inputs[k]
  }

  private blocking(): boolean {
    return !!this.currentDialogData()
  }

  private currentDialogData(): Dialog | undefined {
    if (this.dialog) return this.dialog
    if (this.promoOpen)
      return {
        kind: 'promo',
        title: UI.promoTitle,
        text: L('恭喜获得 10 元无门槛优惠券 NEW10！点击“立即领取”放入账户。', 'You got a ¥10 coupon NEW10 with no minimum spend! Click “Claim now” to add it to your account.'),
      }
    return undefined
  }

  // ———————————————————— 渲染 ————————————————————

  private header(): Node[] {
    const cartCount = this.data.cart.reduce((n, l) => n + l.qty, 0)
    const search = (text: string) => {
      const kw = text.trim()
      if (!kw) return L('请输入搜索关键词', 'Please enter a search keyword')
      this.navigate(`/search?q=${encodeURIComponent(kw)}&page=1`)
    }
    return [
      { role: 'link', name: UI.site, attrs: ' url="/"', indent: 0, click: () => this.navigate('/') },
      {
        role: 'textbox',
        name: UI.searchBox,
        attrs: ` value="${q(this.inputs.search ?? '')}"`,
        indent: 0,
        type: (text, enter) => {
          this.inputs.search = text
          if (enter) return search(text) ?? undefined
        },
      },
      { role: 'button', name: UI.searchBtn, indent: 0, click: () => search(this.inputs.search ?? '') ?? undefined },
      { role: 'link', name: L(`购物车（${cartCount}）`, `Cart (${cartCount})`), attrs: ' url="/cart"', indent: 0, click: () => this.navigate('/cart') },
      { role: 'link', name: L('我的订单', 'My orders'), attrs: ' url="/orders"', indent: 0, click: () => this.navigate('/orders') },
      { role: 'link', name: L('账户设置', 'Account settings'), attrs: ' url="/account"', indent: 0, click: () => this.navigate('/account') },
      { role: 'link', name: L('商家后台', 'Seller center'), attrs: ' url="/admin/orders"', indent: 0, click: () => this.navigate('/admin/orders') },
      { role: 'navigation', name: L('商品分类', 'Categories'), indent: 0 },
      ...CATEGORIES.map((c): Node => ({ role: 'link', name: c, attrs: ` url="/category/${c}"`, indent: 1, click: () => this.navigate(`/category/${c}`) })),
    ]
  }

  private currentDialog(): Node[] | undefined {
    const d = this.currentDialogData()
    if (!d) return undefined
    const btn = (name: string, click: () => string | void): Node => ({ role: 'button', name, indent: 1, click, inDialog: true })
    const nodes: Node[] = [
      { role: 'dialog', name: d.title, indent: 0, inDialog: true },
      { role: 'text', name: d.text, indent: 1, inDialog: true },
    ]
    if (d.kind === 'promo')
      nodes.push(
        btn(UI.claim, () => {
          this.promoOpen = false
          if (!this.data.coupons.some((c) => c.code === 'NEW10')) this.data.coupons.push({ code: 'NEW10', title: L('无门槛减 10', '¥10 off, no minimum'), kind: 'minus', min: 0, value: 10 })
          return L('优惠券 NEW10 已放入账户', 'Coupon NEW10 added to your account')
        }),
        btn(UI.close, () => {
          this.promoOpen = false
        }),
      )
    else if (d.kind === 'pay') nodes.push(btn(UI.pay, () => this.placeOrder()), btn(UI.cancel, () => void (this.dialog = undefined)))
    else if (d.kind === 'cancel') nodes.push(btn(UI.confirmCancel, () => this.cancelOrder(d.target!)), btn(UI.keepOrder, () => void (this.dialog = undefined)))
    else nodes.push(btn(UI.confirmDelete, () => this.deleteAddress(d.target!)), btn(UI.cancel, () => void (this.dialog = undefined)))
    return nodes
  }

  private render(): { title: string; body: Node[] } {
    const path = this.path()
    if (path === '/') return this.home()
    if (path === '/search') return this.searchPage()
    if (path.startsWith('/category/')) return this.categoryPage(decodeURIComponent(path.slice('/category/'.length)))
    if (path.startsWith('/product/')) return this.productPage(path.slice('/product/'.length))
    if (path === '/cart') return this.cartPage()
    if (path === '/checkout') return this.checkoutPage()
    if (path === '/orders') return this.ordersPage()
    if (path.startsWith('/orders/')) return this.orderPage(path.slice('/orders/'.length))
    if (path === '/account') return this.accountPage()
    if (path === '/admin/orders') return this.adminPage()
    return { title: T(L('页面不存在', 'Page not found')), body: [{ role: 'heading', name: L('404：页面不存在', '404: Page not found'), indent: 1 }] }
  }

  private card(p: Product, indent = 1): Node[] {
    const meta = `${p.sponsored ? UI.sponsored : ''}${money(p.price)} · ${this.ratingText(p)}${p.colors ? ` · ${UI.colors}${p.colors.join('/')}` : ''}`
    return [
      { role: 'link', name: p.name, attrs: ` url="/product/${p.id}"`, indent, click: () => this.navigate(`/product/${p.id}`) },
      { role: 'text', name: meta, indent: indent + 1 },
    ]
  }

  private ratingText(p: Product) {
    return L(`评分 ${p.rating}（${p.reviewCount} 条评价）`, `Rating ${p.rating} (${p.reviewCount} reviews)`)
  }

  private home() {
    const picks = ['P102', 'P203', 'P301', 'P401', 'P601', 'P801'].map((id) => productOf(id)!)
    return {
      title: T(L('首页', 'Home')),
      body: [
        { role: 'heading', name: L('今日推荐', "Today's picks"), indent: 1 },
        ...picks.flatMap((p) => this.card(p, 1)),
        { role: 'text', name: L('© 拾光优选 · 客服热线 400-800-1234 · 7 天无理由退货', '© Glimmer Mart · Customer service 400-800-1234 · 7-day no-questions-asked returns'), indent: 1 },
      ],
    }
  }

  private listing(title: string, heading: string, items: Product[], base: string) {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
    const page = Math.min(pages, Math.max(1, Number(this.params().get('page') ?? 1) || 1))
    const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const sep = base.includes('?') ? '&' : '?'
    const body: Node[] = [{ role: 'heading', name: L(`${heading}（共 ${items.length} 件 · 第 ${page}/${pages} 页）`, `${heading} (${items.length} items · page ${page}/${pages})`), indent: 1 }]
    if (!items.length) body.push({ role: 'text', name: L('没有找到相关商品，换个关键词试试', 'No matching products. Try a different keyword.'), indent: 1 })
    for (const p of shown) body.push(...this.card(p))
    if (page > 1) body.push({ role: 'link', name: UI.prev, attrs: ` url="${base}${sep}page=${page - 1}"`, indent: 1, click: () => this.navigate(`${base}${sep}page=${page - 1}`) })
    if (page < pages) body.push({ role: 'link', name: UI.next, attrs: ` url="${base}${sep}page=${page + 1}"`, indent: 1, click: () => this.navigate(`${base}${sep}page=${page + 1}`) })
    return { title, body }
  }

  private searchPage() {
    const kw = this.params().get('q') ?? ''
    const tokens = kw.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (p: Product) => tokens.length > 0 && tokens.every((t) => `${p.name} ${(p.tags ?? []).join(' ')}`.toLowerCase().includes(t))
    const matched = PRODUCTS.filter(hit)
    const items = [...matched.filter((p) => p.sponsored), ...matched.filter((p) => !p.sponsored)]
    return this.listing(T(L(`搜索“${kw}”`, `Search “${kw}”`)), L(`搜索结果：${kw}`, `Search results: ${kw}`), items, `/search?q=${encodeURIComponent(kw)}`)
  }

  private categoryPage(cat: string) {
    const order = CATEGORY_ORDER[cat]
    const items = order ? order.map((id) => productOf(id)!) : PRODUCTS.filter((p) => p.category === cat && !p.sponsored)
    return this.listing(T(cat), L(`分类：${cat}`, `Category: ${cat}`), items, `/category/${encodeURIComponent(cat)}`)
  }

  private selection(p: Product): Record<string, string> {
    this.selections[p.id] ??= { ...(p.colors ? { [COLOR]: p.colors[0] } : {}), ...(p.sizes ? { [SIZE]: UI.choose } : {}) }
    return this.selections[p.id]
  }

  private productPage(id: string) {
    const p = productOf(id)
    if (!p) return { title: T(L('商品不存在', 'Product not found')), body: [{ role: 'heading', name: L('商品不存在或已下架', 'This product does not exist or has been removed'), indent: 1 } as Node] }
    const sel = this.selection(p)
    const body: Node[] = [
      { role: 'heading', name: p.name, indent: 1 },
      { role: 'text', name: `${p.sponsored ? UI.sponsored : ''}${money(p.price)} · ${this.ratingText(p)}`, indent: 1 },
      { role: 'text', name: p.desc, indent: 1 },
    ]
    const combo = (label: string, values: string[], oos: (v: string) => boolean): Node => {
      const options = values.map((v) => (oos(v) ? `${v}${UI.oos}` : v))
      return {
        role: 'combobox',
        name: label,
        attrs: ` value="${sel[label]}" options=[${options.map((o) => `"${o}"`).join(',')}]`,
        indent: 1,
        select: (opt) => {
          if (!values.includes(opt)) fail(L(`“${label}”没有选项“${opt}”，可选：${options.join('、')}`, `“${label}” has no option “${opt}”. Options: ${options.join(', ')}`))
          if (oos(opt)) fail(L(`选项“${opt}”不可选：该规格缺货`, `Option “${opt}” is unavailable: out of stock`))
          sel[label] = opt
          if (label === COLOR && sel[SIZE] && sel[SIZE] !== UI.choose && isOutOfStock(p, { ...sel })) sel[SIZE] = UI.choose
        },
      }
    }
    if (p.colors) body.push(combo(COLOR, p.colors, (v) => !p.sizes && isOutOfStock(p, { [COLOR]: v })))
    if (p.sizes) body.push(combo(SIZE, p.sizes, (v) => isOutOfStock(p, { [COLOR]: sel[COLOR], [SIZE]: v })))
    body.push(
      {
        role: 'spinbutton',
        name: L('数量', 'Quantity'),
        attrs: ` value="${this.qty[p.id] ?? '1'}"`,
        indent: 1,
        type: (text) => {
          const n = Number(text.trim())
          if (!Number.isInteger(n) || n < 1 || n > 99) fail(L(`数量必须是 1~99 的整数，收到：“${text}”`, `Quantity must be a whole number from 1 to 99, got: “${text}”`))
          this.qty[p.id] = String(n)
        },
      },
      { role: 'button', name: UI.addToCart, indent: 1, click: () => this.addToCart(p) },
    )
    if (p.reviews?.length) {
      body.push({ role: 'heading', name: L(`商品评价（${p.reviews.length}）`, `Reviews (${p.reviews.length})`), indent: 1 })
      for (const r of p.reviews) body.push({ role: 'text', name: `${'★'.repeat(r.stars)} ${r.user}${UI.sep}${r.text}`, indent: 1 })
    }
    return { title: T(p.name), body }
  }

  private addToCart(p: Product): string {
    const sel = this.selection(p)
    if (sel[SIZE] === UI.choose) return L('请先选择尺码', 'Please select a size first')
    if (isOutOfStock(p, sel)) return L('所选规格缺货，无法加入购物车', "The selected option is out of stock and can't be added to the cart")
    const qty = Number(this.qty[p.id] ?? 1)
    const options = { ...sel }
    const line = this.data.cart.find((l) => l.productId === p.id && JSON.stringify(l.options) === JSON.stringify(options))
    if (line) line.qty += qty
    else this.data.cart.push({ productId: p.id, options, qty })
    return L(`已加入购物车：${lineName(p.name, options)} ×${qty}`, `Added to cart: ${lineName(p.name, options)} ×${qty}`)
  }

  private totals() {
    const subtotal = this.data.cart.reduce((n, l) => n + productOf(l.productId)!.price * l.qty, 0)
    const c = this.data.coupons.find((x) => x.code === this.appliedCoupon)
    let discount = 0
    if (c && subtotal >= c.min) discount = c.kind === 'minus' ? c.value : Math.min(c.maxOff ?? Infinity, Math.round(subtotal * c.value * 100) / 100)
    if (c && subtotal < c.min) this.appliedCoupon = undefined
    return { subtotal, discount, coupon: discount ? c!.code : undefined, paid: Math.round((subtotal - discount) * 100) / 100 }
  }

  private totalsText() {
    const t = this.totals()
    return L(
      `商品合计 ${money(t.subtotal)} · 优惠 -${money(t.discount)}${t.coupon ? `（${t.coupon}）` : ''} · 应付 ${money(t.paid)}`,
      `Subtotal ${money(t.subtotal)} · Discount -${money(t.discount)}${t.coupon ? ` (${t.coupon})` : ''} · Total ${money(t.paid)}`,
    )
  }

  private cartPage() {
    const body: Node[] = [{ role: 'heading', name: L(`购物车（${this.data.cart.length} 种商品）`, `Cart (${this.data.cart.length} products)`), indent: 1 }]
    if (!this.data.cart.length) {
      body.push({ role: 'text', name: L('购物车是空的，去逛逛吧', 'Your cart is empty. Go find something you like!'), indent: 1 })
      return { title: T(L('购物车', 'Cart')), body }
    }
    for (const l of this.data.cart) {
      const p = productOf(l.productId)!
      const name = lineName(p.name, l.options)
      body.push(
        { role: 'text', name: L(`${name} · 单价 ${money(p.price)}`, `${name} · unit price ${money(p.price)}`), indent: 1 },
        {
          role: 'spinbutton',
          name: L(`数量：${name}`, `Quantity: ${name}`),
          attrs: ` value="${l.qty}"`,
          indent: 2,
          type: (text) => {
            const n = Number(text.trim())
            if (!Number.isInteger(n) || n < 1 || n > 99) fail(L(`数量必须是 1~99 的整数（要移除商品请点“删除”），收到：“${text}”`, `Quantity must be a whole number from 1 to 99 (to remove an item, click “Remove”), got: “${text}”`))
            l.qty = n
            return L(`已把 ${name} 的数量改为 ${n}`, `Changed the quantity of ${name} to ${n}`)
          },
        },
        {
          role: 'button',
          name: L(`删除：${name}`, `Remove: ${name}`),
          indent: 2,
          click: () => {
            this.data.cart = this.data.cart.filter((x) => x !== l)
            return L(`已从购物车删除：${name}`, `Removed from cart: ${name}`)
          },
        },
      )
    }
    const apply = (code: string) => {
      const c = this.data.coupons.find((x) => x.code.toLowerCase() === code.trim().toLowerCase())
      if (!c) return L(`优惠券 ${code.trim()} 无效`, `Coupon ${code.trim()} is not valid`)
      if (c.expired) return L(`优惠券 ${c.code} 已过期，无法使用`, `Coupon ${c.code} has expired and can't be used`)
      const { subtotal } = this.totals()
      if (subtotal < c.min) return L(`优惠券 ${c.code} 未达到使用门槛（${c.title}）`, `Coupon ${c.code}: minimum spend not reached (${c.title})`)
      this.appliedCoupon = c.code
      return L(`优惠券 ${c.code} 已使用（${c.title}）`, `Coupon ${c.code} applied (${c.title})`)
    }
    body.push(
      {
        role: 'textbox',
        name: UI.couponBox,
        attrs: ` value="${q(this.inputs.coupon ?? '')}"`,
        indent: 1,
        type: (text, enter) => {
          this.inputs.coupon = text
          if (enter) return apply(text)
        },
      },
      { role: 'button', name: UI.applyCoupon, indent: 1, click: () => apply(this.inputs.coupon ?? '') },
      { role: 'text', name: this.totalsText(), indent: 1 },
      { role: 'button', name: UI.checkout, indent: 1, click: () => this.navigate('/checkout') },
    )
    return { title: T(L('购物车', 'Cart')), body }
  }

  private addressText(id: string) {
    const a = this.data.addresses.find((x) => x.id === id)!
    return `${a.label}${UI.sep}${a.name} ${a.phone.slice(0, 3)}****${a.phone.slice(-4)} ${a.detail}`
  }

  private checkoutPage() {
    if (!this.data.cart.length) return { title: T(L('确认订单', 'Checkout')), body: [{ role: 'text', name: L('购物车是空的，无法结算', "Your cart is empty, so there's nothing to check out"), indent: 1 } as Node] }
    const chosen = this.checkoutAddress && this.data.addresses.some((a) => a.id === this.checkoutAddress) ? this.checkoutAddress : this.data.defaultAddressId
    const body: Node[] = [
      { role: 'heading', name: L('确认订单', 'Review your order'), indent: 1 },
      { role: 'text', name: L('收货地址', 'Shipping address'), indent: 1 },
    ]
    for (const a of this.data.addresses)
      body.push({
        role: 'radio',
        name: `${this.addressText(a.id)}${a.id === this.data.defaultAddressId ? UI.isDefault : ''}`,
        attrs: a.id === chosen ? ' checked' : '',
        indent: 2,
        click: () => void (this.checkoutAddress = a.id),
      })
    for (const l of this.data.cart) {
      const p = productOf(l.productId)!
      body.push({ role: 'text', name: `${lineName(p.name, l.options)} × ${l.qty} · ${money(p.price * l.qty)}`, indent: 1 })
    }
    body.push(
      { role: 'text', name: this.totalsText(), indent: 1 },
      {
        role: 'button',
        name: UI.placeOrder,
        indent: 1,
        click: () => {
          this.checkoutAddress = chosen
          this.dialog = {
            kind: 'pay',
            title: UI.pay,
            text: L(`将使用账户余额支付 ${money(this.totals().paid)}，确认吗？`, `${money(this.totals().paid)} will be paid from your account balance. Continue?`),
          }
        },
      },
      { role: 'link', name: L('返回购物车', 'Back to cart'), attrs: ' url="/cart"', indent: 1, click: () => this.navigate('/cart') },
    )
    return { title: T(L('确认订单', 'Checkout')), body }
  }

  private placeOrder(): string {
    this.dialog = undefined
    const t = this.totals()
    const id = `SG${TODAY.slice(2).replace(/-/g, '')}${String(this.seq++).padStart(4, '0')}`
    const order: Order = {
      id,
      date: TODAY,
      items: this.data.cart.map((l) => {
        const p = productOf(l.productId)!
        return { productId: p.id, name: p.name, options: { ...l.options }, qty: l.qty, price: p.price }
      }),
      subtotal: t.subtotal,
      discount: t.discount,
      coupon: t.coupon,
      paid: t.paid,
      status: STATUS.pending,
      addressId: this.checkoutAddress ?? this.data.defaultAddressId,
    }
    this.data.orders.unshift(order)
    this.data.cart = []
    this.appliedCoupon = undefined
    this.checkoutAddress = undefined
    this.navigate(`/orders/${id}`)
    return L(`下单成功：订单 ${id}，实付 ${money(order.paid)}`, `Order placed: ${id}, paid ${money(order.paid)}`)
  }

  private orderLine(o: Order) {
    return `${o.date} · ${o.items.map((i) => `${lineName(i.name, i.options)}${L('×', ' ×')}${i.qty}`).join(L('，', ', '))} · ${UI.paid} ${money(o.paid)} · ${o.status}`
  }

  private ordersPage() {
    const body: Node[] = [{ role: 'heading', name: L(`我的订单（共 ${this.data.orders.length} 笔）`, `My orders (${this.data.orders.length} total)`), indent: 1 }]
    for (const o of this.data.orders.slice(0, this.ordersShown))
      body.push(
        { role: 'link', name: `${UI.order}${o.id}`, attrs: ` url="/orders/${o.id}"`, indent: 1, click: () => this.navigate(`/orders/${o.id}`) },
        { role: 'text', name: this.orderLine(o), indent: 2 },
      )
    if (this.ordersShown < this.data.orders.length) body.push({ role: 'text', name: L('—— 向下滚动加载更多订单 ——', '—— Scroll down to load more orders ——'), indent: 1 })
    return { title: T(L('我的订单', 'My orders')), body }
  }

  private orderPage(id: string) {
    const o = this.data.orders.find((x) => x.id === id)
    if (!o) return { title: T(L('订单不存在', 'Order not found')), body: [{ role: 'heading', name: L(`订单 ${id} 不存在`, `Order ${id} does not exist`), indent: 1 } as Node] }
    const body: Node[] = [
      { role: 'heading', name: `${UI.order}${o.id}`, indent: 1 },
      { role: 'text', name: L(`状态：${o.status} · 下单时间：${o.date}`, `Status: ${o.status} · Ordered on: ${o.date}`), indent: 1 },
      ...o.items.map((i): Node => ({ role: 'text', name: L(`${lineName(i.name, i.options)} × ${i.qty} · 单价 ${money(i.price)}`, `${lineName(i.name, i.options)} × ${i.qty} · unit price ${money(i.price)}`), indent: 1 })),
      {
        role: 'text',
        name: L(
          `商品合计 ${money(o.subtotal)} · 优惠 -${money(o.discount)}${o.coupon ? `（${o.coupon}）` : ''} · 实付 ${money(o.paid)}`,
          `Subtotal ${money(o.subtotal)} · Discount -${money(o.discount)}${o.coupon ? ` (${o.coupon})` : ''} · Paid ${money(o.paid)}`,
        ),
        indent: 1,
      },
      {
        role: 'text',
        name: `${L('收货地址：', 'Shipping address: ')}${this.data.addresses.find((a) => a.id === o.addressId) ? this.addressText(o.addressId) : L('（地址已删除）', '(address deleted)')}`,
        indent: 1,
      },
    ]
    if (o.tracking) body.push({ role: 'text', name: L(`物流单号：${o.tracking}`, `Tracking number: ${o.tracking}`), indent: 1 })
    if (o.status === STATUS.pending)
      body.push({
        role: 'button',
        name: UI.cancelOrder,
        indent: 1,
        click: () => {
          this.dialog = { kind: 'cancel', title: UI.cancelOrder, text: L(`确定要取消订单 ${o.id} 吗？款项将原路退回。`, `Cancel order ${o.id}? You'll be refunded to your original payment method.`), target: o.id }
        },
      })
    else if (o.status === STATUS.shipped) body.push({ role: 'text', name: L('订单已发货，不能取消；签收后可以申请退货。', 'This order has shipped and can no longer be cancelled. You can request a return after delivery.'), indent: 1 })
    body.push({ role: 'link', name: L('返回订单列表', 'Back to my orders'), attrs: ' url="/orders"', indent: 1, click: () => this.navigate('/orders') })
    return { title: T(`${UI.order}${o.id}`), body }
  }

  private cancelOrder(id: string): string {
    this.dialog = undefined
    const o = this.data.orders.find((x) => x.id === id)!
    if (o.status !== STATUS.pending) return L(`订单 ${id} 当前状态是“${o.status}”，不能取消`, `Order ${id} is “${o.status}” and can't be cancelled`)
    o.status = STATUS.cancelled
    return L(`订单 ${id} 已取消，款项将原路退回`, `Order ${id} cancelled. You'll be refunded to your original payment method`)
  }

  private deleteAddress(id: string): string {
    this.dialog = undefined
    const a = this.data.addresses.find((x) => x.id === id)!
    this.data.addresses = this.data.addresses.filter((x) => x.id !== id)
    return L(`已删除地址：${a.label}`, `Deleted address: ${a.label}`)
  }

  private accountPage() {
    const body: Node[] = [{ role: 'heading', name: L('收货地址', 'Shipping addresses'), indent: 1 }]
    for (const a of this.data.addresses) {
      const isDefault = a.id === this.data.defaultAddressId
      body.push({ role: 'text', name: `${a.label}${isDefault ? UI.isDefault : ''}${UI.sep}${a.name} · ${a.phone.slice(0, 3)}****${a.phone.slice(-4)} · ${a.detail}`, indent: 1 })
      if (!isDefault)
        body.push({
          role: 'button',
          name: `${UI.setDefault}${a.label}`,
          indent: 2,
          click: () => {
            this.data.defaultAddressId = a.id
            return L(`已将“${a.label}”设为默认地址`, `Set “${a.label}” as the default address`)
          },
        })
      body.push({
        role: 'button',
        name: L(`删除：${a.label}`, `Delete: ${a.label}`),
        indent: 2,
        click: () => {
          if (isDefault) return L('默认地址不能删除，请先把别的地址设为默认', "The default address can't be deleted. Set another address as default first")
          this.dialog = { kind: 'delete', title: L('删除地址', 'Delete address'), text: L(`确定删除地址“${a.label}”吗？`, `Delete the address “${a.label}”?`), target: a.id }
        },
      })
    }
    const field = (key: string, name: string): Node => ({
      role: 'textbox',
      name,
      attrs: ` value="${q(this.inputs[key] ?? '')}"`,
      indent: 2,
      type: (text) => void (this.inputs[key] = text),
    })
    body.push(
      { role: 'heading', name: L('新增收货地址', 'Add a shipping address'), indent: 1 },
      field('addr.label', L('标签', 'Label')),
      field('addr.name', L('收货人', 'Recipient')),
      field('addr.phone', L('手机号', 'Phone')),
      field('addr.detail', L('详细地址', 'Address')),
      { role: 'checkbox', name: L('设为默认地址', 'Set as default address'), attrs: this.inputs['addr.default'] ? ' checked' : '', indent: 2, click: () => void (this.inputs['addr.default'] = this.inputs['addr.default'] ? '' : '1') },
      { role: 'button', name: L('保存新地址', 'Save address'), indent: 2, click: () => this.saveAddress() },
      { role: 'heading', name: L('我的优惠券', 'My coupons'), indent: 1 },
      ...this.data.coupons.map((c): Node => ({ role: 'text', name: `${c.code}${UI.sep}${c.title}${c.expired ? L('（已过期）', ' (expired)') : ''}`, indent: 1 })),
    )
    return { title: T(L('账户设置', 'Account settings')), body }
  }

  private saveAddress(): string {
    const v = (k: string) => (this.inputs[`addr.${k}`] ?? '').trim()
    const missing = L(
      [['label', '标签'], ['name', '收货人'], ['phone', '手机号'], ['detail', '详细地址']],
      [['label', 'Label'], ['name', 'Recipient'], ['phone', 'Phone'], ['detail', 'Address']],
    )
      .filter(([k]) => !v(k))
      .map(([, n]) => n)
    if (missing.length) return L(`保存失败：请填写${missing.join('、')}`, `Not saved: please fill in ${missing.join(', ')}`)
    if (!/^1\d{10}$/.test(v('phone'))) return L('保存失败：手机号格式不正确（11 位数字）', 'Not saved: invalid phone number (11 digits)')
    if (this.data.addresses.some((a) => a.label === v('label'))) return L(`保存失败：已经有标签为“${v('label')}”的地址`, `Not saved: an address labeled “${v('label')}” already exists`)
    const id = `A${this.data.addresses.length + 1 + Math.max(0, ...this.data.addresses.map((a) => Number(a.id.slice(1))))}`
    this.data.addresses.push({ id, label: v('label'), name: v('name'), phone: v('phone'), detail: v('detail') })
    const makeDefault = !!this.inputs['addr.default']
    const label = v('label')
    if (makeDefault) this.data.defaultAddressId = id
    for (const k of Object.keys(this.inputs)) if (k.startsWith('addr.')) delete this.inputs[k]
    return L(`已保存新地址“${label}”${makeDefault ? '，并设为默认地址' : ''}`, `Saved new address “${label}”${makeDefault ? ' and set it as default' : ''}`)
  }

  private adminPage() {
    const body: Node[] = [{ role: 'heading', name: L('商家后台 · 订单管理（林晓的文具小铺）', "Seller center · Orders (Lin Xiao's Stationery Shop)"), indent: 1 }]
    for (const o of this.data.sellerOrders) {
      body.push({
        role: 'text',
        name: L(
          `${o.id} · ${o.date} · 买家 ${o.buyer} · ${o.items} · ${money(o.amount)} · ${o.status}${o.tracking ? `（${o.tracking}）` : ''}`,
          `${o.id} · ${o.date} · buyer ${o.buyer} · ${o.items} · ${money(o.amount)} · ${o.status}${o.tracking ? ` (${o.tracking})` : ''}`,
        ),
        indent: 1,
      })
      if (o.status !== STATUS.pending) continue
      const key = `track.${o.id}`
      body.push(
        { role: 'textbox', name: L(`快递单号：${o.id}`, `Tracking number: ${o.id}`), attrs: ` value="${q(this.inputs[key] ?? '')}"`, indent: 2, type: (text) => void (this.inputs[key] = text) },
        {
          role: 'button',
          name: L(`发货：${o.id}`, `Ship: ${o.id}`),
          indent: 2,
          click: () => {
            const t = (this.inputs[key] ?? '').trim()
            if (!/^[A-Z]{2}\d{10}$/.test(t))
              return L(`发货失败：请先填写正确的快递单号（2 位大写字母 + 10 位数字），当前为“${t}”`, `Not shipped: enter a valid tracking number first (2 capital letters + 10 digits), got “${t}”`)
            o.status = STATUS.shipped
            o.tracking = t
            delete this.inputs[key]
            return L(`订单 ${o.id} 已发货，快递单号 ${t}`, `Order ${o.id} shipped, tracking number ${t}`)
          },
        },
      )
    }
    return { title: T(L('商家后台', 'Seller center')), body }
  }
}
