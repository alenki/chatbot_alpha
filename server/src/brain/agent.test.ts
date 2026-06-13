import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { chats, messages } from '../db/schema.js'
import { createLogger } from '../log.js'
import type { ManagerNotifier } from '../notify/managers.js'
import type { LlmClient, LlmMessage, LlmResponse, ToolSpec } from './llm.js'
import type { AgentTool } from './tools/registry.js'
import { runAgent, type AgentDeps } from './agent.js'

const db = getTestDb()

class FakeLlm {
  calls: { messages: LlmMessage[]; tools: ToolSpec[] }[] = []
  constructor(private readonly script: LlmResponse[]) {}

  async chat(messages: LlmMessage[], tools: ToolSpec[]): Promise<LlmResponse> {
    this.calls.push({ messages: structuredClone(messages), tools })
    const next = this.script.shift()
    if (next === undefined) throw new Error('FakeLlm script exhausted')
    return next
  }
}

class FakeNotifier implements ManagerNotifier {
  async orderCard(_orderId: number): Promise<void> {}
  async escalationCard(_escalationId: number): Promise<void> {}
}

const echoExecutions: { text: string }[] = []
const echoTool: AgentTool<{ text: string }> = {
  name: 'echo',
  description: 'test echo tool',
  schema: z.object({ text: z.string() }),
  async execute(args) {
    echoExecutions.push(args)
    return JSON.stringify({ echoed: args.text })
  },
}

const escalateStub: AgentTool<{ reason: string; summary: string }> = {
  name: 'escalate_to_human',
  description: 'test escalate stub',
  schema: z.object({ reason: z.string(), summary: z.string() }),
  async execute() {
    return JSON.stringify({ ok: true })
  },
}

function makeDeps(fake: FakeLlm): AgentDeps {
  return {
    db,
    llm: fake as unknown as LlmClient,
    tools: [echoTool, escalateStub],
    notifier: new FakeNotifier(),
    filesDir: './data/files',
    log: createLogger('test'),
  }
}

function text(content: string, tokens: [number, number] = [100, 20]): LlmResponse {
  return { content, toolCalls: [], promptTokens: tokens[0], completionTokens: tokens[1] }
}

function withToolCalls(...calls: { id: string; name: string; arguments: string }[]): LlmResponse {
  return { content: null, toolCalls: calls, promptTokens: 50, completionTokens: 10 }
}

async function seedChat(): Promise<number> {
  const rows = await db
    .insert(chats)
    .values({ channel: 'telegram', externalChatId: '100' })
    .returning({ id: chats.id })
  return rows[0]!.id
}

async function addMessage(chatId: number, role: string, content: string, minutesAgo: number): Promise<void> {
  await db.insert(messages).values({ chatId, role, content, createdAt: new Date(Date.now() - minutesAgo * 60_000) })
}

describe('runAgent', () => {
  beforeEach(async () => {
    await resetDb()
    echoExecutions.length = 0
  })

  it('returns the final text reply and maps history roles to the LLM format', async () => {
    const chatId = await seedChat()
    await addMessage(chatId, 'client', 'Здравствуйте', 5)
    await addMessage(chatId, 'ai', 'Добрый день! Чем можем помочь?', 4)
    await addMessage(chatId, 'manager', 'Подключаюсь к диалогу', 3)
    await addMessage(chatId, 'system', 'internal note — never sent to the model', 2)
    await addMessage(chatId, 'client', 'Сколько стоят визитки?', 1)
    const fake = new FakeLlm([text('Сейчас посчитаю!')])

    const result = await runAgent(makeDeps(fake), chatId)

    expect(result).toEqual({ reply: 'Сейчас посчитаю!', escalated: false, promptTokens: 100, completionTokens: 20 })
    expect(fake.calls).toHaveLength(1)
    const sent = fake.calls[0]!.messages
    expect(sent[0]!.role).toBe('system') // buildSystemPrompt output
    expect(sent.slice(1)).toEqual([
      { role: 'user', content: 'Здравствуйте' },
      { role: 'assistant', content: 'Добрый день! Чем можем помочь?' },
      { role: 'user', content: '[Менеджер]: Подключаюсь к диалогу' },
      { role: 'user', content: 'Сколько стоят визитки?' },
    ])
    // tool specs built from deps.tools
    expect(fake.calls[0]!.tools.map((t) => t.name)).toEqual(['echo', 'escalate_to_human'])
  })

  it('dispatches tool calls with parsed args and feeds the results back', async () => {
    const chatId = await seedChat()
    await addMessage(chatId, 'client', 'привет', 1)
    const fake = new FakeLlm([
      withToolCalls({ id: 'call_1', name: 'echo', arguments: '{"text":"привет"}' }),
      text('Готово', [60, 15]),
    ])

    const result = await runAgent(makeDeps(fake), chatId)

    expect(echoExecutions).toEqual([{ text: 'привет' }]) // parsed, validated args reached the tool
    expect(result.reply).toBe('Готово')
    expect(result.escalated).toBe(false)
    expect(result.promptTokens).toBe(110)    // 50 + 60 accumulated across iterations
    expect(result.completionTokens).toBe(25) // 10 + 15

    const second = fake.calls[1]!.messages
    expect(second[second.length - 2]).toEqual({
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'call_1', name: 'echo', arguments: '{"text":"привет"}' }],
    })
    expect(second[second.length - 1]).toEqual({
      role: 'tool',
      content: '{"echoed":"привет"}',
      toolCallId: 'call_1',
    })
  })

  it('sets escalated=true when escalate_to_human is dispatched', async () => {
    const chatId = await seedChat()
    await addMessage(chatId, 'client', 'позовите человека!!!', 1)
    const fake = new FakeLlm([
      withToolCalls({
        id: 'call_2',
        name: 'escalate_to_human',
        arguments: '{"reason":"Клиент просит человека","summary":"Хочет говорить с менеджером."}',
      }),
      text('Передаю диалог менеджеру.'),
    ])

    const result = await runAgent(makeDeps(fake), chatId)

    expect(result.escalated).toBe(true)
    expect(result.reply).toBe('Передаю диалог менеджеру.')
  })

  it('caps the loop at 8 iterations and returns reply=null', async () => {
    const chatId = await seedChat()
    await addMessage(chatId, 'client', 'зацикли инструменты', 1)
    const script = Array.from({ length: 8 }, (_, i) =>
      withToolCalls({ id: `call_${i}`, name: 'echo', arguments: '{"text":"ещё раз"}' }),
    )
    const fake = new FakeLlm(script)

    const result = await runAgent(makeDeps(fake), chatId)

    expect(fake.calls).toHaveLength(8) // exactly the cap — the script has nothing for a 9th call
    expect(result.reply).toBeNull()    // engine treats null as "escalate"
    expect(result.escalated).toBe(false)
    expect(result.promptTokens).toBe(400)    // 8 × 50
    expect(result.completionTokens).toBe(80) // 8 × 10
  })

  it('sends only the newest 20 messages', async () => {
    const chatId = await seedChat()
    for (let i = 1; i <= 25; i += 1) {
      await addMessage(chatId, 'client', `m-${i}`, 26 - i)
    }
    const fake = new FakeLlm([text('ок')])

    await runAgent(makeDeps(fake), chatId)

    const sent = fake.calls[0]!.messages
    expect(sent).toHaveLength(21) // system + 20
    expect(sent[1]).toEqual({ role: 'user', content: 'm-6' })   // m-1..m-5 dropped
    expect(sent[20]).toEqual({ role: 'user', content: 'm-25' }) // newest last
  })

  it('throws when the chat does not exist', async () => {
    const fake = new FakeLlm([])
    await expect(runAgent(makeDeps(fake), 9999)).rejects.toThrow('chat 9999 not found')
  })
})
