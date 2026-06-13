import { beforeEach, describe, expect, it } from 'vitest'
import { chats } from './schema.js'
import { getTestDb, resetDb } from './test-utils.js'

describe('db schema smoke test', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('inserts and reads back a chat row with column defaults applied', async () => {
    const db = getTestDb()

    const inserted = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '12345' })
      .returning()

    expect(inserted).toHaveLength(1)
    const chat = inserted[0]!
    expect(chat.id).toBe(1) // RESTART IDENTITY in resetDb() makes ids deterministic
    expect(chat.channel).toBe('telegram')
    expect(chat.externalChatId).toBe('12345')
    expect(chat.botPaused).toBe(false)
    expect(chat.status).toBe('ai')
    expect(chat.summary).toBe('')
    expect(chat.aiTurnsToday).toBe(0)
    expect(chat.aiTurnsDate).toBeNull()
    expect(chat.clientId).toBeNull()
    expect(chat.createdAt).toBeInstanceOf(Date)

    const rows = await db.select().from(chats)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.externalChatId).toBe('12345')
  })

  it('resetDb truncates all tables and restarts identities', async () => {
    const db = getTestDb()
    await db.insert(chats).values({ channel: 'telegram', externalChatId: 'aaa' })

    await resetDb()

    const rows = await db.select().from(chats)
    expect(rows).toHaveLength(0)

    const reinserted = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: 'bbb' })
      .returning()
    expect(reinserted[0]!.id).toBe(1) // identity restarted
  })
})
