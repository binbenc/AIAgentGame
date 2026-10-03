/**
 * Nova 科技的“后端系统”：多个关卡共用的模拟业务数据与 API。
 * 每个场景调用 createNova() 拿到一份全新的状态，所有 API 调用都会记录进 trace。
 */
import { __delay, __traced } from '../../engine/runtime/api'
import type { ToolSpec } from '../../engine/llm/types'

export type OrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled'

export interface Customer {
  id: string
  name: string
  email: string
  tier: 'standard' | 'vip'
}

export interface Order {
  id: string
  customerId: string
  createdAt: string
  product: string
  amount: number
  status: OrderStatus
  /** 内部字段：不应该暴露给模型 */
  _internalCost: number
  _warehouseNotes: string
  _riskScore: number
}

export interface Shipping {
  orderId: string
  carrier: string
  status: string
  updatedAt: string
}

export const CUSTOMERS: Customer[] = [
  { id: 'C001', name: '王小明', email: 'alice@example.com', tier: 'vip' },
  { id: 'C002', name: '李华', email: 'bob@example.com', tier: 'standard' },
]

export const ORDERS: Order[] = [
  { id: 'NV-100001', customerId: 'C001', createdAt: '2026-09-20', product: '智能空调 X1', amount: 3999, status: 'shipped', _internalCost: 2100, _warehouseNotes: '华东仓 B-17 货架，外箱轻微破损已重新包装，质检员张工签字确认', _riskScore: 0.02 },
  { id: 'NV-100002', customerId: 'C001', createdAt: '2026-09-28', product: '智能门锁 L2', amount: 1299, status: 'pending', _internalCost: 610, _warehouseNotes: '待拣货，等待供应商补货（预计 2 天）', _riskScore: 0.01 },
  { id: 'NV-100003', customerId: 'C002', createdAt: '2026-08-15', product: '扫地机器人 R5', amount: 2499, status: 'delivered', _internalCost: 1320, _warehouseNotes: '华南仓直发', _riskScore: 0.05 },
  { id: 'NV-100004', customerId: 'C002', createdAt: '2026-09-30', product: '智能灯泡套装', amount: 299, status: 'shipped', _internalCost: 88, _warehouseNotes: '合单发货', _riskScore: 0.03 },
]

export const SHIPPING: Record<string, Shipping> = {
  'NV-100001': { orderId: 'NV-100001', carrier: '顺丰', status: '已到达上海转运中心', updatedAt: '2026-10-02 18:20' },
  'NV-100003': { orderId: 'NV-100003', carrier: '京东物流', status: '已签收', updatedAt: '2026-08-17 10:05' },
  'NV-100004': { orderId: 'NV-100004', carrier: '中通', status: '派送中', updatedAt: '2026-10-03 09:12' },
}

export const REFUND_POLICY = '签收后 7 天内可无理由退货；已发货但未签收的订单不能取消，可在签收后申请退货；VIP 客户退款优先处理（1 个工作日内）。'

export class NovaError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NovaError'
  }
}

export function createNova() {
  const orders = ORDERS.map((o) => ({ ...o }))
  const api = {
    findCustomer: __traced('findCustomer', async (email: string) => {
      await __delay(80)
      const c = CUSTOMERS.find((x) => x.email === email)
      if (!c) throw new NovaError('CUSTOMER_NOT_FOUND', `找不到邮箱为 ${email} 的客户`)
      return { ...c }
    }),
    listOrders: __traced('listOrders', async (customerId: string, status?: OrderStatus) =>
      (await __delay(120), orders).filter((o) => o.customerId === customerId && (!status || o.status === status)).map((o) => ({ ...o })),
    ),
    searchOrders: __traced('searchOrders', async (q: { customerEmail: string; status?: OrderStatus }) => {
      await __delay(150)
      const c = CUSTOMERS.find((x) => x.email === q.customerEmail)
      if (!c) throw new NovaError('CUSTOMER_NOT_FOUND', `找不到邮箱为 ${q.customerEmail} 的客户`)
      return orders.filter((o) => o.customerId === c.id && (!q.status || o.status === q.status)).map((o) => ({ ...o }))
    }),
    getOrder: __traced('getOrder', async (orderId: string) => {
      await __delay(60)
      const o = orders.find((x) => x.id === orderId)
      if (!o) throw new NovaError('ORDER_NOT_FOUND', `订单 ${orderId} 不存在`)
      return { ...o }
    }),
    getShipping: __traced('getShipping', async (orderId: string) => {
      await __delay(200)
      const s = SHIPPING[orderId]
      if (!s) throw new NovaError('NO_SHIPPING', `订单 ${orderId} 暂无物流信息`)
      return { ...s }
    }),
    cancelOrder: __traced('cancelOrder', async (orderId: string, reason: string) => {
      await __delay(150)
      const o = orders.find((x) => x.id === orderId)
      if (!o) throw new NovaError('ORDER_NOT_FOUND', `订单 ${orderId} 不存在`)
      if (o.status === 'shipped' || o.status === 'delivered')
        throw new NovaError('ORDER_SHIPPED', `订单 ${orderId} 已发货，无法取消`)
      if (o.status === 'cancelled') return { orderId, status: 'cancelled', note: '订单此前已取消' }
      o.status = 'cancelled'
      return { orderId, status: 'cancelled', reason }
    }),
    refundPolicy: __traced('refundPolicy', async () => REFUND_POLICY),
    orders,
  }
  return api
}

export type NovaApi = ReturnType<typeof createNova>

export interface Tool {
  spec: ToolSpec
  run(input: any): unknown | Promise<unknown>
}

/** 第 4 关提供的现成工具（第 5 关玩家会自己设计更好的工具） */
export function basicNovaTools(api: NovaApi): Tool[] {
  return [
    {
      spec: {
        name: 'find_customer',
        description: '根据邮箱查找客户，返回客户 id、姓名和等级。',
        input_schema: { type: 'object', properties: { email: { type: 'string', description: '客户邮箱' } }, required: ['email'] },
      },
      run: (i) => api.findCustomer(i.email),
    },
    {
      spec: {
        name: 'list_orders',
        description: '列出某个客户的全部订单。',
        input_schema: { type: 'object', properties: { customer_id: { type: 'string', description: '客户 id，例如 C001' } }, required: ['customer_id'] },
      },
      run: async (i) =>
        (await api.listOrders(i.customer_id)).map((o) => ({ id: o.id, createdAt: o.createdAt, product: o.product, status: o.status })),
    },
    {
      spec: {
        name: 'get_shipping',
        description: '查询订单的物流状态。',
        input_schema: { type: 'object', properties: { order_id: { type: 'string', description: '订单号，例如 NV-100001' } }, required: ['order_id'] },
      },
      run: (i) => api.getShipping(i.order_id),
    },
  ]
}
