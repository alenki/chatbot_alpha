import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestDb, resetDb } from '../../db/test-utils.js'
import { upsertFaqChunk } from '../../knowledge/faq.js'
import { createLogger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import type { ToolContext } from './registry.js'
import { knowledgeTool } from './knowledge.js'

vi.mock('../../knowledge/embeddings.js', () => ({
  embed: vi.fn(async (texts: string[], _kind: 'query' | 'passage') =>
    texts.map((text) => {
      // Deterministic unit vectors: 'доставк' → e0; 'срок' → (e0+e1)/√2; 'макет' → e1; else → e5.
      // Cosine distance from a 'доставка' query: Доставка 0 < Сроки ≈0.293 < Макеты 1.
      const v: number[] = new Array(384).fill(0)
      const t = text.toLowerCase()
      if (t.includes('доставк')) v[0] = 1
      else if (t.includes('срок')) {
        v[0] = Math.SQRT1_2
        v[1] = Math.SQRT1_2
      } else if (t.includes('макет')) v[1] = 1
      else v[5] = 1
      return v
    }),
  ),
}))

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

describe('knowledgeTool', () => {
  beforeEach(async () => {
    await resetDb()
    await upsertFaqChunk(db, { title: 'Макеты', content: 'Принимаем PDF и CDR.' })
    await upsertFaqChunk(db, { title: 'Сроки', content: 'Печать занимает 2-3 дня.' })
    await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня, 300 ₽.' })
    await upsertFaqChunk(db, { title: 'Оплата', content: 'Счёт для юрлиц, перевод для физлиц.' })
  })

  it('is registered under the contract name search_knowledge', () => {
    expect(knowledgeTool.name).toBe('search_knowledge')
  })

  it('returns the top-3 FAQ chunks by relevance as { results }', async () => {
    const raw = await knowledgeTool.execute({ query: 'сколько идёт доставка' }, makeCtx())
    const parsed = JSON.parse(raw) as { results: { title: string; content: string }[] }

    expect(parsed.results).toHaveLength(3) // 4 chunks seeded, limit is 3
    expect(parsed.results[0]).toEqual({ title: 'Доставка', content: 'По городу 1-2 дня, 300 ₽.' })
    expect(parsed.results[1]).toEqual({ title: 'Сроки', content: 'Печать занимает 2-3 дня.' })
    // Макеты and Оплата tie at distance 1 — third place is either of them.
    expect(['Макеты', 'Оплата']).toContain(parsed.results[2]!.title)
  })

  it('returns an empty results list when the FAQ table is empty', async () => {
    await resetDb()
    const raw = await knowledgeTool.execute({ query: 'доставка' }, makeCtx())
    expect(JSON.parse(raw)).toEqual({ results: [] })
  })
})
