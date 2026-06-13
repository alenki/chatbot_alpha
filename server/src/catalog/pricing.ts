import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { catalogOptions, catalogPriceTiers, catalogServices } from '../db/schema.js'

export interface QuoteRequest { service: string; quantity: number; options?: string[] }
export type QuoteResult =
  | { kind: 'quote'; service: string; quantity: number; unitPrice: number; total: number; currency: 'RUB'; appliedOptions: string[]; note: string }
  | { kind: 'needs_manager'; reason: string; candidates?: string[] }

const PRELIMINARY_NOTE = 'Предварительная цена, менеджер подтвердит итоговую.'

/** Round to 2 decimals (kopecks) to absorb float artifacts like 3.2 * 500 = 1600.0000000000002. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function getPriceQuote(db: Db, req: QuoteRequest): Promise<QuoteResult> {
  const needle = req.service.trim().toLowerCase()

  // The catalog is small (tens of rows), so load active services once and match in memory.
  const services = await db.select().from(catalogServices).where(eq(catalogServices.active, true))

  // Pass 1: case-insensitive exact match on name or any alias.
  let matched = services.filter(
    (s) => s.name.toLowerCase() === needle || s.aliases.some((a) => a.toLowerCase() === needle),
  )
  // Pass 2: case-insensitive substring match (ILIKE '%needle%' semantics) on name or aliases.
  if (matched.length === 0) {
    matched = services.filter(
      (s) => s.name.toLowerCase().includes(needle) || s.aliases.some((a) => a.toLowerCase().includes(needle)),
    )
  }
  if (matched.length === 0) {
    return { kind: 'needs_manager', reason: `Услуга «${req.service}» не найдена в каталоге` }
  }
  if (matched.length > 1) {
    return {
      kind: 'needs_manager',
      reason: 'Найдено несколько подходящих услуг, нужно уточнить название',
      candidates: matched.map((s) => s.name),
    }
  }
  const service = matched[0]!

  // Tier: the highest minQty that is still <= the requested quantity.
  const tiers = await db
    .select()
    .from(catalogPriceTiers)
    .where(eq(catalogPriceTiers.serviceId, service.id))
  const eligible = tiers.filter((t) => t.minQty <= req.quantity).sort((a, b) => b.minQty - a.minQty)
  if (eligible.length === 0) {
    if (tiers.length === 0) {
      return { kind: 'needs_manager', reason: `Для услуги «${service.name}» не заполнена тиражная сетка цен` }
    }
    const lowestMinQty = Math.min(...tiers.map((t) => t.minQty))
    return {
      kind: 'needs_manager',
      reason: `Минимальный тираж для услуги «${service.name}» — ${lowestMinQty} ${service.unit}`,
    }
  }
  const tier = eligible[0]!

  // Options: case-insensitive name match within this service; any unknown option → manager.
  const appliedOptions: string[] = []
  let optionsDelta = 0
  if (req.options !== undefined && req.options.length > 0) {
    const serviceOptions = await db
      .select()
      .from(catalogOptions)
      .where(eq(catalogOptions.serviceId, service.id))
    for (const requested of req.options) {
      const found = serviceOptions.find((o) => o.name.toLowerCase() === requested.trim().toLowerCase())
      if (found === undefined) {
        return { kind: 'needs_manager', reason: `Опция «${requested}» не найдена для услуги «${service.name}»` }
      }
      appliedOptions.push(found.name)
      // Drizzle returns numeric columns as strings — convert explicitly.
      optionsDelta += Number(found.priceDelta)
    }
  }

  const unitPrice = round2(Number(tier.unitPrice) + optionsDelta)
  const total = round2(unitPrice * req.quantity)
  return {
    kind: 'quote',
    service: service.name,
    quantity: req.quantity,
    unitPrice,
    total,
    currency: 'RUB',
    appliedOptions,
    note: PRELIMINARY_NOTE,
  }
}
