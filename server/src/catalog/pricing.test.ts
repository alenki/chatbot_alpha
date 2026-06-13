import { beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { catalogOptions, catalogPriceTiers, catalogServices } from '../db/schema.js'
import { getPriceQuote, type QuoteResult } from './pricing.js'

const db = getTestDb()

// Seed a small realistic catalog. NOTE: drizzle numeric columns take STRING values on insert.
async function seedCatalog() {
  const [vizitki] = await db
    .insert(catalogServices)
    .values({ name: 'Визитки', aliases: ['визитка'], description: 'Визитные карточки', unit: 'шт' })
    .returning()
  const [listovki] = await db
    .insert(catalogServices)
    .values({ name: 'Листовки', aliases: ['листовка', 'флаер'], unit: 'шт' })
    .returning()
  if (!vizitki || !listovki) throw new Error('seed failed')
  await db.insert(catalogPriceTiers).values([
    { serviceId: vizitki.id, minQty: 100, unitPrice: '4.50' },
    { serviceId: vizitki.id, minQty: 500, unitPrice: '3.20' },
    { serviceId: listovki.id, minQty: 1000, unitPrice: '2.10' },
  ])
  await db.insert(catalogOptions).values([
    { serviceId: vizitki.id, optionGroup: 'material', name: 'Мелованная бумага 300г', priceDelta: '0.50' },
    { serviceId: vizitki.id, optionGroup: 'finishing', name: 'Ламинация матовая', priceDelta: '2.00' },
  ])
}

function asQuote(res: QuoteResult) {
  if (res.kind !== 'quote') throw new Error(`expected quote, got ${JSON.stringify(res)}`)
  return res
}

function asNeedsManager(res: QuoteResult) {
  if (res.kind !== 'needs_manager') throw new Error(`expected needs_manager, got ${JSON.stringify(res)}`)
  return res
}

describe('getPriceQuote', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalog()
  })

  it('quotes an exact service-name match with the preliminary note', async () => {
    const res = await getPriceQuote(db, { service: 'Визитки', quantity: 100 })
    expect(res).toEqual({
      kind: 'quote',
      service: 'Визитки',
      quantity: 100,
      unitPrice: 4.5,
      total: 450,
      currency: 'RUB',
      appliedOptions: [],
      note: 'Предварительная цена, менеджер подтвердит итоговую.',
    })
  })

  it('returns numbers, not numeric strings, for prices', async () => {
    const q = asQuote(await getPriceQuote(db, { service: 'Визитки', quantity: 100 }))
    expect(typeof q.unitPrice).toBe('number')
    expect(typeof q.total).toBe('number')
  })

  it('matches a service by alias', async () => {
    const q = asQuote(await getPriceQuote(db, { service: 'визитка', quantity: 100 }))
    expect(q.service).toBe('Визитки')
    expect(q.unitPrice).toBe(4.5)
  })

  it('matches name and alias case-insensitively', async () => {
    const byName = asQuote(await getPriceQuote(db, { service: 'вИзИтКи', quantity: 100 }))
    expect(byName.service).toBe('Визитки')
    const byAlias = asQuote(await getPriceQuote(db, { service: 'ВИЗИТКА', quantity: 100 }))
    expect(byAlias.service).toBe('Визитки')
  })

  it('matches a unique substring', async () => {
    const q = asQuote(await getPriceQuote(db, { service: 'визит', quantity: 100 }))
    expect(q.service).toBe('Визитки')
  })

  it('returns needs_manager with candidates when a substring matches several services', async () => {
    // 'ки' is a substring of both 'Визитки' and 'Листовки'
    const nm = asNeedsManager(await getPriceQuote(db, { service: 'ки', quantity: 100 }))
    expect(nm.reason).toBe('Найдено несколько подходящих услуг, нужно уточнить название')
    expect(nm.candidates).toHaveLength(2)
    expect(nm.candidates).toEqual(expect.arrayContaining(['Визитки', 'Листовки']))
  })

  it('returns needs_manager when no service matches', async () => {
    const nm = asNeedsManager(await getPriceQuote(db, { service: 'Кружки', quantity: 100 }))
    expect(nm.reason).toBe('Услуга «Кружки» не найдена в каталоге')
    expect(nm.candidates).toBeUndefined()
  })

  it('ignores inactive services', async () => {
    await db.insert(catalogServices).values({ name: 'Баннеры', aliases: [], active: false })
    const nm = asNeedsManager(await getPriceQuote(db, { service: 'Баннеры', quantity: 100 }))
    expect(nm.reason).toBe('Услуга «Баннеры» не найдена в каталоге')
  })

  it('returns needs_manager when quantity is below the lowest tier', async () => {
    const nm = asNeedsManager(await getPriceQuote(db, { service: 'Визитки', quantity: 50 }))
    expect(nm.reason).toBe('Минимальный тираж для услуги «Визитки» — 100 шт')
  })

  it('takes the higher tier exactly at its boundary (qty 500 → 500-tier price)', async () => {
    const q = asQuote(await getPriceQuote(db, { service: 'Визитки', quantity: 500 }))
    expect(q.unitPrice).toBe(3.2)
    expect(q.total).toBe(1600)
  })

  it('uses the highest tier whose minQty <= quantity', async () => {
    const below = asQuote(await getPriceQuote(db, { service: 'Визитки', quantity: 499 }))
    expect(below.unitPrice).toBe(4.5)
    const above = asQuote(await getPriceQuote(db, { service: 'Визитки', quantity: 1200 }))
    expect(above.unitPrice).toBe(3.2)
    expect(above.total).toBe(3840)
  })

  it('adds option price deltas to the unit price', async () => {
    const q = asQuote(
      await getPriceQuote(db, {
        service: 'Визитки',
        quantity: 100,
        options: ['Мелованная бумага 300г', 'Ламинация матовая'],
      }),
    )
    expect(q.unitPrice).toBe(7) // 4.50 + 0.50 + 2.00
    expect(q.total).toBe(700)
    expect(q.appliedOptions).toEqual(['Мелованная бумага 300г', 'Ламинация матовая'])
  })

  it('matches options case-insensitively and returns canonical names', async () => {
    const q = asQuote(
      await getPriceQuote(db, { service: 'Визитки', quantity: 100, options: ['ламинация матовая'] }),
    )
    expect(q.unitPrice).toBe(6.5)
    expect(q.appliedOptions).toEqual(['Ламинация матовая'])
  })

  it('returns needs_manager for an unknown option', async () => {
    const nm = asNeedsManager(
      await getPriceQuote(db, { service: 'Визитки', quantity: 100, options: ['Тиснение золотом'] }),
    )
    expect(nm.reason).toBe('Опция «Тиснение золотом» не найдена для услуги «Визитки»')
  })
})
