import type { Tool } from './tools'

export type OrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled'

export interface RawOrder {
  id: string
  customerId: string
  createdAt: string
  product: string
  amount: number
  status: OrderStatus
  [internal: string]: unknown // 还有一些 _ 开头的内部字段
}

export interface OrderApi {
  searchOrders(q: { customerEmail: string; status?: OrderStatus }): Promise<RawOrder[]>
  cancelOrder(orderId: string, reason: string): Promise<unknown>
  refundPolicy(): Promise<string>
}

export function createOrderTools(api: OrderApi): Tool[] {
  return [
    {
      spec: {
        name: 'search_orders',
        description: '按客户邮箱查询订单列表，可按订单状态过滤。用户询问“我的订单”“某状态的订单”时使用。返回订单号、下单日期、商品、金额和状态。',
        input_schema: {
          type: 'object',
          properties: {
            customer_email: { type: 'string', description: '客户邮箱，例如 alice@example.com' },
            status: {
              type: 'string',
              enum: ['pending', 'shipped', 'delivered', 'cancelled'],
              description: '可选。pending=待发货，shipped=已发货未签收，delivered=已签收，cancelled=已取消',
            },
          },
          required: ['customer_email'],
        },
      },
      run: async (input) => {
        const orders = await api.searchOrders({ customerEmail: input.customer_email, status: input.status })
        return orders.map(({ id, createdAt, product, amount, status }) => ({ id, createdAt, product, amount, status }))
      },
    },
    {
      spec: {
        name: 'cancel_order',
        description: '取消一个尚未发货（pending）的订单。仅在用户明确要求取消时使用；已发货或已签收的订单无法取消，应改为介绍退货政策。',
        input_schema: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: '订单号，格式为 NV- 加 6 位数字，例如 NV-100001' },
            reason: { type: 'string', description: '用户给出的取消原因，简要转述' },
          },
          required: ['order_id', 'reason'],
        },
      },
      run: (input) => api.cancelOrder(input.order_id, input.reason),
    },
    {
      spec: {
        name: 'get_refund_policy',
        description: '获取 Nova 的退货退款政策全文。当用户询问退货、退款规则，或订单无法取消需要给出替代方案时使用。',
        input_schema: { type: 'object', properties: {} },
      },
      run: () => api.refundPolicy(),
    },
  ]
}
