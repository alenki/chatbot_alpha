import { and, asc, eq, isNull, lt, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { outbox } from '../db/schema.js'
import type { Channel, ChannelAdapter, OutboundMessage } from './types.js'

export async function enqueueOutbound(db: Db, chatId: number, msg: OutboundMessage): Promise<void> {
  await db.insert(outbox).values({
    chatId,
    payload: { channel: msg.channel, externalChatId: msg.externalChatId, text: msg.text },
  })
}

export class OutboxWorker {
  private readonly db: Db
  private readonly adapters: Map<Channel, ChannelAdapter>
  private readonly pollMs: number
  private readonly maxAttempts: number
  private timer: ReturnType<typeof setInterval> | null = null
  private tick: Promise<unknown> = Promise.resolve()

  constructor(db: Db, adapters: Map<Channel, ChannelAdapter>, opts?: { pollMs?: number; maxAttempts?: number }) {
    this.db = db
    this.adapters = adapters
    this.pollMs = opts?.pollMs ?? 2000
    this.maxAttempts = opts?.maxAttempts ?? 5
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      // Chain onto the previous tick so polls never overlap (no double-sends).
      // A failed tick is swallowed: its rows stay in the table and are retried next poll.
      this.tick = this.tick.then(() => this.processOnce()).catch(() => undefined)
    }, this.pollMs)
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.tick // let an in-flight tick finish before shutdown
  }

  /**
   * Attempts every due row: unsent, nextAttemptAt reached, attempts < maxAttempts.
   * Returns the number of rows processed (successes and failures alike).
   * Backoff after a failure: 2^attempts * 5s (attempts = the just-incremented value).
   * Rows that reach maxAttempts keep their lastError and are never selected again.
   */
  async processOnce(): Promise<number> {
    const due = await this.db
      .select()
      .from(outbox)
      .where(
        and(
          isNull(outbox.sentAt),
          lte(outbox.nextAttemptAt, sql`now()`),
          lt(outbox.attempts, this.maxAttempts),
        ),
      )
      .orderBy(asc(outbox.id))

    for (const row of due) {
      const { channel, externalChatId, text } = row.payload
      try {
        const adapter = this.adapters.get(channel as Channel)
        if (adapter === undefined) throw new Error(`no adapter registered for channel "${channel}"`)
        await adapter.send({ channel: channel as Channel, externalChatId, text })
        await this.db.update(outbox).set({ sentAt: new Date() }).where(eq(outbox.id, row.id))
      } catch (err) {
        const attempts = row.attempts + 1
        await this.db
          .update(outbox)
          .set({
            attempts,
            lastError: err instanceof Error ? err.message : String(err),
            nextAttemptAt: new Date(Date.now() + 2 ** attempts * 5_000),
          })
          .where(eq(outbox.id, row.id))
      }
    }
    return due.length
  }
}
