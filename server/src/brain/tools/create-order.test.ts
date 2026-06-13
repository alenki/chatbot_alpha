import { beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb } from '../../db/test-utils.js'
import { chats, clients, messages, orders } from '../../db/schema.js'
import { createLogger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import type { ToolContext } from './registry.js'
import { createOrderTool } from './create-order.js'

const db = getTestDb()

class FakeNotifier implements ManagerNotifier {
  orderCards: number[] = []
  escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> { this.orderCards.push(orderId) }
  async escalationCard(escalationId: number): Promise<void> { this.escalationCards.push(escalationId) }
}

function makeCtx(chatId: number, clientId: number | null, notifier: ManagerNotifier): ToolContext {
  return { db, chatId, clientId, notifier, filesDir: './data/files', log: createLogger('test') }
}

async function seedChat(externalChatId: string): Promise<number> {
  const rows = await db
    .insert(chats)
    .values({ channel: 'telegram', externalChatId })
    .returning({ id: chats.id })
  return rows[0]!.id
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000)

const newFile = { path: '/data/files/telegram/b/maket.pdf', name: 'maket.pdf', mime: 'application/pdf', size: 2048 }
const oldFile = { path: '/data/files/telegram/a/old.pdf', name: 'old.pdf', mime: 'application/pdf', size: 1024 }
const foreignFile = { path: '/data/files/telegram/c/other.pdf', name: 'other.pdf', mime: 'application/pdf', size: 512 }

const validArgs = {
  serviceType: 'Визитки',
  specs: { material: 'мелованная 300г', finishing: 'ламинация матовая' },
  quantity: 500,
  deadline: 'до пятницы',
  contact: '+7 900 000-00-00, Иван',
}

describe('createOrderTool', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('is registered under the contract name create_order', () => {
    expect(createOrderTool.name).toBe('create_order')
  })

  it('inserts the order, returns ok/orderId and fires the manager order card', async () => {
    const chatId = await seedChat('100')
    const notifier = new FakeNotifier()

    const raw = await createOrderTool.execute(validArgs, makeCtx(chatId, null, notifier))

    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ ok: true, orderId: 1 })
    const rows = await db.select().from(orders)
    expect(rows).toHaveLength(1)
    expect(rows[0]!).toMatchObject({
      chatId,
      clientId: null,
      serviceType: 'Визитки',
      specs: { material: 'мелованная 300г', finishing: 'ламинация матовая' },
      quantity: 500,
      deadline: 'до пятницы',
      contact: '+7 900 000-00-00, Иван',
      status: 'new',
    })
    expect(notifier.orderCards).toEqual([1])
  })

  it("attaches only this chat's file attachments from the last 24 hours", async () => {
    const chatId = await seedChat('100')
    const otherChatId = await seedChat('200')
    await db.insert(messages).values([
      { chatId, role: 'client', content: 'старый макет', attachments: [oldFile], createdAt: hoursAgo(30) },
      { chatId, role: 'client', content: 'вот макет', attachments: [newFile], createdAt: hoursAgo(1) },
      { chatId, role: 'client', content: 'и ещё текст без файла', attachments: [], createdAt: hoursAgo(0.1) },
      { chatId: otherChatId, role: 'client', content: 'чужой файл', attachments: [foreignFile], createdAt: hoursAgo(1) },
    ])

    await createOrderTool.execute(validArgs, makeCtx(chatId, null, new FakeNotifier()))

    const rows = await db.select().from(orders)
    expect(rows[0]!.files).toEqual([newFile]) // old (>24h) and foreign-chat files excluded
  })

  it('links the order to the chat client from ctx.clientId', async () => {
    const inserted = await db.insert(clients).values({ name: 'Иван' }).returning({ id: clients.id })
    const clientId = inserted[0]!.id
    const chatId = await seedChat('100')

    await createOrderTool.execute(validArgs, makeCtx(chatId, clientId, new FakeNotifier()))

    const rows = await db.select().from(orders)
    expect(rows[0]!.clientId).toBe(clientId)
  })

  it('rejects a blank contact without inserting anything or notifying', async () => {
    const chatId = await seedChat('100')
    const notifier = new FakeNotifier()

    const raw = await createOrderTool.execute(
      { ...validArgs, contact: '   ' },
      makeCtx(chatId, null, notifier),
    )

    expect(JSON.parse(raw)).toEqual({ error: 'contact is required' })
    expect(await db.select().from(orders)).toHaveLength(0)
    expect(notifier.orderCards).toEqual([])
  })

  it('rejects a blank serviceType without inserting anything', async () => {
    const chatId = await seedChat('100')

    const raw = await createOrderTool.execute(
      { ...validArgs, serviceType: '' },
      makeCtx(chatId, null, new FakeNotifier()),
    )

    expect(JSON.parse(raw)).toEqual({ error: 'serviceType is required' })
    expect(await db.select().from(orders)).toHaveLength(0)
  })
})
