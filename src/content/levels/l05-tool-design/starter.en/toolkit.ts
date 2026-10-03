import type { Tool } from './tools'

export type OrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled'

export interface RawOrder {
  id: string
  customerId: string
  createdAt: string
  product: string
  amount: number
  status: OrderStatus
  [internal: string]: unknown // plus some internal fields starting with _
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
        description: 'Orders',
        input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
      },
      run: (input) => api.searchOrders({ customerEmail: input.email }),
    },
    // TODO: improve the search tool above (status enum, parameter descriptions, lean results)
    // TODO: a tool to cancel an order
    // TODO: a tool for the return policy
  ]
}
