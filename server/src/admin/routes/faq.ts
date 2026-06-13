import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import { faqChunks } from '../../db/schema.js'
import { deleteFaqChunk, upsertFaqChunk } from '../../knowledge/faq.js'

export interface FaqRouteDeps {
  db: Db
}

export function registerFaqRoutes(app: FastifyInstance, deps: FaqRouteDeps): void {
  const { db } = deps

  // GET /api/faq — list (no embedding column).
  app.get('/api/faq', async () => {
    return db
      .select({
        id: faqChunks.id,
        title: faqChunks.title,
        content: faqChunks.content,
        updatedAt: faqChunks.updatedAt,
      })
      .from(faqChunks)
      .orderBy(faqChunks.id)
  })

  // POST /api/faq { title, content } — create + embed.
  app.post<{ Body: { title?: string; content?: string } }>('/api/faq', async (req, reply) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (title === '' || content === '') return reply.code(400).send({ error: 'title and content are required' })
    const id = await upsertFaqChunk(db, { title, content })
    return reply.code(201).send({ id, title, content })
  })

  // PUT /api/faq/:id { title, content } — update + re-embed.
  app.put<{ Params: { id: string }; Body: { title?: string; content?: string } }>('/api/faq/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (title === '' || content === '') return reply.code(400).send({ error: 'title and content are required' })
    try {
      await upsertFaqChunk(db, { id, title, content })
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.code(404).send({ error: 'faq chunk not found' })
      }
      throw err
    }
    return { id, title, content }
  })

  // DELETE /api/faq/:id
  app.delete<{ Params: { id: string } }>('/api/faq/:id', async (req) => {
    await deleteFaqChunk(db, Number(req.params.id))
    return { ok: true }
  })
}
