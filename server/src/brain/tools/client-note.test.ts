import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../../db/test-utils.js'
import { chats, clients } from '../../db/schema.js'
import { createLogger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import type { ToolContext } from './registry.js'
import { clientNoteTool } from './client-note.js'

const db = getTestDb()

class FakeNotifier implements ManagerNotifier {
  orderCards: number[] = []
  escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> { this.orderCards.push(orderId) }
  async escalationCard(escalationId: number): Promise<void> { this.escalationCards.push(escalationId) }
}

function makeCtx(chatId: number, clientId: number | null): ToolContext {
  return { db, chatId, clientId, notifier: new FakeNotifier(), filesDir: './data/files', log: createLogger('test') }
}

describe('clientNoteTool', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('is registered under the contract name save_client_note', () => {
    expect(clientNoteTool.name).toBe('save_client_note')
  })

  it('appends newline-separated note lines to the existing client profile', async () => {
    const insertedClient = await db.insert(clients).values({ name: 'Иван' }).returning({ id: clients.id })
    const clientId = insertedClient[0]!.id
    const insertedChat = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '100', clientId })
      .returning({ id: chats.id })
    const chatId = insertedChat[0]!.id

    const first = await clientNoteTool.execute({ note: 'Предпочитает матовую ламинацию' }, makeCtx(chatId, clientId))
    const second = await clientNoteTool.execute({ note: 'Компания «Ромашка»' }, makeCtx(chatId, clientId))

    expect(JSON.parse(first)).toEqual({ ok: true })
    expect(JSON.parse(second)).toEqual({ ok: true })
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId))
    expect(client!.notes).toBe('Предпочитает матовую ламинацию\nКомпания «Ромашка»')
  })

  it('creates a client and links the chat when the chat has none', async () => {
    const insertedChat = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '100' })
      .returning({ id: chats.id })
    const chatId = insertedChat[0]!.id

    const raw = await clientNoteTool.execute({ note: 'Зовут Анна' }, makeCtx(chatId, null))

    expect(JSON.parse(raw)).toEqual({ ok: true })
    const allClients = await db.select().from(clients)
    expect(allClients).toHaveLength(1)
    expect(allClients[0]!.notes).toBe('Зовут Анна')
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
    expect(chat!.clientId).toBe(allClients[0]!.id)
  })

  it('rejects a blank note without creating anything', async () => {
    const insertedChat = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '100' })
      .returning({ id: chats.id })
    const chatId = insertedChat[0]!.id

    const raw = await clientNoteTool.execute({ note: '   ' }, makeCtx(chatId, null))

    expect(JSON.parse(raw)).toEqual({ error: 'note is empty' })
    expect(await db.select().from(clients)).toHaveLength(0)
  })
})
