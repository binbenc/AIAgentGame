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
        name: 'search_orders',
        description:
          'Search a customer\'s orders by email, optionally filtered by status. Use it when the user asks about "my orders" or orders in a given state. Returns order id, order date, product, amount and status.',
        input_schema: {
          type: 'object',
          properties: {
            customer_email: { type: 'string', description: 'Customer email, e.g. alice@example.com' },
            status: {
              type: 'string',
              enum: ['pending', 'shipped', 'delivered', 'cancelled'],
              description: 'Optional. pending = not shipped yet, shipped = shipped but not delivered, delivered = delivered, cancelled = cancelled',
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
        description:
          'Cancel an order that has not shipped yet (pending). Use it only when the user explicitly asks to cancel; shipped or delivered orders cannot be cancelled, so explain the return policy instead.',
        input_schema: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'Order id: NV- followed by 6 digits, e.g. NV-100001' },
            reason: { type: 'string', description: "The user's reason for cancelling, briefly paraphrased" },
          },
          required: ['order_id', 'reason'],
        },
      },
      run: (input) => api.cancelOrder(input.order_id, input.reason),
    },
    {
      spec: {
        name: 'get_refund_policy',
        description:
          "Get Nova's full return and refund policy. Use it when the user asks about returns or refunds, or when an order can't be cancelled and you need to offer an alternative.",
        input_schema: { type: 'object', properties: {} },
      },
      run: () => api.refundPolicy(),
    },
  ]
}
