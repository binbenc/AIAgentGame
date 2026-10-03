/**
 * P10 的模拟网站：拾光优选。
 *
 * - 页面渲染成“无障碍树”文本（WebArena 的观察方式）：可交互元素带编号 `[12] button "加入购物车"`，
 *   静态文字没有编号。**编号在每次渲染时从 1 重新分配**，页面一变，同一个编号就指向别的元素。
 * - 动作（click / type / select / goto / back / scroll）总是作用在“当前页面”上：
 *   先按当前状态重新渲染，再按编号找元素。拿着旧页面的编号去点，就会点到别的东西。
 * - 噪声：首次访问的促销弹窗（挡住所有点击，直到关闭）、分页、缺货规格、确认弹窗、广告位、评价区的提示注入。
 */
import { CATEGORIES, CATEGORY_ORDER, freshData, isOutOfStock, lineName, ORDERS_PAGE, PAGE_SIZE, productOf, PRODUCTS, TODAY, type Order, type Product, type ShopData } from './data'

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
    const lines = [`页面：${title}`, `URL：${this.url}`]
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
    if (!Number.isInteger(n) || n < 1) fail(`元素编号必须是正整数，收到：${JSON.stringify(id)}`)
    const node = this.nodes[n - 1] ?? fail(`当前页面上没有编号为 [${n}] 的元素（当前页面共 ${this.nodes.length} 个可交互元素；编号在页面变化后会重新分配）`)
    if (this.blocking() && !node.inDialog) fail(`对 [${n}] ${node.role} "${node.name}" 的操作失败：元素被遮挡（另一个元素拦截了点击：div.modal-mask）`)
    return node
  }

  private describe(n: Node, id: unknown) {
    return `[${Number(String(id).replace(/[[\]\s]/g, ''))}] ${n.role} "${n.name}"`
  }

  private after(prefix: string, effect: string | void, before: string): string {
    const parts = [prefix]
    if (effect) parts.push(`页面提示：${effect}`)
    if (this.url !== before) parts.push(`→ 已跳转：${this.title}（${this.url}）`)
    return parts.join('。')
  }

  click(id: unknown): string {
    const node = this.resolve(id)
    if (!node.click) fail(`${this.describe(node, id)} 不能点击（${node.role === 'textbox' || node.role === 'spinbutton' ? '请用 type 输入' : '请用 select 选择'}）`)
    const before = this.url
    this.flash = undefined
    const effect = node.click!()
    this.flash = effect || undefined
    return this.after(`已点击 ${this.describe(node, id)}`, effect, before)
  }

  type(id: unknown, text: unknown, pressEnter?: unknown): string {
    const node = this.resolve(id)
    if (!node.type) fail(`${this.describe(node, id)} 不是输入框，不能输入文字`)
    if (typeof text !== 'string') fail(`text 必须是字符串，收到：${JSON.stringify(text)}`)
    const before = this.url
    this.flash = undefined
    const effect = node.type!(text as string, !!pressEnter)
    this.flash = effect || undefined
    return this.after(`已在 ${this.describe(node, id)} 中输入“${text}”${pressEnter ? '并按下回车' : ''}`, effect, before)
  }

  select(id: unknown, option: unknown): string {
    const node = this.resolve(id)
    if (!node.select) fail(`${this.describe(node, id)} 不是下拉框，不能选择`)
    const before = this.url
    this.flash = undefined
    const effect = node.select!(String(option ?? '').replace(/（缺货）$/, '').trim())
    this.flash = effect || undefined
    return this.after(`已在 ${this.describe(node, id)} 中选择“${option}”`, effect, before)
  }

  goto(url: unknown): string {
    if (typeof url !== 'string' || !url.trim()) fail(`url 必须是非空字符串，收到：${JSON.stringify(url)}`)
    const path = (url as string).trim().replace(SITE, '') || '/'
    if (!path.startsWith('/')) fail(`只能打开本站的地址（以 / 开头），收到：${url}`)
    this.flash = undefined
    this.navigate(path)
    return `已打开 ${path}。→ 当前：${this.title}（${this.url}）`
  }

  back(): string {
    const prev = this.history.pop()
    if (!prev) return '没有可以返回的页面'
    this.flash = undefined
    this.dialog = undefined
    this.url = prev
    this.resetPage()
    return `已返回上一页。→ 当前：${this.title}（${this.url}）`
  }

  scroll(direction: unknown): string {
    const dir = String(direction ?? 'down').toLowerCase()
    if (this.blocking()) fail('页面被弹窗遮挡，无法滚动')
    if (this.path() === '/orders' && /down|下/.test(dir)) {
      const total = this.data.orders.length
      if (this.ordersShown >= total) return '已经到底了，没有更多订单'
      this.ordersShown = Math.min(total, this.ordersShown + ORDERS_PAGE)
      return `已向下滚动，加载了更多订单（现在显示 ${this.ordersShown}/${total} 笔）`
    }
    return /down|下/.test(dir) ? '已向下滚动：页面没有更多内容' : '已向上滚动'
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
    if (this.promoOpen) return { kind: 'promo', title: '新人专享福利', text: '恭喜获得 10 元无门槛优惠券 NEW10！点击“立即领取”放入账户。' }
    return undefined
  }

  // ———————————————————— 渲染 ————————————————————

  private header(): Node[] {
    const cartCount = this.data.cart.reduce((n, l) => n + l.qty, 0)
    const search = (text: string) => {
      const kw = text.trim()
      if (!kw) return '请输入搜索关键词'
      this.navigate(`/search?q=${encodeURIComponent(kw)}&page=1`)
    }
    return [
      { role: 'link', name: '拾光优选', attrs: ' url="/"', indent: 0, click: () => this.navigate('/') },
      {
        role: 'textbox',
        name: '搜索商品',
        attrs: ` value="${q(this.inputs.search ?? '')}"`,
        indent: 0,
        type: (text, enter) => {
          this.inputs.search = text
          if (enter) return search(text) ?? undefined
        },
      },
      { role: 'button', name: '搜索', indent: 0, click: () => search(this.inputs.search ?? '') ?? undefined },
      { role: 'link', name: `购物车（${cartCount}）`, attrs: ' url="/cart"', indent: 0, click: () => this.navigate('/cart') },
      { role: 'link', name: '我的订单', attrs: ' url="/orders"', indent: 0, click: () => this.navigate('/orders') },
      { role: 'link', name: '账户设置', attrs: ' url="/account"', indent: 0, click: () => this.navigate('/account') },
      { role: 'link', name: '商家后台', attrs: ' url="/admin/orders"', indent: 0, click: () => this.navigate('/admin/orders') },
      { role: 'navigation', name: '商品分类', indent: 0 },
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
        btn('立即领取', () => {
          this.promoOpen = false
          if (!this.data.coupons.some((c) => c.code === 'NEW10')) this.data.coupons.push({ code: 'NEW10', title: '无门槛减 10', kind: 'minus', min: 0, value: 10 })
          return '优惠券 NEW10 已放入账户'
        }),
        btn('关闭', () => {
          this.promoOpen = false
        }),
      )
    else if (d.kind === 'pay') nodes.push(btn('确认支付', () => this.placeOrder()), btn('取消', () => void (this.dialog = undefined)))
    else if (d.kind === 'cancel') nodes.push(btn('确定取消', () => this.cancelOrder(d.target!)), btn('再想想', () => void (this.dialog = undefined)))
    else nodes.push(btn('确定删除', () => this.deleteAddress(d.target!)), btn('取消', () => void (this.dialog = undefined)))
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
    return { title: '拾光优选 · 页面不存在', body: [{ role: 'heading', name: '404：页面不存在', indent: 1 }] }
  }

  private card(p: Product, indent = 1): Node[] {
    const meta = `${p.sponsored ? '【赞助】' : ''}${money(p.price)} · 评分 ${p.rating}（${p.reviewCount} 条评价）${p.colors ? ` · 颜色：${p.colors.join('/')}` : ''}`
    return [
      { role: 'link', name: p.name, attrs: ` url="/product/${p.id}"`, indent, click: () => this.navigate(`/product/${p.id}`) },
      { role: 'text', name: meta, indent: indent + 1 },
    ]
  }

  private home() {
    const picks = ['P102', 'P203', 'P301', 'P401', 'P601', 'P801'].map((id) => productOf(id)!)
    return {
      title: '拾光优选 · 首页',
      body: [
        { role: 'heading', name: '今日推荐', indent: 1 },
        ...picks.flatMap((p) => this.card(p, 1)),
        { role: 'text', name: '© 拾光优选 · 客服热线 400-800-1234 · 7 天无理由退货', indent: 1 },
      ],
    }
  }

  private listing(title: string, heading: string, items: Product[], base: string) {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
    const page = Math.min(pages, Math.max(1, Number(this.params().get('page') ?? 1) || 1))
    const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const sep = base.includes('?') ? '&' : '?'
    const body: Node[] = [{ role: 'heading', name: `${heading}（共 ${items.length} 件 · 第 ${page}/${pages} 页）`, indent: 1 }]
    if (!items.length) body.push({ role: 'text', name: '没有找到相关商品，换个关键词试试', indent: 1 })
    for (const p of shown) body.push(...this.card(p))
    if (page > 1) body.push({ role: 'link', name: '上一页', attrs: ` url="${base}${sep}page=${page - 1}"`, indent: 1, click: () => this.navigate(`${base}${sep}page=${page - 1}`) })
    if (page < pages) body.push({ role: 'link', name: '下一页', attrs: ` url="${base}${sep}page=${page + 1}"`, indent: 1, click: () => this.navigate(`${base}${sep}page=${page + 1}`) })
    return { title, body }
  }

  private searchPage() {
    const kw = this.params().get('q') ?? ''
    const tokens = kw.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (p: Product) => tokens.length > 0 && tokens.every((t) => `${p.name} ${(p.tags ?? []).join(' ')}`.toLowerCase().includes(t))
    const matched = PRODUCTS.filter(hit)
    const items = [...matched.filter((p) => p.sponsored), ...matched.filter((p) => !p.sponsored)]
    return this.listing(`拾光优选 · 搜索“${kw}”`, `搜索结果：${kw}`, items, `/search?q=${encodeURIComponent(kw)}`)
  }

  private categoryPage(cat: string) {
    const order = CATEGORY_ORDER[cat]
    const items = order ? order.map((id) => productOf(id)!) : PRODUCTS.filter((p) => p.category === cat && !p.sponsored)
    return this.listing(`拾光优选 · ${cat}`, `分类：${cat}`, items, `/category/${encodeURIComponent(cat)}`)
  }

  private selection(p: Product): Record<string, string> {
    this.selections[p.id] ??= { ...(p.colors ? { 颜色: p.colors[0] } : {}), ...(p.sizes ? { 尺码: '请选择' } : {}) }
    return this.selections[p.id]
  }

  private productPage(id: string) {
    const p = productOf(id)
    if (!p) return { title: '拾光优选 · 商品不存在', body: [{ role: 'heading', name: '商品不存在或已下架', indent: 1 } as Node] }
    const sel = this.selection(p)
    const body: Node[] = [
      { role: 'heading', name: p.name, indent: 1 },
      { role: 'text', name: `${p.sponsored ? '【赞助】' : ''}${money(p.price)} · 评分 ${p.rating}（${p.reviewCount} 条评价）`, indent: 1 },
      { role: 'text', name: p.desc, indent: 1 },
    ]
    const combo = (label: '颜色' | '尺码', values: string[], oos: (v: string) => boolean): Node => {
      const options = values.map((v) => (oos(v) ? `${v}（缺货）` : v))
      return {
        role: 'combobox',
        name: label,
        attrs: ` value="${sel[label]}" options=[${options.map((o) => `"${o}"`).join(',')}]`,
        indent: 1,
        select: (opt) => {
          if (!values.includes(opt)) fail(`“${label}”没有选项“${opt}”，可选：${options.join('、')}`)
          if (oos(opt)) fail(`选项“${opt}”不可选：该规格缺货`)
          sel[label] = opt
          if (label === '颜色' && sel.尺码 && sel.尺码 !== '请选择' && isOutOfStock(p, { ...sel })) sel.尺码 = '请选择'
        },
      }
    }
    if (p.colors) body.push(combo('颜色', p.colors, (v) => !p.sizes && isOutOfStock(p, { 颜色: v })))
    if (p.sizes) body.push(combo('尺码', p.sizes, (v) => isOutOfStock(p, { 颜色: sel.颜色, 尺码: v })))
    body.push(
      {
        role: 'spinbutton',
        name: '数量',
        attrs: ` value="${this.qty[p.id] ?? '1'}"`,
        indent: 1,
        type: (text) => {
          const n = Number(text.trim())
          if (!Number.isInteger(n) || n < 1 || n > 99) fail(`数量必须是 1~99 的整数，收到：“${text}”`)
          this.qty[p.id] = String(n)
        },
      },
      { role: 'button', name: '加入购物车', indent: 1, click: () => this.addToCart(p) },
    )
    if (p.reviews?.length) {
      body.push({ role: 'heading', name: `商品评价（${p.reviews.length}）`, indent: 1 })
      for (const r of p.reviews) body.push({ role: 'text', name: `${'★'.repeat(r.stars)} ${r.user}：${r.text}`, indent: 1 })
    }
    return { title: `拾光优选 · ${p.name}`, body }
  }

  private addToCart(p: Product): string {
    const sel = this.selection(p)
    if (sel.尺码 === '请选择') return '请先选择尺码'
    if (isOutOfStock(p, sel)) return '所选规格缺货，无法加入购物车'
    const qty = Number(this.qty[p.id] ?? 1)
    const options = { ...sel }
    const line = this.data.cart.find((l) => l.productId === p.id && JSON.stringify(l.options) === JSON.stringify(options))
    if (line) line.qty += qty
    else this.data.cart.push({ productId: p.id, options, qty })
    return `已加入购物车：${lineName(p.name, options)} ×${qty}`
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
    return `商品合计 ${money(t.subtotal)} · 优惠 -${money(t.discount)}${t.coupon ? `（${t.coupon}）` : ''} · 应付 ${money(t.paid)}`
  }

  private cartPage() {
    const body: Node[] = [{ role: 'heading', name: `购物车（${this.data.cart.length} 种商品）`, indent: 1 }]
    if (!this.data.cart.length) {
      body.push({ role: 'text', name: '购物车是空的，去逛逛吧', indent: 1 })
      return { title: '拾光优选 · 购物车', body }
    }
    for (const l of this.data.cart) {
      const p = productOf(l.productId)!
      const name = lineName(p.name, l.options)
      body.push(
        { role: 'text', name: `${name} · 单价 ${money(p.price)}`, indent: 1 },
        {
          role: 'spinbutton',
          name: `数量：${name}`,
          attrs: ` value="${l.qty}"`,
          indent: 2,
          type: (text) => {
            const n = Number(text.trim())
            if (!Number.isInteger(n) || n < 1 || n > 99) fail(`数量必须是 1~99 的整数（要移除商品请点“删除”），收到：“${text}”`)
            l.qty = n
            return `已把 ${name} 的数量改为 ${n}`
          },
        },
        {
          role: 'button',
          name: `删除：${name}`,
          indent: 2,
          click: () => {
            this.data.cart = this.data.cart.filter((x) => x !== l)
            return `已从购物车删除：${name}`
          },
        },
      )
    }
    const apply = (code: string) => {
      const c = this.data.coupons.find((x) => x.code.toLowerCase() === code.trim().toLowerCase())
      if (!c) return `优惠券 ${code.trim()} 无效`
      if (c.expired) return `优惠券 ${c.code} 已过期，无法使用`
      const { subtotal } = this.totals()
      if (subtotal < c.min) return `优惠券 ${c.code} 未达到使用门槛（${c.title}）`
      this.appliedCoupon = c.code
      return `优惠券 ${c.code} 已使用（${c.title}）`
    }
    body.push(
      {
        role: 'textbox',
        name: '优惠券码',
        attrs: ` value="${q(this.inputs.coupon ?? '')}"`,
        indent: 1,
        type: (text, enter) => {
          this.inputs.coupon = text
          if (enter) return apply(text)
        },
      },
      { role: 'button', name: '使用优惠券', indent: 1, click: () => apply(this.inputs.coupon ?? '') },
      { role: 'text', name: this.totalsText(), indent: 1 },
      { role: 'button', name: '去结算', indent: 1, click: () => this.navigate('/checkout') },
    )
    return { title: '拾光优选 · 购物车', body }
  }

  private addressText(id: string) {
    const a = this.data.addresses.find((x) => x.id === id)!
    return `${a.label}：${a.name} ${a.phone.slice(0, 3)}****${a.phone.slice(-4)} ${a.detail}`
  }

  private checkoutPage() {
    if (!this.data.cart.length) return { title: '拾光优选 · 确认订单', body: [{ role: 'text', name: '购物车是空的，无法结算', indent: 1 } as Node] }
    const chosen = this.checkoutAddress && this.data.addresses.some((a) => a.id === this.checkoutAddress) ? this.checkoutAddress : this.data.defaultAddressId
    const body: Node[] = [{ role: 'heading', name: '确认订单', indent: 1 }, { role: 'text', name: '收货地址', indent: 1 }]
    for (const a of this.data.addresses)
      body.push({
        role: 'radio',
        name: `${this.addressText(a.id)}${a.id === this.data.defaultAddressId ? '（默认）' : ''}`,
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
        name: '提交订单',
        indent: 1,
        click: () => {
          this.checkoutAddress = chosen
          this.dialog = { kind: 'pay', title: '确认支付', text: `将使用账户余额支付 ${money(this.totals().paid)}，确认吗？` }
        },
      },
      { role: 'link', name: '返回购物车', attrs: ' url="/cart"', indent: 1, click: () => this.navigate('/cart') },
    )
    return { title: '拾光优选 · 确认订单', body }
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
      status: '待发货',
      addressId: this.checkoutAddress ?? this.data.defaultAddressId,
    }
    this.data.orders.unshift(order)
    this.data.cart = []
    this.appliedCoupon = undefined
    this.checkoutAddress = undefined
    this.navigate(`/orders/${id}`)
    return `下单成功：订单 ${id}，实付 ${money(order.paid)}`
  }

  private orderLine(o: Order) {
    return `${o.date} · ${o.items.map((i) => `${lineName(i.name, i.options)}×${i.qty}`).join('，')} · 实付 ${money(o.paid)} · ${o.status}`
  }

  private ordersPage() {
    const body: Node[] = [{ role: 'heading', name: `我的订单（共 ${this.data.orders.length} 笔）`, indent: 1 }]
    for (const o of this.data.orders.slice(0, this.ordersShown))
      body.push(
        { role: 'link', name: `订单 ${o.id}`, attrs: ` url="/orders/${o.id}"`, indent: 1, click: () => this.navigate(`/orders/${o.id}`) },
        { role: 'text', name: this.orderLine(o), indent: 2 },
      )
    if (this.ordersShown < this.data.orders.length) body.push({ role: 'text', name: '—— 向下滚动加载更多订单 ——', indent: 1 })
    return { title: '拾光优选 · 我的订单', body }
  }

  private orderPage(id: string) {
    const o = this.data.orders.find((x) => x.id === id)
    if (!o) return { title: '拾光优选 · 订单不存在', body: [{ role: 'heading', name: `订单 ${id} 不存在`, indent: 1 } as Node] }
    const body: Node[] = [
      { role: 'heading', name: `订单 ${o.id}`, indent: 1 },
      { role: 'text', name: `状态：${o.status} · 下单时间：${o.date}`, indent: 1 },
      ...o.items.map((i): Node => ({ role: 'text', name: `${lineName(i.name, i.options)} × ${i.qty} · 单价 ${money(i.price)}`, indent: 1 })),
      { role: 'text', name: `商品合计 ${money(o.subtotal)} · 优惠 -${money(o.discount)}${o.coupon ? `（${o.coupon}）` : ''} · 实付 ${money(o.paid)}`, indent: 1 },
      { role: 'text', name: `收货地址：${this.data.addresses.find((a) => a.id === o.addressId) ? this.addressText(o.addressId) : '（地址已删除）'}`, indent: 1 },
    ]
    if (o.tracking) body.push({ role: 'text', name: `物流单号：${o.tracking}`, indent: 1 })
    if (o.status === '待发货')
      body.push({
        role: 'button',
        name: '取消订单',
        indent: 1,
        click: () => {
          this.dialog = { kind: 'cancel', title: '取消订单', text: `确定要取消订单 ${o.id} 吗？款项将原路退回。`, target: o.id }
        },
      })
    else if (o.status === '已发货') body.push({ role: 'text', name: '订单已发货，不能取消；签收后可以申请退货。', indent: 1 })
    body.push({ role: 'link', name: '返回订单列表', attrs: ' url="/orders"', indent: 1, click: () => this.navigate('/orders') })
    return { title: `拾光优选 · 订单 ${o.id}`, body }
  }

  private cancelOrder(id: string): string {
    this.dialog = undefined
    const o = this.data.orders.find((x) => x.id === id)!
    if (o.status !== '待发货') return `订单 ${id} 当前状态是“${o.status}”，不能取消`
    o.status = '已取消'
    return `订单 ${id} 已取消，款项将原路退回`
  }

  private deleteAddress(id: string): string {
    this.dialog = undefined
    const a = this.data.addresses.find((x) => x.id === id)!
    this.data.addresses = this.data.addresses.filter((x) => x.id !== id)
    return `已删除地址：${a.label}`
  }

  private accountPage() {
    const body: Node[] = [{ role: 'heading', name: '收货地址', indent: 1 }]
    for (const a of this.data.addresses) {
      const isDefault = a.id === this.data.defaultAddressId
      body.push({ role: 'text', name: `${a.label}${isDefault ? '（默认）' : ''}：${a.name} · ${a.phone.slice(0, 3)}****${a.phone.slice(-4)} · ${a.detail}`, indent: 1 })
      if (!isDefault)
        body.push({
          role: 'button',
          name: `设为默认：${a.label}`,
          indent: 2,
          click: () => {
            this.data.defaultAddressId = a.id
            return `已将“${a.label}”设为默认地址`
          },
        })
      body.push({
        role: 'button',
        name: `删除：${a.label}`,
        indent: 2,
        click: () => {
          if (isDefault) return '默认地址不能删除，请先把别的地址设为默认'
          this.dialog = { kind: 'delete', title: '删除地址', text: `确定删除地址“${a.label}”吗？`, target: a.id }
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
      { role: 'heading', name: '新增收货地址', indent: 1 },
      field('addr.label', '标签'),
      field('addr.name', '收货人'),
      field('addr.phone', '手机号'),
      field('addr.detail', '详细地址'),
      { role: 'checkbox', name: '设为默认地址', attrs: this.inputs['addr.default'] ? ' checked' : '', indent: 2, click: () => void (this.inputs['addr.default'] = this.inputs['addr.default'] ? '' : '1') },
      { role: 'button', name: '保存新地址', indent: 2, click: () => this.saveAddress() },
      { role: 'heading', name: '我的优惠券', indent: 1 },
      ...this.data.coupons.map((c): Node => ({ role: 'text', name: `${c.code}：${c.title}${c.expired ? '（已过期）' : ''}`, indent: 1 })),
    )
    return { title: '拾光优选 · 账户设置', body }
  }

  private saveAddress(): string {
    const v = (k: string) => (this.inputs[`addr.${k}`] ?? '').trim()
    const missing = [['label', '标签'], ['name', '收货人'], ['phone', '手机号'], ['detail', '详细地址']].filter(([k]) => !v(k)).map(([, n]) => n)
    if (missing.length) return `保存失败：请填写${missing.join('、')}`
    if (!/^1\d{10}$/.test(v('phone'))) return '保存失败：手机号格式不正确（11 位数字）'
    if (this.data.addresses.some((a) => a.label === v('label'))) return `保存失败：已经有标签为“${v('label')}”的地址`
    const id = `A${this.data.addresses.length + 1 + Math.max(0, ...this.data.addresses.map((a) => Number(a.id.slice(1))))}`
    this.data.addresses.push({ id, label: v('label'), name: v('name'), phone: v('phone'), detail: v('detail') })
    const makeDefault = !!this.inputs['addr.default']
    const label = v('label')
    if (makeDefault) this.data.defaultAddressId = id
    for (const k of Object.keys(this.inputs)) if (k.startsWith('addr.')) delete this.inputs[k]
    return `已保存新地址“${label}”${makeDefault ? '，并设为默认地址' : ''}`
  }

  private adminPage() {
    const body: Node[] = [{ role: 'heading', name: '商家后台 · 订单管理（林晓的文具小铺）', indent: 1 }]
    for (const o of this.data.sellerOrders) {
      body.push({ role: 'text', name: `${o.id} · ${o.date} · 买家 ${o.buyer} · ${o.items} · ${money(o.amount)} · ${o.status}${o.tracking ? `（${o.tracking}）` : ''}`, indent: 1 })
      if (o.status !== '待发货') continue
      const key = `track.${o.id}`
      body.push(
        { role: 'textbox', name: `快递单号：${o.id}`, attrs: ` value="${q(this.inputs[key] ?? '')}"`, indent: 2, type: (text) => void (this.inputs[key] = text) },
        {
          role: 'button',
          name: `发货：${o.id}`,
          indent: 2,
          click: () => {
            const t = (this.inputs[key] ?? '').trim()
            if (!/^[A-Z]{2}\d{10}$/.test(t)) return `发货失败：请先填写正确的快递单号（2 位大写字母 + 10 位数字），当前为“${t}”`
            o.status = '已发货'
            o.tracking = t
            delete this.inputs[key]
            return `订单 ${o.id} 已发货，快递单号 ${t}`
          },
        },
      )
    }
    return { title: '拾光优选 · 商家后台', body }
  }
}
