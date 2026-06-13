import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { chats, clients, escalations, messages, outbox } from '../db/schema.js'
import type { Channel, ChannelAdapter, InboundMessage, OutboundMessage } from '../channels/types.js'
import {
  LlmRateLimitedError,
  LlmUnavailableError,
  type LlmClient,
  type LlmMessage,
  type LlmResponse,
  type ToolSpec,
} from '../brain/llm.js'
import type { ManagerNotifier } from '../notify/managers.js'
import type { Logger } from '../log.js'
import { ConversationEngine, type EngineDeps } from './conversation.js'

const db = getTestDb()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const today = () => new Date().toISOString().slice(0, 10)

/** Scriptable LLM stand-in. Script entries are consumed in order; the last entry repeats forever. */
class FakeLlm {
  calls: { messages: LlmMessage[]; tools: ToolSpec[] }[] = []
  script: (LlmResponse | Error)[] = [
    { content: 'Здравствуйте! Чем могу помочь?', toolCalls: [], promptTokens: 11, completionTokens: 7 },
  ]

  async chat(msgs: LlmMessage[], tools: ToolSpec[]): Promise<LlmResponse> {
    this.calls.push({ messages: msgs, tools })
    const next = this.script.length > 1 ? this.script.shift()! : this.script[0]
    if (next === undefined) throw new Error('FakeLlm script is empty')
    if (next instanceof Error) throw next
    return next
  }
}

interface Deferred {
  promise: Promise<LlmResponse>
  resolve: (res: LlmResponse) => void
  reject: (err: unknown) => void
}

/**
 * LLM stand-in whose every chat() returns a test-controlled deferred promise.
 * Lets a test pin a flush's (slow, networked) LLM call open and resolve it on
 * demand — driving the per-chat flush race deterministically, with no timers.
 */
class DeferredLlm {
  calls: { messages: LlmMessage[]; tools: ToolSpec[] }[] = []
  deferreds: Deferred[] = []

  async chat(msgs: LlmMessage[], tools: ToolSpec[]): Promise<LlmResponse> {
    this.calls.push({ messages: msgs, tools })
    let resolve!: (res: LlmResponse) => void
    let reject!: (err: unknown) => void
    const promise = new Promise<LlmResponse>((res, rej) => {
      resolve = res
      reject = rej
    })
    this.deferreds.push({ promise, resolve, reject })
    return promise
  }

  /** Resolves the Nth chat() call (0-based) with a final-text response. */
  resolveCall(index: number, content: string): void {
    this.deferreds[index]!.resolve({ content, toolCalls: [], promptTokens: 5, completionTokens: 3 })
  }
}

class FakeNotifier implements ManagerNotifier {
  orderCards: number[] = []
  escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> {
    this.orderCards.push(orderId)
  }
  async escalationCard(escalationId: number): Promise<void> {
    this.escalationCards.push(escalationId)
  }
}

class FakeAdapter implements ChannelAdapter {
  readonly channel: Channel = 'telegram'
  sent: OutboundMessage[] = []
  typing: string[] = []
  async start(_onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {}
  async stop(): Promise<void> {}
  async send(msg: OutboundMessage): Promise<void> {
    this.sent.push(msg)
  }
  async sendTyping(externalChatId: string): Promise<void> {
    this.typing.push(externalChatId)
  }
}

/** Minimal recording logger stub — captures log.error so the timer guard is testable. */
function makeTestLogger(): { log: Logger; errors: unknown[][] } {
  const errors: unknown[][] = []
  const stub = {
    level: 'silent',
    fatal: () => {},
    error: (...args: unknown[]) => {
      errors.push(args)
    },
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    child() {
      return stub
    },
  }
  return { log: stub as unknown as Logger, errors }
}

let msgSeq = 0
function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  msgSeq += 1
  return {
    channel: 'telegram',
    externalChatId: '555001',
    externalMessageId: `upd-${msgSeq}`,
    externalUserId: '555001',
    userDisplayName: 'Иван Петров',
    text: 'Сколько стоят визитки?',
    attachments: [],
    ...overrides,
  }
}

const engines: ConversationEngine[] = []

function makeEngine(overrides: Partial<EngineDeps> = {}) {
  const llm = new FakeLlm()
  const notifier = new FakeNotifier()
  const adapter = new FakeAdapter()
  const { log, errors } = makeTestLogger()
  const engine = new ConversationEngine({
    db,
    llm: llm as unknown as LlmClient,
    tools: [],
    notifier,
    adapters: new Map<Channel, ChannelAdapter>([['telegram', adapter]]),
    filesDir: './data/files',
    log,
    debounceMs: 50,
    ...overrides,
  })
  engines.push(engine)
  return { engine, llm, notifier, adapter, errors }
}

describe('ConversationEngine', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterEach(async () => {
    while (engines.length > 0) await engines.pop()!.stop()
  })

  it('processes a duplicate externalMessageId only once', async () => {
    const { engine } = makeEngine()
    const msg = makeMsg({ externalMessageId: 'dup-1' })

    await engine.handleInbound(msg)
    await engine.handleInbound({ ...msg })

    const rows = await db.select().from(messages).where(eq(messages.role, 'client'))
    expect(rows).toHaveLength(1)
  })

  it('creates a chat and a client stub on the first message and reuses both after', async () => {
    const { engine } = makeEngine()

    await engine.handleInbound(makeMsg({ phone: '+79991234567' }))
    await engine.handleInbound(makeMsg({ text: 'И ещё листовки' }))

    const chatRows = await db.select().from(chats)
    expect(chatRows).toHaveLength(1)
    expect(chatRows[0]).toMatchObject({
      channel: 'telegram',
      externalChatId: '555001',
      status: 'ai',
      botPaused: false,
    })
    const clientRows = await db.select().from(clients)
    expect(clientRows).toHaveLength(1)
    expect(clientRows[0]).toMatchObject({ name: 'Иван Петров', phone: '+79991234567' })
    expect(chatRows[0]!.clientId).toBe(clientRows[0]!.id)
  })

  it('persists the client message with attachments and the external id', async () => {
    const { engine } = makeEngine()
    const attachment = {
      path: '/data/files/telegram/u1/maket.pdf',
      name: 'maket.pdf',
      mime: 'application/pdf',
      size: 2048,
    }

    await engine.handleInbound(makeMsg({ text: '', attachments: [attachment], externalMessageId: 'file-1' }))

    const rows = await db.select().from(messages).where(eq(messages.role, 'client'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'client', content: '', externalMessageId: 'file-1' })
    expect(rows[0]!.attachments).toEqual([attachment])
  })

  it('escalates on "позовите человека" without ever calling the LLM', async () => {
    const { engine, llm, notifier } = makeEngine()

    await engine.handleInbound(makeMsg({ text: 'Позовите человека, пожалуйста' }))

    const [chat] = await db.select().from(chats)
    expect(chat!.botPaused).toBe(true)
    expect(chat!.status).toBe('human')
    const escRows = await db.select().from(escalations)
    expect(escRows).toHaveLength(1)
    expect(escRows[0]).toMatchObject({
      chatId: chat!.id,
      reason: 'Клиент попросил человека',
      summary: 'Позовите человека, пожалуйста',
    })
    expect(notifier.escalationCards).toEqual([escRows[0]!.id])
    await sleep(150) // well past the 50ms debounce — no timer may fire
    expect(llm.calls).toHaveLength(0)
  })

  it('stores messages for a paused chat without running the AI', async () => {
    await db.insert(chats).values({
      channel: 'telegram',
      externalChatId: '555001',
      botPaused: true,
      status: 'human',
    })
    const { engine, llm } = makeEngine()

    await engine.handleInbound(makeMsg({ text: 'Ну что там с заказом?' }))

    const rows = await db.select().from(messages)
    expect(rows).toHaveLength(1)
    await sleep(150)
    expect(llm.calls).toHaveLength(0)
    expect(await db.select().from(outbox)).toHaveLength(0)
  })

  it('debounces a burst of messages into a single agent run', async () => {
    const { engine, llm } = makeEngine()

    await engine.handleInbound(makeMsg({ text: 'Здравствуйте!' }))
    await sleep(20) // second message lands inside the 50ms debounce window
    await engine.handleInbound(makeMsg({ text: 'Сколько стоят визитки, 500 штук?' }))

    await vi.waitFor(
      () => {
        expect(llm.calls.length).toBeGreaterThan(0)
      },
      { timeout: 2000, interval: 10 },
    )
    await sleep(150) // would expose a second, separately-debounced run
    expect(llm.calls).toHaveLength(1)
    // both burst messages reached the model in the ONE call
    const userTexts = llm.calls[0]!.messages
      .filter((m) => m.role === 'user')
      .map((m) => (m as { content: string }).content)
    expect(userTexts).toEqual(['Здравствуйте!', 'Сколько стоят визитки, 500 штук?'])
    const aiRows = await db.select().from(messages).where(eq(messages.role, 'ai'))
    expect(aiRows).toHaveLength(1)
    expect(await db.select().from(outbox)).toHaveLength(1)
  })

  it('resets a stale daily turn counter instead of capping', async () => {
    const [chat] = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '555001', aiTurnsToday: 30, aiTurnsDate: '2020-01-01' })
      .returning()
    await db.insert(messages).values({ chatId: chat!.id, role: 'client', content: 'Сколько стоят визитки?' })
    const { engine, llm } = makeEngine()

    await engine.flushChat(chat!.id)

    expect(llm.calls).toHaveLength(1)
    const [updated] = await db.select().from(chats)
    expect(updated!.aiTurnsToday).toBe(1)
    expect(updated!.aiTurnsDate).toBe(today())
  })

  it('at the daily cap sends the handoff message via outbox and escalates without an LLM call', async () => {
    const [chat] = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '555001', aiTurnsToday: 30, aiTurnsDate: today() })
      .returning()
    await db.insert(messages).values({ chatId: chat!.id, role: 'client', content: 'Ещё вопрос' })
    const { engine, llm, notifier } = makeEngine()

    await engine.flushChat(chat!.id)

    expect(llm.calls).toHaveLength(0)
    const outRows = await db.select().from(outbox)
    expect(outRows).toHaveLength(1)
    expect(outRows[0]!.payload).toEqual({
      channel: 'telegram',
      externalChatId: '555001',
      text: 'Передаю диалог менеджеру, он скоро ответит 👌',
    })
    const escRows = await db.select().from(escalations)
    expect(escRows).toHaveLength(1)
    expect(escRows[0]!.reason).toBe('Достигнут дневной лимит ответов ИИ')
    expect(notifier.escalationCards).toHaveLength(1)
    const [updated] = await db.select().from(chats)
    expect(updated!.botPaused).toBe(true)
    expect(updated!.status).toBe('human')
  })

  it('persists the AI reply with token usage, counts the turn and enqueues the outbound send', async () => {
    const { engine, llm, adapter } = makeEngine()
    llm.script = [
      { content: 'Визитки 500 шт — от 1600 ₽, предварительно.', toolCalls: [], promptTokens: 321, completionTokens: 45 },
    ]
    await engine.handleInbound(makeMsg({ text: 'Сколько стоят визитки, 500 штук?' }))
    const [chat] = await db.select().from(chats)

    await engine.flushChat(chat!.id)

    expect(adapter.typing).toEqual(['555001'])
    const aiRows = await db.select().from(messages).where(eq(messages.role, 'ai'))
    expect(aiRows).toHaveLength(1)
    expect(aiRows[0]).toMatchObject({
      content: 'Визитки 500 шт — от 1600 ₽, предварительно.',
      promptTokens: 321,
      completionTokens: 45,
    })
    const outRows = await db.select().from(outbox)
    expect(outRows).toHaveLength(1)
    expect(outRows[0]!.payload).toEqual({
      channel: 'telegram',
      externalChatId: '555001',
      text: 'Визитки 500 шт — от 1600 ₽, предварительно.',
    })
    const [updated] = await db.select().from(chats)
    expect(updated!.aiTurnsToday).toBe(1)
    expect(updated!.aiTurnsDate).toBe(today())
  })

  it('escalates when the agent produces no reply', async () => {
    const { engine, llm, notifier } = makeEngine()
    llm.script = [{ content: null, toolCalls: [], promptTokens: 10, completionTokens: 0 }]
    await engine.handleInbound(makeMsg())
    const [chat] = await db.select().from(chats)

    await engine.flushChat(chat!.id)

    const escRows = await db.select().from(escalations)
    expect(escRows).toHaveLength(1)
    expect(escRows[0]!.reason).toBe('AI не смог сформировать ответ')
    expect(notifier.escalationCards).toHaveLength(1)
    const [updated] = await db.select().from(chats)
    expect(updated!.botPaused).toBe(true)
    expect(await db.select().from(messages).where(eq(messages.role, 'ai'))).toHaveLength(0)
    expect(await db.select().from(outbox)).toHaveLength(0)
  })

  it('on LlmRateLimitedError sends the cap message and escalates', async () => {
    const { engine, llm, notifier } = makeEngine()
    llm.script = [new LlmRateLimitedError('429: daily free-tier limit')]
    await engine.handleInbound(makeMsg())
    const [chat] = await db.select().from(chats)

    await engine.flushChat(chat!.id)

    const outRows = await db.select().from(outbox)
    expect(outRows).toHaveLength(1)
    expect(outRows[0]!.payload.text).toBe('Передаю диалог менеджеру, он скоро ответит 👌')
    const escRows = await db.select().from(escalations)
    expect(escRows).toHaveLength(1)
    expect(escRows[0]!.reason).toBe('Лимит нейросети исчерпан')
    expect(notifier.escalationCards).toHaveLength(1)
    const [updated] = await db.select().from(chats)
    expect(updated!.botPaused).toBe(true)
  })

  it('on LlmUnavailableError sends the apology message and escalates', async () => {
    const { engine, llm, notifier } = makeEngine()
    llm.script = [new LlmUnavailableError('all profiles failed')]
    await engine.handleInbound(makeMsg())
    const [chat] = await db.select().from(chats)

    await engine.flushChat(chat!.id)

    const outRows = await db.select().from(outbox)
    expect(outRows).toHaveLength(1)
    expect(outRows[0]!.payload.text).toBe('Передал ваш вопрос менеджеру 👌')
    const escRows = await db.select().from(escalations)
    expect(escRows).toHaveLength(1)
    expect(escRows[0]!.reason).toBe('Нейросеть недоступна')
    expect(notifier.escalationCards).toHaveLength(1)
    const [updated] = await db.select().from(chats)
    expect(updated!.botPaused).toBe(true)
  })

  it('catches and logs unexpected errors thrown inside the debounce timer callback', async () => {
    const { engine, llm, errors } = makeEngine()
    llm.script = [new Error('unexpected boom')]

    await engine.handleInbound(makeMsg())

    await vi.waitFor(
      () => {
        expect(errors.length).toBeGreaterThan(0)
      },
      { timeout: 2000, interval: 10 },
    )
    // unexpected (non-LLM-typed) errors do not pause the chat — the next client message retries
    const [chat] = await db.select().from(chats)
    expect(chat!.botPaused).toBe(false)
    expect(await db.select().from(escalations)).toHaveLength(0)
  })

  it('stop() clears pending debounce timers so no flush runs', async () => {
    const { engine, llm } = makeEngine()
    await engine.handleInbound(makeMsg())

    await engine.stop()
    await sleep(150)

    expect(llm.calls).toHaveLength(0)
    expect(await db.select().from(outbox)).toHaveLength(0)
  })

  it('answers a client message that arrives while a prior flush is mid-LLM (no role-skip race)', async () => {
    // Deterministic reproduction of the per-chat flush race (no wall-clock timing):
    //  A starts and is pinned inside its (slow) LLM call. M2 arrives. B is chained
    //  after A. A finishes and writes its AI reply (higher id/createdAt than M2).
    //  Under the OLD role-based guard B sees latest.role==='ai' and skips, so M2 is
    //  never answered. The id-watermark fix makes B run because M2's id exceeds it.
    const llm = new DeferredLlm()
    const { engine, adapter } = makeEngine({ llm: llm as unknown as LlmClient })

    const [chat] = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '555001' })
      .returning()
    const chatId = chat!.id

    // M1 → flush A (pinned inside its LLM call; do not await).
    await db.insert(messages).values({ chatId, role: 'client', content: 'Сколько стоят визитки?' })
    const pA = engine.flushChat(chatId)
    await vi.waitFor(() => expect(llm.calls).toHaveLength(1), { timeout: 2000, interval: 5 })

    // M2 arrives while A is mid-LLM → flush B, chained after A.
    await db.insert(messages).values({ chatId, role: 'client', content: 'И листовки тоже?' })
    const pB = engine.flushChat(chatId)

    // A finishes (writes its AI reply with a higher id than M2), then B runs.
    llm.resolveCall(0, 'Визитки 500 шт — от 1600 ₽.')
    await vi.waitFor(() => expect(llm.calls).toHaveLength(2), { timeout: 2000, interval: 5 })
    llm.resolveCall(1, 'Листовки А6 — от 900 ₽.')

    await Promise.all([pA, pB])

    // runAgent ran twice (one llm.chat per agent turn, no tool calls).
    expect(llm.calls).toHaveLength(2)
    // BOTH client messages got answered: two AI rows, two outbound sends.
    const aiRows = await db.select().from(messages).where(eq(messages.role, 'ai'))
    expect(aiRows).toHaveLength(2)
    expect(aiRows.map((r) => r.content)).toEqual(
      expect.arrayContaining(['Визитки 500 шт — от 1600 ₽.', 'Листовки А6 — от 900 ₽.']),
    )
    expect(await db.select().from(outbox)).toHaveLength(2)
  })

  it('a redundant chained flush with no new client message skips (debounce + double-run guard)', async () => {
    // Two flushes scheduled but only ONE client message: B must find the
    // watermark already at M1's id and skip, so the agent runs exactly once.
    const { engine, llm } = makeEngine()
    llm.script = [
      { content: 'Готов помочь!', toolCalls: [], promptTokens: 9, completionTokens: 4 },
    ]
    const [chat] = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '555001' })
      .returning()
    const chatId = chat!.id
    await db.insert(messages).values({ chatId, role: 'client', content: 'Сколько стоят визитки?' })

    await Promise.all([engine.flushChat(chatId), engine.flushChat(chatId)])

    expect(llm.calls).toHaveLength(1)
    expect(await db.select().from(messages).where(eq(messages.role, 'ai'))).toHaveLength(1)
    expect(await db.select().from(outbox)).toHaveLength(1)
  })
})
