import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { chats, clients, escalations, messages, processedUpdates, settings } from '../db/schema.js'
import type { Channel, ChannelAdapter, InboundMessage } from '../channels/types.js'
import { enqueueOutbound } from '../channels/outbox.js'
import { LlmRateLimitedError, LlmUnavailableError, type LlmClient } from '../brain/llm.js'
import type { AgentTool } from '../brain/tools/registry.js'
import { runAgent } from '../brain/agent.js'
import { maybeSummarizeHistory } from '../brain/summarize.js'
import type { ManagerNotifier } from '../notify/managers.js'
import type { Logger } from '../log.js'
import { DEFAULT_ESCALATION_KEYWORDS, matchesEscalationKeywords } from './escalation.js'

export interface EngineDeps {
  db: Db; llm: LlmClient; tools: AgentTool<any>[]; notifier: ManagerNotifier
  adapters: Map<Channel, ChannelAdapter>; filesDir: string; log: Logger
  debounceMs?: number              // default 10_000; tests pass 50
}

const CAP_MESSAGE = 'Передаю диалог менеджеру, он скоро ответит 👌'
const LLM_DOWN_MESSAGE = 'Передал ваш вопрос менеджеру 👌'
const DEFAULT_DAILY_TURN_CAP = 30

type ChatRow = typeof chats.$inferSelect

export class ConversationEngine {
  private readonly deps: EngineDeps
  private readonly debounceMs: number
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Set<Promise<void>>()
  // Per-chat serialization: a slow DB can let a debounce timer fire while a
  // previous flush for the same chat is still awaiting, which would double-run
  // the agent. Each chat's flushes chain onto the previous one's tail.
  private readonly flushChains = new Map<number, Promise<void>>()
  private stopped = false

  constructor(deps: EngineDeps) {
    this.deps = deps
    this.debounceMs = deps.debounceMs ?? 10_000
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    // 1. Idempotency: Telegram and Max both redeliver updates; the composite PK
    //    (channel, update_id) makes the insert a take-once lock.
    const claimed = await this.deps.db
      .insert(processedUpdates)
      .values({ channel: msg.channel, updateId: msg.externalMessageId })
      .onConflictDoNothing()
      .returning({ updateId: processedUpdates.updateId })
    if (claimed.length === 0) return // already processed

    // 2. Upsert chat (and a client stub when we already know something about the sender).
    const chat = await this.upsertChat(msg)

    // 3. Persist the client message, attachments included.
    await this.deps.db.insert(messages).values({
      chatId: chat.id,
      role: 'client',
      content: msg.text,
      attachments: msg.attachments,
      externalMessageId: msg.externalMessageId,
    })

    // 4. Code-enforced escalation keywords — never left to the model alone.
    const keywords = (await this.getSetting<string[]>('escalation_keywords')) ?? DEFAULT_ESCALATION_KEYWORDS
    if (msg.text !== '' && matchesEscalationKeywords(msg.text, keywords)) {
      this.clearTimer(chat.id)
      await this.escalate(chat.id, 'Клиент попросил человека', msg.text)
      return
    }

    // 5. Paused or human/closed chats: store only, no AI.
    if (chat.botPaused || chat.status !== 'ai') return

    // 6. Debounce: clients send bursts; batch them into one AI run.
    this.scheduleFlush(chat.id)
  }

  private async upsertChat(msg: InboundMessage): Promise<ChatRow> {
    const db = this.deps.db
    let [chat] = await db
      .select()
      .from(chats)
      .where(and(eq(chats.channel, msg.channel), eq(chats.externalChatId, msg.externalChatId)))
    if (chat === undefined) {
      const inserted = await db
        .insert(chats)
        .values({ channel: msg.channel, externalChatId: msg.externalChatId })
        .onConflictDoNothing()
        .returning()
      chat = inserted[0]
      if (chat === undefined) {
        // lost a concurrent-create race against the unique index — the row exists now
        ;[chat] = await db
          .select()
          .from(chats)
          .where(and(eq(chats.channel, msg.channel), eq(chats.externalChatId, msg.externalChatId)))
      }
    }
    if (chat === undefined) throw new Error('failed to upsert chat')
    if (chat.clientId === null && (msg.userDisplayName !== undefined || msg.phone !== undefined)) {
      const [client] = await db
        .insert(clients)
        .values({ name: msg.userDisplayName ?? null, phone: msg.phone ?? null })
        .returning({ id: clients.id })
      await db.update(chats).set({ clientId: client!.id }).where(eq(chats.id, chat.id))
      chat = { ...chat, clientId: client!.id }
    }
    return chat
  }

  private async getSetting<T>(key: string): Promise<T | undefined> {
    const rows = await this.deps.db.select().from(settings).where(eq(settings.key, key))
    return rows.length === 0 ? undefined : (rows[0]!.value as T)
  }

  /** Same effects as the escalate_to_human tool: pause, mark human, record, notify managers. */
  private async escalate(chatId: number, reason: string, summary: string): Promise<void> {
    await this.deps.db.update(chats).set({ botPaused: true, status: 'human' }).where(eq(chats.id, chatId))
    const [row] = await this.deps.db
      .insert(escalations)
      .values({ chatId, reason, summary })
      .returning({ id: escalations.id })
    await this.deps.notifier.escalationCard(row!.id)
  }

  private scheduleFlush(chatId: number): void {
    if (this.stopped) return
    this.clearTimer(chatId)
    const timer = setTimeout(() => {
      this.timers.delete(chatId)
      // Unhandled-rejection guard: a bare async timer callback would crash the
      // process on any error; catch and log instead.
      const run = this.flushChat(chatId).catch((err: unknown) => {
        this.deps.log.error({ err, chatId }, 'flushChat failed')
      })
      this.inFlight.add(run)
      void run.finally(() => this.inFlight.delete(run))
    }, this.debounceMs)
    this.timers.set(chatId, timer)
  }

  private clearTimer(chatId: number): void {
    const timer = this.timers.get(chatId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(chatId)
    }
  }

  /**
   * Runs one AI turn now. Exposed for tests and direct callers: skips any waiting debounce.
   * Serialized per chat so an in-flight flush and a freshly-fired debounce timer can never
   * run the agent twice for the same chat at once.
   */
  async flushChat(chatId: number): Promise<void> {
    this.clearTimer(chatId)
    const prior = this.flushChains.get(chatId) ?? Promise.resolve()
    // A previous flush's failure must not block this one, so swallow it for chaining.
    const next = prior.then(() => this.runFlush(chatId))
    // Track the tail (swallowed) so later flushes queue behind it; GC the entry once we are the tail.
    const tail = next.catch(() => {})
    this.flushChains.set(chatId, tail)
    void tail.finally(() => {
      if (this.flushChains.get(chatId) === tail) this.flushChains.delete(chatId)
    })
    return next
  }

  /** The actual single AI turn. Runs only inside the per-chat serialization chain. */
  private async runFlush(chatId: number): Promise<void> {
    const db = this.deps.db
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
    if (chat === undefined) return
    // 1. Re-check: a manager or a keyword escalation may have paused the chat while it debounced.
    if (chat.botPaused || chat.status !== 'ai') return

    // A previous flush in this same chain may have already answered the latest
    // client message (slow-DB debounce overlap). If the newest message is not
    // from the client, there is nothing new to respond to — skip silently.
    const [latest] = await db
      .select({ role: messages.role })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1)
    if (latest === undefined || latest.role !== 'client') return

    // 2. Daily turn cap (anti-loop, anti-injection cost ceiling). A stale date resets the counter.
    const today = new Date().toISOString().slice(0, 10)
    const turnsToday = chat.aiTurnsDate === today ? chat.aiTurnsToday : 0
    const cap = (await this.getSetting<number>('daily_turn_cap')) ?? DEFAULT_DAILY_TURN_CAP
    if (turnsToday >= cap) {
      await enqueueOutbound(db, chatId, {
        channel: chat.channel as Channel,
        externalChatId: chat.externalChatId,
        text: CAP_MESSAGE,
      })
      await this.escalate(chatId, 'Достигнут дневной лимит ответов ИИ', `Чат превысил лимит ${cap} AI-ответов в день`)
      return
    }

    // 3. Typing indicator is best-effort; never block the turn on it.
    const adapter = this.deps.adapters.get(chat.channel as Channel)
    if (adapter !== undefined) {
      try {
        await adapter.sendTyping(chat.externalChatId)
      } catch (err) {
        this.deps.log.warn({ err, chatId }, 'sendTyping failed')
      }
    }

    try {
      await maybeSummarizeHistory(db, this.deps.llm, chatId)
      const result = await runAgent(
        {
          db,
          llm: this.deps.llm,
          tools: this.deps.tools,
          notifier: this.deps.notifier,
          filesDir: this.deps.filesDir,
          log: this.deps.log,
        },
        chatId,
      )

      if (result.reply === null) {
        // 5. The loop exhausted without a final text answer. If the agent already
        //    escalated via its tool, don't stack a second escalation card.
        if (!result.escalated) {
          await this.escalate(chatId, 'AI не смог сформировать ответ', '')
        }
        return
      }

      // 4. Persist the AI turn with token usage, count it, queue the outbound send.
      await db.insert(messages).values({
        chatId,
        role: 'ai',
        content: result.reply,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      })
      await db.update(chats).set({ aiTurnsToday: turnsToday + 1, aiTurnsDate: today }).where(eq(chats.id, chatId))
      await enqueueOutbound(db, chatId, {
        channel: chat.channel as Channel,
        externalChatId: chat.externalChatId,
        text: result.reply,
      })
    } catch (err) {
      // 6. Degrade gracefully — the client never sees an error or silence.
      if (err instanceof LlmRateLimitedError) {
        await enqueueOutbound(db, chatId, {
          channel: chat.channel as Channel,
          externalChatId: chat.externalChatId,
          text: CAP_MESSAGE,
        })
        await this.escalate(chatId, 'Лимит нейросети исчерпан', '')
        return
      }
      if (err instanceof LlmUnavailableError) {
        await enqueueOutbound(db, chatId, {
          channel: chat.channel as Channel,
          externalChatId: chat.externalChatId,
          text: LLM_DOWN_MESSAGE,
        })
        await this.escalate(chatId, 'Нейросеть недоступна', '')
        return
      }
      throw err // unexpected → the timer guard logs it; a direct caller (test/flush) sees it
    }
  }

  /** Clears all pending debounce timers and waits for in-flight flushes (clean vitest/process exit). */
  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.allSettled([...this.inFlight])
  }
}
