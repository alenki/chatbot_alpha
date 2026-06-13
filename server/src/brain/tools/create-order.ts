import { z } from 'zod'
import { and, eq, gte } from 'drizzle-orm'
import { messages, orders } from '../../db/schema.js'
import type { AgentTool } from './registry.js'

const schema = z.object({
  serviceType: z.string(),
  specs: z.record(z.string()),
  quantity: z.number().optional(),
  deadline: z.string().optional(),
  contact: z.string(),
})

export const createOrderTool: AgentTool<z.infer<typeof schema>> = {
  name: 'create_order',
  description:
    'Создать заявку на заказ для менеджера, когда собраны все данные: ' +
    'serviceType — услуга, specs — характеристики (материал, формат, отделка и т.п.), ' +
    'quantity — тираж, deadline — срок, contact — контакт клиента для связи. ' +
    'Файлы, присланные клиентом в чат за последние 24 часа, прикрепятся автоматически.',
  schema,
  async execute(args, ctx) {
    const serviceType = args.serviceType.trim()
    const contact = args.contact.trim()
    if (serviceType === '') return JSON.stringify({ error: 'serviceType is required' })
    if (contact === '') return JSON.stringify({ error: 'contact is required' })

    // Gather every attachment from this chat's messages of the last 24 hours.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const recent = await ctx.db
      .select({ attachments: messages.attachments })
      .from(messages)
      .where(and(eq(messages.chatId, ctx.chatId), gte(messages.createdAt, since)))
    const files = recent.flatMap((row) => row.attachments)

    const inserted = await ctx.db
      .insert(orders)
      .values({
        chatId: ctx.chatId,
        clientId: ctx.clientId,
        serviceType,
        specs: args.specs,
        quantity: args.quantity,
        deadline: args.deadline,
        contact,
        files,
      })
      .returning({ id: orders.id })
    const orderId = inserted[0]!.id

    await ctx.notifier.orderCard(orderId)
    return JSON.stringify({ ok: true, orderId })
  },
}
