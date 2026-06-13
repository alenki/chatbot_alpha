import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from './test-utils.js'
import {
  catalogOptions,
  catalogPriceTiers,
  catalogServices,
  faqChunks,
  settings,
} from './schema.js'
import { seed } from './seed.js'

const db = getTestDb()

describe('seed', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('writes the three settings rows with the contract defaults', async () => {
    await seed(db, { faq: false })

    const rows = await db.select().from(settings)
    const byKey = new Map(rows.map((r) => [r.key, r.value]))

    expect(byKey.has('system_prompt')).toBe(true)
    expect(typeof byKey.get('system_prompt')).toBe('string')
    expect(byKey.get('escalation_keywords')).toEqual([
      'позовите человека',
      'оператор',
      'менеджер',
      'живой человек',
      'жалоба',
      'верните деньги',
      'безобразие',
      'юрист',
      'суд',
    ])
    expect(byKey.get('daily_turn_cap')).toBe(30)
  })

  it('seeds the catalog: services, options and price tiers', async () => {
    await seed(db, { faq: false })

    const services = await db.select().from(catalogServices)
    const names = services.map((s) => s.name).sort()
    expect(names).toEqual(['Баннер', 'Визитки', 'Листовки А5'])

    const vizitki = services.find((s) => s.name === 'Визитки')!
    expect(vizitki.unit).toBe('шт')
    expect(vizitki.aliases).toEqual(['визитка', 'визитки'])

    const banner = services.find((s) => s.name === 'Баннер')!
    expect(banner.unit).toBe('м2')

    // Визитки has three quantity tiers
    const vizitkiTiers = await db
      .select()
      .from(catalogPriceTiers)
      .where(eq(catalogPriceTiers.serviceId, vizitki.id))
    const tierMap = new Map(vizitkiTiers.map((t) => [t.minQty, Number(t.unitPrice)]))
    expect(tierMap.get(100)).toBe(4.5)
    expect(tierMap.get(500)).toBe(3.2)
    expect(tierMap.get(1000)).toBe(2.8)

    // Визитки options: a material group and a finishing group
    const vizitkiOptions = await db
      .select()
      .from(catalogOptions)
      .where(eq(catalogOptions.serviceId, vizitki.id))
    const optByName = new Map(vizitkiOptions.map((o) => [o.name, o]))
    expect(Number(optByName.get('Мелованная 300г')!.priceDelta)).toBe(0)
    expect(optByName.get('Мелованная 300г')!.optionGroup).toBe('material')
    expect(Number(optByName.get('Дизайнерская бумага')!.priceDelta)).toBe(1.5)
    expect(Number(optByName.get('Ламинация')!.priceDelta)).toBe(2)
    expect(optByName.get('Ламинация')!.optionGroup).toBe('finishing')
  })

  it('is idempotent: a second run does not duplicate rows', async () => {
    await seed(db, { faq: false })
    await seed(db, { faq: false })

    const services = await db.select().from(catalogServices)
    const options = await db.select().from(catalogOptions)
    const tiers = await db.select().from(catalogPriceTiers)
    const settingsRows = await db.select().from(settings)

    expect(services).toHaveLength(3)
    // Визитки: 2 material + 1 finishing = 3; Листовки: 0; Баннер: 0
    expect(options).toHaveLength(3)
    // Визитки 3 + Листовки 2 + Баннер 1 = 6
    expect(tiers).toHaveLength(6)
    expect(settingsRows).toHaveLength(3)
  })
})

// FAQ embedding downloads the e5-small ONNX weights on first run — guarded, like the
// embeddings smoke test in Task 7. Run with:
//   pnpm --filter server exec cross-env RUN_EMBEDDING_TESTS=1 vitest run src/db/seed.test.ts
describe.runIf(process.env.RUN_EMBEDDING_TESTS === '1')('seed FAQ (slow, real embeddings)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('writes 5 FAQ chunks with embeddings and is idempotent', async () => {
    await seed(db, { faq: true })
    await seed(db, { faq: true })

    const chunks = await db.select().from(faqChunks)
    expect(chunks).toHaveLength(5)
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(20)
      expect(chunk.embedding).not.toBeNull()
      expect(chunk.embedding).toHaveLength(384)
    }
    const titles = chunks.map((c) => c.title).sort()
    expect(titles).toEqual([
      'Доставка',
      'Как заказать дизайн',
      'Оплата',
      'Сроки изготовления',
      'Требования к макетам',
    ])
  }, 600_000)
})
