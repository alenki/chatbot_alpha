import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../../db/test-utils.js'
import { chats, escalations } from '../../db/schema.js'
import { createLogger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import type { ToolContext } from './registry.js'
import { escalateTool } from './escalate.js'

const db = getTestDb()

class FakeNotifier implements ManagerNotifier {
  orderCards: number[] = []
  escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> { this.orderCards.push(orderId) }
  async escalationCard(escalationId: number): Promise<void> { this.escalationCards.push(escalationId) }
}

function makeCtx(chatId: number, notifier: ManagerNotifier): ToolContext {
  return { db, chatId, clientId: null, notifier, filesDir: './data/files', log: createLogger('test') }
}

const args = { reason: 'Клиент недоволен сроками', summary: 'Просит 100 визиток к завтрашнему утру, раздражён.' }

describe('escalateTool', () => {
  let chatId: number
  let notifier: FakeNotifier

  beforeEach(async () => {
    await resetDb()
    const rows = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '100' })
      .returning({ id: chats.id })
    chatId = rows[0]!.id
    notifier = new FakeNotifier()
  })

  it('is registered under the contract name escalate_to_human', () => {
    expect(escalateTool.name).toBe('escalate_to_human')
  })

  it('pauses the bot and hands the chat to a human', async () => {
    const raw = await escalateTool.execute(args, makeCtx(chatId, notifier))

    expect(JSON.parse(raw)).toEqual({ ok: true })
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
    expect(chat!.botPaused).toBe(true)
    expect(chat!.status).toBe('human')
  })

  it('records the escalation and sends the manager card with its id', async () => {
    await escalateTool.execute(args, makeCtx(chatId, notifier))

    const rows = await db.select().from(escalations)
    expect(rows).toHaveLength(1)
    expect(rows[0]!).toMatchObject({
      chatId,
      reason: 'Клиент недоволен сроками',
      summary: 'Просит 100 визиток к завтрашнему утру, раздражён.',
      resolvedBy: null,
      resolvedAt: null,
    })
    expect(notifier.escalationCards).toEqual([rows[0]!.id])
  })
})
