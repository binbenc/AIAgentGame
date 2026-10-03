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
        name: 'orders',
        description: '订单',
        input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
      },
      run: (input) => api.searchOrders({ customerEmail: input.email }),
    },
    // TODO：改进上面的查询工具（status 枚举、参数描述、精简返回值）
    // TODO：取消订单工具
    // TODO：退货政策工具
  ]
}
