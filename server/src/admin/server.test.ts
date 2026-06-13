import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { chats, clients, faqChunks, messages, orders, settings } from '../db/schema.js'
import type { Channel, ChannelAdapter, InboundMessage, OutboundMessage } from '../channels/types.js'
import { createLogger } from '../log.js'
import { DEFAULT_SYSTEM_PROMPT } from '../brain/prompt.js'
import { DEFAULT_ESCALATION_KEYWORDS } from '../engine/escalation.js'
import { buildAdminServer } from './server.js'

// Mock the FAQ module: routes call upsert/delete, the test asserts on those calls
// and writes the row itself so GET /api/faq has data — no embedding model loads.
vi.mock('../knowledge/faq.js', () => ({
  upsertFaqChunk: vi.fn(async (db: ReturnType<typeof getTestDb>, c: { id?: number; title: string; content: string }) => {
    if (c.id !== undefined) {
      await db.update(faqChunks).set({ title: c.title, content: c.content }).where(eq(faqChunks.id, c.id))
      return c.id
    }
    const inserted = await db.insert(faqChunks).values({ title: c.title, content: c.content }).returning({ id: faqChunks.id })
    return inserted[0]!.id
  }),
  deleteFaqChunk: vi.fn(async (db: ReturnType<typeof getTestDb>, id: number) => {
    await db.delete(faqChunks).where(eq(faqChunks.id, id))
  }),
}))

import { upsertFaqChunk } from '../knowledge/faq.js'

const db = getTestDb()
const PASSWORD = 'super-secret-password'
const SECRET = 'a-session-secret-of-32-characters'

class FakeAdapter implements ChannelAdapter {
  readonly channel: Channel = 'telegram'
  sent: OutboundMessage[] = []
  async start(_onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {}
  async stop(): Promise<void> {}
  async send(msg: OutboundMessage): Promise<void> {
    this.sent.push(msg)
  }
  async sendTyping(_externalChatId: string): Promise<void> {}
}

function makeConfig(nodeEnv: 'development' | 'production' | 'test' = 'test') {
  return {
    DATABASE_URL: 'postgres://x',
    TELEGRAM_BOT_TOKEN: 't',
    MANAGER_GROUP_CHAT_ID: '-100',
    LLM_PRIMARY_BASE_URL: 'https://openrouter.ai/api/v1',
    LLM_PRIMARY_API_KEY: 'k',
    LLM_PRIMARY_MODEL: 'deepseek/deepseek-chat:free',
    ADMIN_PORT: 8080,
    ADMIN_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    ADMIN_BASE_URL: 'http://localhost:8080',
    FILES_DIR: './data/files',
    NODE_ENV: nodeEnv,
  } as Parameters<typeof buildAdminServer>[0]['config']
}

let app: FastifyInstance
let adapter: FakeAdapter
let cookie: string

async function build(nodeEnv: 'development' | 'production' | 'test' = 'test') {
  adapter = new FakeAdapter()
  app = await buildAdminServer({
    db,
    config: makeConfig(nodeEnv),
    engine: { adapters: new Map<Channel, ChannelAdapter>([['telegram', adapter]]) },
    log: createLogger('test'),
  })
  await app.ready()
}

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: PASSWORD } })
  return String(res.headers['set-cookie']).split(';')[0]!
}

async function seedChatWithClient(name = 'Иван Петров') {
  const [client] = await db.insert(clients).values({ name }).returning()
  const [chat] = await db
    .insert(chats)
    .values({ channel: 'telegram', externalChatId: '555001', clientId: client!.id })
    .returning()
  return { chat: chat!, client: client! }
}

beforeEach(async () => {
  await resetDb()
  vi.mocked(upsertFaqChunk).mockClear()
  await build()
  cookie = await login()
})

afterAll(async () => {
  if (app !== undefined) await app.close()
})

describe('admin server — auth gate', () => {
  it('rejects an API call without a cookie (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chats' })
    expect(res.statusCode).toBe(401)
  })

  it('accepts an API call with the login cookie (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

describe('admin server — chats', () => {
  it('GET /api/chats returns the unanswered flag for a paused chat whose last message is from the client', async () => {
    const { chat } = await seedChatWithClient()
    await db.update(chats).set({ botPaused: true, status: 'human' }).where(eq(chats.id, chat.id))
    await db.insert(messages).values({ chatId: chat.id, role: 'client', content: 'Когда будет готово?' })

    const res = await app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const list = res.json() as { id: number; clientName: string; lastPreview: string; unanswered: boolean }[]
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: chat.id,
      clientName: 'Иван Петров',
      lastPreview: 'Когда будет готово?',
      unanswered: true,
    })
  })

  it('unanswered is false when the bot already answered (last message role=ai)', async () => {
    const { chat } = await seedChatWithClient()
    await db.insert(messages).values({ chatId: chat.id, role: 'client', content: 'Привет' })
    await db.insert(messages).values({ chatId: chat.id, role: 'ai', content: 'Здравствуйте!' })

    const res = await app.inject({ method: 'GET', url: '/api/chats', headers: { cookie } })
    const list = res.json() as { unanswered: boolean; lastPreview: string }[]
    expect(list[0]!.unanswered).toBe(false)
    expect(list[0]!.lastPreview).toBe('Здравствуйте!')
  })

  it('GET /api/chats?status= filters by status', async () => {
    const { chat } = await seedChatWithClient()
    await db.update(chats).set({ status: 'human' }).where(eq(chats.id, chat.id))
    const aiRes = await app.inject({ method: 'GET', url: '/api/chats?status=ai', headers: { cookie } })
    expect(aiRes.json()).toHaveLength(0)
    const humanRes = await app.inject({ method: 'GET', url: '/api/chats?status=human', headers: { cookie } })
    expect(humanRes.json()).toHaveLength(1)
  })

  it('GET /api/chats/:id/messages returns the full thread in order', async () => {
    const { chat } = await seedChatWithClient()
    await db.insert(messages).values({ chatId: chat.id, role: 'client', content: 'Первое' })
    await db.insert(messages).values({ chatId: chat.id, role: 'ai', content: 'Второе' })

    const res = await app.inject({ method: 'GET', url: `/api/chats/${chat.id}/messages`, headers: { cookie } })
    const thread = res.json() as { role: string; content: string }[]
    expect(thread.map((m) => m.content)).toEqual(['Первое', 'Второе'])
  })

  it('POST /api/chats/:id/reply persists a manager message, pauses the bot and sends via the adapter', async () => {
    const { chat } = await seedChatWithClient()

    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${chat.id}/reply`,
      headers: { cookie },
      payload: { text: 'Здравствуйте, уточню по цене и вернусь.' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const msgs = await db.select().from(messages).where(eq(messages.chatId, chat.id))
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'manager', content: 'Здравствуйте, уточню по цене и вернусь.' })
    const [updated] = await db.select().from(chats).where(eq(chats.id, chat.id))
    expect(updated!.botPaused).toBe(true)
    expect(updated!.status).toBe('human')
    expect(adapter.sent).toEqual([
      { channel: 'telegram', externalChatId: '555001', text: 'Здравствуйте, уточню по цене и вернусь.' },
    ])
  })

  it('POST /api/chats/:id/bot { paused:false } resumes and resets status to ai', async () => {
    const { chat } = await seedChatWithClient()
    await db.update(chats).set({ botPaused: true, status: 'human' }).where(eq(chats.id, chat.id))

    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${chat.id}/bot`,
      headers: { cookie },
      payload: { paused: false },
    })
    expect(res.statusCode).toBe(200)
    const [updated] = await db.select().from(chats).where(eq(chats.id, chat.id))
    expect(updated!.botPaused).toBe(false)
    expect(updated!.status).toBe('ai')
  })

  it('POST /api/chats/:id/bot { paused:true } pauses without touching status', async () => {
    const { chat } = await seedChatWithClient()
    const res = await app.inject({
      method: 'POST',
      url: `/api/chats/${chat.id}/bot`,
      headers: { cookie },
      payload: { paused: true },
    })
    expect(res.statusCode).toBe(200)
    const [updated] = await db.select().from(chats).where(eq(chats.id, chat.id))
    expect(updated!.botPaused).toBe(true)
    expect(updated!.status).toBe('ai') // unchanged
  })
})

describe('admin server — orders', () => {
  async function seedOrder(status = 'new') {
    const { chat } = await seedChatWithClient()
    const [order] = await db
      .insert(orders)
      .values({ chatId: chat.id, serviceType: 'Визитки', specs: { Бумага: '300г' }, quantity: 500, contact: '+7 999' , status })
      .returning()
    return order!
  }

  it('GET /api/orders returns the board', async () => {
    await seedOrder()
    const res = await app.inject({ method: 'GET', url: '/api/orders', headers: { cookie } })
    const board = res.json() as { serviceType: string; status: string }[]
    expect(board).toHaveLength(1)
    expect(board[0]).toMatchObject({ serviceType: 'Визитки', status: 'new' })
  })

  it('PATCH /api/orders/:id advances the status', async () => {
    const order = await seedOrder('new')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${order.id}`,
      headers: { cookie },
      payload: { status: 'confirmed' },
    })
    expect(res.statusCode).toBe(200)
    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated!.status).toBe('confirmed')
  })

  it('PATCH /api/orders/:id rejects an unknown status (400)', async () => {
    const order = await seedOrder('new')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${order.id}`,
      headers: { cookie },
      payload: { status: 'shipped' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('admin server — catalog', () => {
  async function createService() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/catalog/services',
      headers: { cookie },
      payload: { name: 'Визитки', aliases: ['визитка', 'business cards'], unit: 'шт' },
    })
    return res.json() as { id: number; name: string; aliases: string[] }
  }

  it('services: create round-trips the aliases array, then list/update/delete work', async () => {
    const created = await createService()
    expect(created.aliases).toEqual(['визитка', 'business cards'])

    const list = await app.inject({ method: 'GET', url: '/api/catalog/services', headers: { cookie } })
    expect((list.json() as unknown[]).length).toBe(1)

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/catalog/services/${created.id}`,
      headers: { cookie },
      payload: { aliases: ['визитка', 'карточка'], active: false },
    })
    const u = updated.json() as { aliases: string[]; active: boolean }
    expect(u.aliases).toEqual(['визитка', 'карточка'])
    expect(u.active).toBe(false)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/catalog/services/${created.id}`,
      headers: { cookie },
    })
    expect(del.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: '/api/catalog/services', headers: { cookie } })
    expect((after.json() as unknown[]).length).toBe(0)
  })

  it('options: create scoped to a service, list filtered by serviceId', async () => {
    const service = await createService()
    const created = await app.inject({
      method: 'POST',
      url: '/api/catalog/options',
      headers: { cookie },
      payload: { serviceId: service.id, optionGroup: 'finishing', name: 'Ламинация матовая', priceDelta: '1.50' },
    })
    expect(created.statusCode).toBe(201)
    const got = created.json() as { id: number; name: string; priceDelta: string }
    expect(got.name).toBe('Ламинация матовая')
    expect(got.priceDelta).toBe('1.50')

    const list = await app.inject({
      method: 'GET',
      url: `/api/catalog/options?serviceId=${service.id}`,
      headers: { cookie },
    })
    expect((list.json() as unknown[]).length).toBe(1)
  })

  it('tiers: create scoped to a service, list filtered by serviceId', async () => {
    const service = await createService()
    const created = await app.inject({
      method: 'POST',
      url: '/api/catalog/tiers',
      headers: { cookie },
      payload: { serviceId: service.id, minQty: 100, unitPrice: '3.20' },
    })
    expect(created.statusCode).toBe(201)
    const list = await app.inject({
      method: 'GET',
      url: `/api/catalog/tiers?serviceId=${service.id}`,
      headers: { cookie },
    })
    const tiers = list.json() as { minQty: number; unitPrice: string }[]
    expect(tiers).toEqual([{ ...tiers[0], minQty: 100, unitPrice: '3.20' }])
  })
})

describe('admin server — faq', () => {
  it('POST /api/faq calls upsertFaqChunk (re-embed) and GET lists it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/faq',
      headers: { cookie },
      payload: { title: 'Доставка', content: 'По городу 1-2 дня.' },
    })
    expect(res.statusCode).toBe(201)
    expect(upsertFaqChunk).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsertFaqChunk).mock.calls[0]![1]).toEqual({ title: 'Доставка', content: 'По городу 1-2 дня.' })

    const list = await app.inject({ method: 'GET', url: '/api/faq', headers: { cookie } })
    const items = list.json() as { title: string }[]
    expect(items.map((i) => i.title)).toEqual(['Доставка'])
  })

  it('PUT /api/faq/:id re-embeds via upsertFaqChunk with the id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/faq',
      headers: { cookie },
      payload: { title: 'Доставка', content: 'По городу.' },
    })
    const id = (created.json() as { id: number }).id
    vi.mocked(upsertFaqChunk).mockClear()

    const res = await app.inject({
      method: 'PUT',
      url: `/api/faq/${id}`,
      headers: { cookie },
      payload: { title: 'Доставка', content: 'По городу 1-2 дня, 300 ₽.' },
    })
    expect(res.statusCode).toBe(200)
    expect(upsertFaqChunk).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsertFaqChunk).mock.calls[0]![1]).toEqual({
      id,
      title: 'Доставка',
      content: 'По городу 1-2 дня, 300 ₽.',
    })
    const [row] = await db.select().from(faqChunks).where(eq(faqChunks.id, id))
    expect(row!.content).toBe('По городу 1-2 дня, 300 ₽.')
  })

  it('DELETE /api/faq/:id removes the chunk', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/faq',
      headers: { cookie },
      payload: { title: 'Доставка', content: 'По городу.' },
    })
    const id = (created.json() as { id: number }).id
    const del = await app.inject({ method: 'DELETE', url: `/api/faq/${id}`, headers: { cookie } })
    expect(del.statusCode).toBe(200)
    expect(await db.select().from(faqChunks)).toHaveLength(0)
  })
})

describe('admin server — settings', () => {
  it('GET /api/settings returns defaults when no rows exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })
    expect(res.json()).toEqual({
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      escalation_keywords: DEFAULT_ESCALATION_KEYWORDS,
      daily_turn_cap: 30,
    })
  })

  it('PUT /api/settings upserts, and a subsequent GET returns the stored values', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { system_prompt: 'Новый промпт', escalation_keywords: ['жалоба'], daily_turn_cap: 50 },
    })
    expect(put.statusCode).toBe(200)
    const stored = await db.select().from(settings)
    expect(stored).toHaveLength(3)

    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })
    expect(get.json()).toEqual({
      system_prompt: 'Новый промпт',
      escalation_keywords: ['жалоба'],
      daily_turn_cap: 50,
    })
  })
})

describe('admin server — usage', () => {
  it('GET /api/usage returns per-day rows with role counts, tokens and escalations', async () => {
    const { chat } = await seedChatWithClient()
    await db.insert(messages).values({ chatId: chat.id, role: 'client', content: 'Вопрос' })
    await db.insert(messages).values({
      chatId: chat.id,
      role: 'ai',
      content: 'Ответ',
      promptTokens: 100,
      completionTokens: 30,
    })
    const { escalations: escTable } = await import('../db/schema.js')
    await db.insert(escTable).values({ chatId: chat.id, reason: 'тест' })

    const res = await app.inject({ method: 'GET', url: '/api/usage?days=30', headers: { cookie } })
    const rows = res.json() as {
      day: string
      clientMessages: number
      aiMessages: number
      promptTokens: number
      completionTokens: number
      escalations: number
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      clientMessages: 1,
      aiMessages: 1,
      promptTokens: 100,
      completionTokens: 30,
      escalations: 1,
    })
  })
})
