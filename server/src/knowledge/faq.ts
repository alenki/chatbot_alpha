import { eq, isNotNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { faqChunks } from '../db/schema.js'
import { embed } from './embeddings.js'

/** Insert (no id) or update (with id) a FAQ chunk, re-embedding on every write. Returns the row id. */
export async function upsertFaqChunk(db: Db, c: { id?: number; title: string; content: string }): Promise<number> {
  const vectors = await embed([`${c.title}\n${c.content}`], 'passage')
  const embedding = vectors[0]!
  if (c.id !== undefined) {
    const updated = await db
      .update(faqChunks)
      .set({ title: c.title, content: c.content, embedding, updatedAt: new Date() })
      .where(eq(faqChunks.id, c.id))
      .returning({ id: faqChunks.id })
    if (updated.length === 0) {
      throw new Error(`faq chunk ${c.id} not found`)
    }
    return updated[0]!.id
  }
  const inserted = await db
    .insert(faqChunks)
    .values({ title: c.title, content: c.content, embedding })
    .returning({ id: faqChunks.id })
  return inserted[0]!.id
}

export async function deleteFaqChunk(db: Db, id: number): Promise<void> {
  await db.delete(faqChunks).where(eq(faqChunks.id, id))
}

/** Top-`limit` chunks by pgvector cosine distance (`<=>`) to the embedded query; un-embedded rows excluded. */
export async function searchFaq(db: Db, query: string, limit = 3): Promise<{ title: string; content: string }[]> {
  const vectors = await embed([query], 'query')
  const param = JSON.stringify(vectors[0]!) // pgvector accepts the '[0.1,0.2,...]' literal form
  return db
    .select({ title: faqChunks.title, content: faqChunks.content })
    .from(faqChunks)
    .where(isNotNull(faqChunks.embedding))
    .orderBy(sql`${faqChunks.embedding} <=> ${param}::vector`)
    .limit(limit)
}
