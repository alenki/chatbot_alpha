import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import { orders } from '../../db/schema.js'

const ORDER_STATUSES = ['new', 'confirmed', 'in_work', 'done'] as const

export interface OrdersRouteDeps {
  db: Db
}

export function registerOrdersRoutes(app: FastifyInstance, deps: OrdersRouteDeps): void {
  const { db } = deps

  // GET /api/orders — board data (every order, newest first).
  app.get('/api/orders', async () => {
    return db.select().from(orders).orderBy(desc(orders.createdAt))
  })

  // PATCH /api/orders/:id { status } — status transition.
  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/api/orders/:id', async (req, reply) => {
    const orderId = Number(req.params.id)
    const status = req.body?.status
    if (typeof status !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(status)) {
      return reply.code(400).send({ error: `status must be one of ${ORDER_STATUSES.join(', ')}` })
    }
    const updated = await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning()
    if (updated.length === 0) return reply.code(404).send({ error: 'order not found' })
    return updated[0]
  })
}
