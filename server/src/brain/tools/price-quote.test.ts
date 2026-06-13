import { beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb } from '../../db/test-utils.js'
import { catalogPriceTiers, catalogServices } from '../../db/schema.js'
import { createLogger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import { dispatchToolCall, type ToolContext } from './registry.js'
import { priceQuoteTool } from './price-quote.js'

const db = getTestDb()

class FakeNotifier implements ManagerNotifier {
  orderCards: number[] = []
  escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> { this.orderCards.push(orderId) }
  async escalationCard(escalationId: number): Promise<void> { this.escalationCards.push(escalationId) }
}

function makeCtx(): ToolContext {
  return { db, chatId: 1, clientId: null, notifier: new FakeNotifier(), filesDir: './data/files', log: createLogger('test') }
}

describe('priceQuoteTool', () => {
  beforeEach(async () => {
    await resetDb()
    const inserted = await db
      .insert(catalogServices)
      .values({ name: 'Визитки', aliases: ['визитка'], unit: 'шт' })
      .returning({ id: catalogServices.id })
    await db.insert(catalogPriceTiers).values({ serviceId: inserted[0]!.id, minQty: 100, unitPrice: '4.50' })
  })

  it('is registered under the contract name get_price_quote', () => {
    expect(priceQuoteTool.name).toBe('get_price_quote')
  })

  it('returns the QuoteResult from getPriceQuote as a JSON string', async () => {
    const result = await priceQuoteTool.execute({ service: 'Визитки', quantity: 200 }, makeCtx())
    expect(JSON.parse(result)).toEqual({
      kind: 'quote',
      service: 'Визитки',
      quantity: 200,
      unitPrice: 4.5,
      total: 900,
      currency: 'RUB',
      appliedOptions: [],
      note: 'Предварительная цена, менеджер подтвердит итоговую.',
    })
  })

  it('passes needs_manager through for off-catalog services', async () => {
    const result = await priceQuoteTool.execute({ service: 'Кружки', quantity: 50 }, makeCtx())
    expect(JSON.parse(result)).toEqual({
      kind: 'needs_manager',
      reason: 'Услуга «Кружки» не найдена в каталоге',
    })
  })

  it('accepts the contract argument shape through dispatchToolCall', async () => {
    const result = await dispatchToolCall(
      {
        id: 'call_1',
        name: 'get_price_quote',
        arguments: JSON.stringify({ service: 'визитка', quantity: 100, options: [] }),
      },
      [priceQuoteTool],
      makeCtx(),
    )
    expect(JSON.parse(result).kind).toBe('quote')
  })
})
