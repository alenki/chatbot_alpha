import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import { chats, clients, messages } from '../../db/schema.js'
import type { Channel, ChannelAdapter } from '../../channels/types.js'
import type { Logger } from '../../log.js'

export interface ChatsRouteDeps {
  db: Db
  adapters: Map<Channel, ChannelAdapter>
  log: Logger
}

export function registerChatsRoutes(app: FastifyInstance, deps: ChatsRouteDeps): void {
  const { db } = deps

  // GET /api/chats?status= — list with client name, last message preview, unanswered flag.
  app.get<{ Querystring: { status?: string } }>('/api/chats', async (req) => {
    const status = req.query.status
    const where = status !== undefined && status !== '' ? eq(chats.status, status) : undefined
    const rows = await db
      .select({
        id: chats.id,
        channel: chats.channel,
        externalChatId: chats.externalChatId,
        status: chats.status,
        botPaused: chats.botPaused,
        createdAt: chats.createdAt,
        clientName: clients.name,
      })
      .from(chats)
      .leftJoin(clients, eq(chats.clientId, clients.id))
      .where(where)
      .orderBy(desc(chats.createdAt))

    const result = []
    for (const chat of rows) {
      const [last] = await db
        .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.chatId, chat.id))
        .orderBy(desc(messages.createdAt))
        .limit(1)
      const lastPreview = last !== undefined ? last.content.slice(0, 120) : ''
      const unanswered = last !== undefined && last.role === 'client' && chat.botPaused
      result.push({
        id: chat.id,
        channel: chat.channel,
        externalChatId: chat.externalChatId,
        status: chat.status,
        botPaused: chat.botPaused,
        clientName: chat.clientName ?? null,
        lastPreview,
        unanswered,
        createdAt: chat.createdAt,
      })
    }
    return result
  })

  // GET /api/chats/:id/messages — full thread.
  app.get<{ Params: { id: string } }>('/api/chats/:id/messages', async (req) => {
    const chatId = Number(req.params.id)
    return db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        attachments: messages.attachments,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.createdAt)
  })

  // POST /api/chats/:id/reply { text } — persist manager msg, pause bot, hand to human, send via adapter.
  app.post<{ Params: { id: string }; Body: { text?: string } }>('/api/chats/:id/reply', async (req, reply) => {
    const chatId = Number(req.params.id)
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (text === '') return reply.code(400).send({ error: 'text is required' })
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
    if (chat === undefined) return reply.code(404).send({ error: 'chat not found' })

    await db.insert(messages).values({ chatId, role: 'manager', content: text })
    await db.update(chats).set({ botPaused: true, status: 'human' }).where(eq(chats.id, chatId))

    const adapter = deps.adapters.get(chat.channel as Channel)
    if (adapter !== undefined) {
      try {
        await adapter.send({ channel: chat.channel as Channel, externalChatId: chat.externalChatId, text })
      } catch (err) {
        deps.log.error({ err, chatId }, 'manager reply send failed')
      }
    }
    return { ok: true }
  })

  // POST /api/chats/:id/bot { paused } — toggle pause; resuming (paused=false) also resets status to 'ai'.
  app.post<{ Params: { id: string }; Body: { paused?: boolean } }>('/api/chats/:id/bot', async (req, reply) => {
    const chatId = Number(req.params.id)
    const paused = req.body?.paused
    if (typeof paused !== 'boolean') return reply.code(400).send({ error: 'paused must be a boolean' })
    const set = paused ? { botPaused: true } : { botPaused: false, status: 'ai' }
    const updated = await db.update(chats).set(set).where(eq(chats.id, chatId)).returning({ id: chats.id })
    if (updated.length === 0) return reply.code(404).send({ error: 'chat not found' })
    return { ok: true }
  })
}
