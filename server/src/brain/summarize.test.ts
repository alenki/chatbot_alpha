import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { chats, messages } from '../db/schema.js'
import type { LlmClient, LlmMessage, LlmResponse, ToolSpec } from './llm.js'
import { maybeSummarizeHistory } from './summarize.js'

const db = getTestDb()

class FakeLlm {
  calls: { messages: LlmMessage[]; tools: ToolSpec[] }[] = []
  response: LlmResponse = { content: 'Краткая сводка переписки.', toolCalls: [], promptTokens: 10, completionTokens: 5 }
  shouldThrow = false

  async chat(messages: LlmMessage[], tools: ToolSpec[]): Promise<LlmResponse> {
    this.calls.push({ messages, tools })
    if (this.shouldThrow) throw new Error('llm down')
    return this.response
  }
}

const asLlm = (fake: FakeLlm) => fake as unknown as LlmClient

async function seedChat(summary = ''): Promise<number> {
  const rows = await db
    .insert(chats)
    .values({ channel: 'telegram', externalChatId: '100', summary })
    .returning({ id: chats.id })
  return rows[0]!.id
}

/** Insert `count` messages msg-1..msg-count with strictly increasing createdAt. */
async function seedMessages(chatId: number, count: number): Promise<void> {
  const base = Date.now() - (count + 1) * 60_000
  const rows = Array.from({ length: count }, (_, i) => ({
    chatId,
    role: i % 2 === 0 ? 'client' : 'ai',
    content: `msg-${i + 1}`,
    createdAt: new Date(base + (i + 1) * 60_000),
  }))
  await db.insert(messages).values(rows)
}

async function getSummary(chatId: number): Promise<string> {
  const rows = await db.select({ summary: chats.summary }).from(chats).where(eq(chats.id, chatId))
  return rows[0]!.summary
}

describe('maybeSummarizeHistory', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('does nothing at 40 messages or fewer', async () => {
    const chatId = await seedChat()
    await seedMessages(chatId, 40)
    const fake = new FakeLlm()

    await maybeSummarizeHistory(db, asLlm(fake), chatId)

    expect(fake.calls).toHaveLength(0)
    expect(await getSummary(chatId)).toBe('')
  })

  it('compresses everything except the newest 20 messages with one no-tools LLM call', async () => {
    const chatId = await seedChat()
    await seedMessages(chatId, 41)
    const fake = new FakeLlm()

    await maybeSummarizeHistory(db, asLlm(fake), chatId)

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.tools).toEqual([])

    const userContent = fake.calls[0]!.messages.find((m) => m.role === 'user')!.content as string
    expect(userContent).toContain('msg-1\n')   // oldest message is in the compression window
    expect(userContent).toContain('msg-21')    // last message of the window (41 - 20 = 21)
    expect(userContent).not.toContain('msg-22') // newest 20 stay verbatim for runAgent
    expect(userContent).not.toContain('msg-41')

    expect(await getSummary(chatId)).toBe('Краткая сводка переписки.')
  })

  it('labels roles in Russian in the transcript it sends', async () => {
    const chatId = await seedChat()
    await seedMessages(chatId, 41)
    const fake = new FakeLlm()

    await maybeSummarizeHistory(db, asLlm(fake), chatId)

    const userContent = fake.calls[0]!.messages.find((m) => m.role === 'user')!.content as string
    expect(userContent).toContain('Клиент: msg-1')
    expect(userContent).toContain('Ассистент: msg-2')
  })

  it('feeds the existing summary into the prompt so it gets rolled forward', async () => {
    const chatId = await seedChat('Клиент уже согласовал макет визиток.')
    await seedMessages(chatId, 41)
    const fake = new FakeLlm()

    await maybeSummarizeHistory(db, asLlm(fake), chatId)

    const userContent = fake.calls[0]!.messages.find((m) => m.role === 'user')!.content as string
    expect(userContent).toContain('Клиент уже согласовал макет визиток.')
  })

  it('never deletes messages', async () => {
    const chatId = await seedChat()
    await seedMessages(chatId, 45)
    const fake = new FakeLlm()

    await maybeSummarizeHistory(db, asLlm(fake), chatId)

    const rows = await db.select().from(messages)
    expect(rows).toHaveLength(45)
  })

  it('swallows LLM failures and leaves the summary unchanged', async () => {
    const chatId = await seedChat('Старая сводка.')
    await seedMessages(chatId, 41)
    const fake = new FakeLlm()
    fake.shouldThrow = true

    await expect(maybeSummarizeHistory(db, asLlm(fake), chatId)).resolves.toBeUndefined()
    expect(await getSummary(chatId)).toBe('Старая сводка.')
  })

  it('ignores a blank LLM answer and keeps the previous summary', async () => {
    const chatId = await seedChat('Старая сводка.')
    await seedMessages(chatId, 41)
    const fake = new FakeLlm()
    fake.response = { content: null, toolCalls: [], promptTokens: 1, completionTokens: 0 }

    await maybeSummarizeHistory(db, asLlm(fake), chatId)

    expect(await getSummary(chatId)).toBe('Старая сводка.')
  })
})
