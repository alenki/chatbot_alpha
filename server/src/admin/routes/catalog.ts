import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import { catalogOptions, catalogPriceTiers, catalogServices } from '../../db/schema.js'

export interface CatalogRouteDeps {
  db: Db
}

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps): void {
  const { db } = deps

  // ---- services ----
  app.get('/api/catalog/services', async () => {
    return db.select().from(catalogServices).orderBy(catalogServices.id)
  })

  app.post<{
    Body: { name: string; aliases?: string[]; description?: string; unit?: string; active?: boolean }
  }>('/api/catalog/services', async (req, reply) => {
    const b = req.body
    if (typeof b?.name !== 'string' || b.name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' })
    }
    const inserted = await db
      .insert(catalogServices)
      .values({
        name: b.name.trim(),
        aliases: Array.isArray(b.aliases) ? b.aliases : [],
        description: b.description ?? '',
        unit: b.unit ?? 'шт',
        active: b.active ?? true,
      })
      .returning()
    return reply.code(201).send(inserted[0])
  })

  app.put<{
    Params: { id: string }
    Body: { name?: string; aliases?: string[]; description?: string; unit?: string; active?: boolean }
  }>('/api/catalog/services/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const b = req.body ?? {}
    const set: Record<string, unknown> = {}
    if (typeof b.name === 'string') set.name = b.name.trim()
    if (Array.isArray(b.aliases)) set.aliases = b.aliases
    if (typeof b.description === 'string') set.description = b.description
    if (typeof b.unit === 'string') set.unit = b.unit
    if (typeof b.active === 'boolean') set.active = b.active
    const updated = await db.update(catalogServices).set(set).where(eq(catalogServices.id, id)).returning()
    if (updated.length === 0) return reply.code(404).send({ error: 'service not found' })
    return updated[0]
  })

  app.delete<{ Params: { id: string } }>('/api/catalog/services/:id', async (req) => {
    await db.delete(catalogServices).where(eq(catalogServices.id, Number(req.params.id)))
    return { ok: true }
  })

  // ---- options (scoped by serviceId on GET) ----
  app.get<{ Querystring: { serviceId?: string } }>('/api/catalog/options', async (req) => {
    const serviceId = req.query.serviceId
    const q = db.select().from(catalogOptions)
    if (serviceId !== undefined && serviceId !== '') {
      return q.where(eq(catalogOptions.serviceId, Number(serviceId))).orderBy(catalogOptions.id)
    }
    return q.orderBy(catalogOptions.id)
  })

  app.post<{
    Body: { serviceId: number; optionGroup: string; name: string; priceDelta?: string }
  }>('/api/catalog/options', async (req, reply) => {
    const b = req.body
    if (typeof b?.serviceId !== 'number' || typeof b?.optionGroup !== 'string' || typeof b?.name !== 'string') {
      return reply.code(400).send({ error: 'serviceId, optionGroup and name are required' })
    }
    const inserted = await db
      .insert(catalogOptions)
      .values({
        serviceId: b.serviceId,
        optionGroup: b.optionGroup,
        name: b.name,
        priceDelta: b.priceDelta ?? '0',
      })
      .returning()
    return reply.code(201).send(inserted[0])
  })

  app.put<{
    Params: { id: string }
    Body: { optionGroup?: string; name?: string; priceDelta?: string }
  }>('/api/catalog/options/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const b = req.body ?? {}
    const set: Record<string, unknown> = {}
    if (typeof b.optionGroup === 'string') set.optionGroup = b.optionGroup
    if (typeof b.name === 'string') set.name = b.name
    if (typeof b.priceDelta === 'string') set.priceDelta = b.priceDelta
    const updated = await db.update(catalogOptions).set(set).where(eq(catalogOptions.id, id)).returning()
    if (updated.length === 0) return reply.code(404).send({ error: 'option not found' })
    return updated[0]
  })

  app.delete<{ Params: { id: string } }>('/api/catalog/options/:id', async (req) => {
    await db.delete(catalogOptions).where(eq(catalogOptions.id, Number(req.params.id)))
    return { ok: true }
  })

  // ---- tiers (scoped by serviceId on GET) ----
  app.get<{ Querystring: { serviceId?: string } }>('/api/catalog/tiers', async (req) => {
    const serviceId = req.query.serviceId
    const q = db.select().from(catalogPriceTiers)
    if (serviceId !== undefined && serviceId !== '') {
      return q.where(eq(catalogPriceTiers.serviceId, Number(serviceId))).orderBy(catalogPriceTiers.minQty)
    }
    return q.orderBy(catalogPriceTiers.minQty)
  })

  app.post<{
    Body: { serviceId: number; minQty: number; unitPrice: string }
  }>('/api/catalog/tiers', async (req, reply) => {
    const b = req.body
    if (typeof b?.serviceId !== 'number' || typeof b?.minQty !== 'number' || typeof b?.unitPrice !== 'string') {
      return reply.code(400).send({ error: 'serviceId, minQty and unitPrice are required' })
    }
    const inserted = await db
      .insert(catalogPriceTiers)
      .values({ serviceId: b.serviceId, minQty: b.minQty, unitPrice: b.unitPrice })
      .returning()
    return reply.code(201).send(inserted[0])
  })

  app.put<{
    Params: { id: string }
    Body: { minQty?: number; unitPrice?: string }
  }>('/api/catalog/tiers/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const b = req.body ?? {}
    const set: Record<string, unknown> = {}
    if (typeof b.minQty === 'number') set.minQty = b.minQty
    if (typeof b.unitPrice === 'string') set.unitPrice = b.unitPrice
    const updated = await db.update(catalogPriceTiers).set(set).where(eq(catalogPriceTiers.id, id)).returning()
    if (updated.length === 0) return reply.code(404).send({ error: 'tier not found' })
    return updated[0]
  })

  app.delete<{ Params: { id: string } }>('/api/catalog/tiers/:id', async (req) => {
    await db.delete(catalogPriceTiers).where(eq(catalogPriceTiers.id, Number(req.params.id)))
    return { ok: true }
  })
}
