import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { faqChunks } from '../db/schema.js'
import { embed } from './embeddings.js'
import { deleteFaqChunk, searchFaq, upsertFaqChunk } from './faq.js'

vi.mock('./embeddings.js', () => ({
  embed: vi.fn(async (texts: string[], _kind: 'query' | 'passage') =>
    texts.map((text) => {
      // Deterministic unit vectors keyed off keywords:
      //   'доставк' → e0; 'срок' → (e0+e1)/√2; 'макет' → e1; anything else → e5.
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

describe('faq', () => {
  beforeEach(async () => {
    await resetDb()
    vi.mocked(embed).mockClear()
  })

  it('upsertFaqChunk inserts a new chunk embedding title + content as a passage', async () => {
    const id = await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    expect(id).toBeGreaterThan(0)
    expect(embed).toHaveBeenCalledWith(['Доставка\nПо городу 1-2 дня.'], 'passage')
    const [row] = await db.select().from(faqChunks).where(eq(faqChunks.id, id))
    expect(row!.title).toBe('Доставка')
    expect(row!.content).toBe('По городу 1-2 дня.')
    expect(row!.embedding).toHaveLength(384)
    expect(row!.embedding![0]).toBe(1)
  })

  it('upsertFaqChunk with id updates the row in place and re-embeds', async () => {
    const id = await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    const sameId = await upsertFaqChunk(db, { id, title: 'Макеты', content: 'Принимаем PDF и CDR.' })
    expect(sameId).toBe(id)
    const rows = await db.select().from(faqChunks)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe('Макеты')
    expect(rows[0]!.embedding![0]).toBe(0) // re-embedded: no longer the доставка axis
    expect(rows[0]!.embedding![1]).toBe(1)
  })

  it('upsertFaqChunk rejects when the given id does not exist', async () => {
    await expect(upsertFaqChunk(db, { id: 9999, title: 'Доставка', content: 'x' })).rejects.toThrow('not found')
  })

  it('deleteFaqChunk removes the row', async () => {
    const id = await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    await deleteFaqChunk(db, id)
    expect(await db.select().from(faqChunks)).toHaveLength(0)
  })

  it('searchFaq embeds the query with the query kind', async () => {
    await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    await searchFaq(db, 'сколько идёт доставка')
    expect(embed).toHaveBeenLastCalledWith(['сколько идёт доставка'], 'query')
  })

  it('searchFaq orders results by cosine distance to the query', async () => {
    await upsertFaqChunk(db, { title: 'Макеты', content: 'Принимаем PDF и CDR.' })
    await upsertFaqChunk(db, { title: 'Сроки', content: 'Печать занимает 2-3 дня.' })
    await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    const results = await searchFaq(db, 'сколько идёт доставка')
    // distances: Доставка 0 < Сроки ~0.293 < Макеты 1
    expect(results.map((r) => r.title)).toEqual(['Доставка', 'Сроки', 'Макеты'])
    expect(results[0]).toEqual({ title: 'Доставка', content: 'По городу 1-2 дня.' })
  })

  it('searchFaq respects the limit', async () => {
    await upsertFaqChunk(db, { title: 'Макеты', content: 'Принимаем PDF и CDR.' })
    await upsertFaqChunk(db, { title: 'Сроки', content: 'Печать занимает 2-3 дня.' })
    await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    const results = await searchFaq(db, 'сколько идёт доставка', 2)
    expect(results.map((r) => r.title)).toEqual(['Доставка', 'Сроки'])
  })

  it('searchFaq excludes rows without an embedding', async () => {
    // Row inserted outside upsertFaqChunk (e.g. legacy/import) has embedding NULL.
    await db.insert(faqChunks).values({ title: 'Без вектора', content: 'Старая запись.' })
    await upsertFaqChunk(db, { title: 'Доставка', content: 'По городу 1-2 дня.' })
    const results = await searchFaq(db, 'сколько идёт доставка', 10)
    expect(results.map((r) => r.title)).toEqual(['Доставка'])
  })
})
