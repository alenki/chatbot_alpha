import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chats, outbox } from '../db/schema.js'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { enqueueOutbound, OutboxWorker } from './outbox.js'
import type { Channel, ChannelAdapter, InboundMessage, OutboundMessage } from './types.js'

const db = getTestDb()

/** Records every successful send; throws for the first `failuresRemaining` send attempts. */
class FakeAdapter implements ChannelAdapter {
  readonly channel: Channel = 'telegram'
  sent: OutboundMessage[] = []
  failuresRemaining = 0

  async start(_onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {}
  async stop(): Promise<void> {}
  async sendTyping(_externalChatId: string): Promise<void> {}

  async send(msg: OutboundMessage): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1
      throw new Error('send failed (fake)')
    }
    this.sent.push(msg)
  }
}

function makeWorker(adapter: FakeAdapter, opts?: { pollMs?: number; maxAttempts?: number }): OutboxWorker {
  return new OutboxWorker(db, new Map<Channel, ChannelAdapter>([['telegram', adapter]]), opts)
}

async function createChat(): Promise<number> {
  const rows = await db
    .insert(chats)
    .values({ channel: 'telegram', externalChatId: '777000' })
    .returning({ id: chats.id })
  return rows[0]!.id
}

/** Forces every unsent row to be due immediately (skips waiting out a backoff). */
async function forceDue(): Promise<void> {
  await db.update(outbox).set({ nextAttemptAt: new Date(Date.now() - 1000) })
}

const msg: OutboundMessage = {
  channel: 'telegram',
  externalChatId: '777000',
  text: 'Здравствуйте! Чем можем помочь?',
}

beforeEach(async () => {
  await resetDb()
})

describe('enqueueOutbound', () => {
  it('inserts a pending outbox row', async () => {
    const chatId = await createChat()

    await enqueueOutbound(db, chatId, msg)

    const rows = await db.select().from(outbox)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.chatId).toBe(chatId)
    expect(row.payload).toEqual({
      channel: 'telegram',
      externalChatId: '777000',
      text: 'Здравствуйте! Чем можем помочь?',
    })
    expect(row.attempts).toBe(0)
    expect(row.nextAttemptAt).toBeInstanceOf(Date)
    expect(row.sentAt).toBeNull()
    expect(row.lastError).toBeNull()
  })
})

describe('OutboxWorker.processOnce', () => {
  it('sends due rows through the matching adapter and marks them sent', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, msg)
    const adapter = new FakeAdapter()
    const worker = makeWorker(adapter)

    const processed = await worker.processOnce()

    expect(processed).toBe(1)
    expect(adapter.sent).toEqual([msg])
    const rows = await db.select().from(outbox)
    expect(rows[0]!.sentAt).toBeInstanceOf(Date)
  })

  it('does not re-send rows already sent', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, msg)
    const adapter = new FakeAdapter()
    const worker = makeWorker(adapter)
    await worker.processOnce()

    const processed = await worker.processOnce()

    expect(processed).toBe(0)
    expect(adapter.sent).toHaveLength(1)
  })

  it('on failure increments attempts, records lastError, backs off 2^attempts * 5s', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, msg)
    const adapter = new FakeAdapter()
    adapter.failuresRemaining = 1
    const worker = makeWorker(adapter)
    const before = Date.now()

    const processed = await worker.processOnce()

    expect(processed).toBe(1)                            // a failed attempt still counts as processed
    expect(adapter.sent).toHaveLength(0)
    const row = (await db.select().from(outbox))[0]!
    expect(row.sentAt).toBeNull()
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBe('send failed (fake)')
    const delayMs = row.nextAttemptAt.getTime() - before
    expect(delayMs).toBeGreaterThanOrEqual(10_000)       // 2^1 * 5s after the first failure
    expect(delayMs).toBeLessThan(15_000)
  })

  it('skips rows whose nextAttemptAt is in the future', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, msg)
    const adapter = new FakeAdapter()
    adapter.failuresRemaining = 1
    const worker = makeWorker(adapter)
    await worker.processOnce()                           // fails -> backed off 10s into the future

    const processed = await worker.processOnce()         // immediately again

    expect(processed).toBe(0)
    expect(adapter.sent).toHaveLength(0)
  })

  it('retries a failed row once it is due again', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, msg)
    const adapter = new FakeAdapter()
    adapter.failuresRemaining = 1
    const worker = makeWorker(adapter)
    await worker.processOnce()                           // fails
    await forceDue()

    const processed = await worker.processOnce()

    expect(processed).toBe(1)
    expect(adapter.sent).toEqual([msg])
    const row = (await db.select().from(outbox))[0]!
    expect(row.sentAt).toBeInstanceOf(Date)
    expect(row.attempts).toBe(1)                         // attempt history preserved
  })

  it('permanently skips rows that exhausted maxAttempts (default 5)', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, msg)
    const adapter = new FakeAdapter()
    adapter.failuresRemaining = 100                      // would fail forever if asked
    const worker = makeWorker(adapter)
    for (let i = 0; i < 5; i += 1) {
      await worker.processOnce()                         // fail #1..#5
      await forceDue()
    }
    const failed = (await db.select().from(outbox))[0]!
    expect(failed.attempts).toBe(5)
    expect(failed.lastError).toBe('send failed (fake)')

    const processed = await worker.processOnce()         // row is due, but attempts are exhausted

    expect(processed).toBe(0)
    expect(adapter.sent).toHaveLength(0)
    const row = (await db.select().from(outbox))[0]!
    expect(row.sentAt).toBeNull()
    expect(row.attempts).toBe(5)
  })

  it('counts a missing adapter as a send failure', async () => {
    const chatId = await createChat()
    await enqueueOutbound(db, chatId, { channel: 'max', externalChatId: '1', text: 'привет' })
    const adapter = new FakeAdapter()                    // only handles 'telegram'
    const worker = makeWorker(adapter)

    const processed = await worker.processOnce()

    expect(processed).toBe(1)
    const row = (await db.select().from(outbox))[0]!
    expect(row.sentAt).toBeNull()
    expect(row.attempts).toBe(1)
    expect(row.lastError).toContain('no adapter')
  })
})

describe('OutboxWorker start/stop', () => {
  it('polls and sends queued rows until stopped', async () => {
    const chatId = await createChat()
    const adapter = new FakeAdapter()
    const worker = makeWorker(adapter, { pollMs: 20 })
    worker.start()
    await enqueueOutbound(db, chatId, msg)

    await vi.waitFor(() => { expect(adapter.sent).toHaveLength(1) }, { timeout: 2000, interval: 10 })

    await worker.stop()
    await enqueueOutbound(db, chatId, msg)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(adapter.sent).toHaveLength(1)                 // nothing sent after stop
  })
})
