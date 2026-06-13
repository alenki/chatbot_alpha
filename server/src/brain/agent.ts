import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { chats, messages } from '../db/schema.js'
import type { Logger } from '../log.js'
import type { ManagerNotifier } from '../notify/managers.js'
import type { LlmClient, LlmMessage } from './llm.js'
import { buildSystemPrompt } from './prompt.js'
import { buildToolSpecs, dispatchToolCall, type AgentTool, type ToolContext } from './tools/registry.js'

export interface AgentDeps { db: Db; llm: LlmClient; tools: AgentTool<any>[]; notifier: ManagerNotifier; filesDir: string; log: Logger }
export interface AgentResult { reply: string | null; escalated: boolean; promptTokens: number; completionTokens: number }

const MAX_ITERATIONS = 8
const HISTORY_LIMIT = 20

/**
 * One agent turn: system prompt + last ≤20 messages → loop of llm.chat /
 * tool dispatch (≤8 iterations) → final text reply. reply=null means the
 * model never produced text — the conversation engine escalates on that.
 */
export async function runAgent(deps: AgentDeps, chatId: number): Promise<AgentResult> {
  const chatRows = await deps.db.select().from(chats).where(eq(chats.id, chatId))
  const chat = chatRows[0]
  if (chat === undefined) throw new Error(`chat ${chatId} not found`)

  const systemPrompt = await buildSystemPrompt(deps.db, chatId)

  const recent = await deps.db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(HISTORY_LIMIT)
  recent.reverse() // back to chronological order

  const history: LlmMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const m of recent) {
    if (m.role === 'client') history.push({ role: 'user', content: m.content })
    else if (m.role === 'ai') history.push({ role: 'assistant', content: m.content })
    else if (m.role === 'manager') history.push({ role: 'user', content: `[Менеджер]: ${m.content}` })
    // role 'system' rows are internal bookkeeping — never sent to the model
  }

  const specs = buildToolSpecs(deps.tools)
  const ctx: ToolContext = {
    db: deps.db,
    chatId,
    clientId: chat.clientId,
    notifier: deps.notifier,
    filesDir: deps.filesDir,
    log: deps.log,
  }

  let escalated = false
  let promptTokens = 0
  let completionTokens = 0

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const res = await deps.llm.chat(history, specs)
    promptTokens += res.promptTokens
    completionTokens += res.completionTokens

    if (res.toolCalls.length === 0) {
      return { reply: res.content, escalated, promptTokens, completionTokens }
    }

    history.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls })
    for (const call of res.toolCalls) {
      const result = await dispatchToolCall(call, deps.tools, ctx)
      if (call.name === 'escalate_to_human') escalated = true
      history.push({ role: 'tool', content: result, toolCallId: call.id })
    }
  }

  // Iteration cap hit without a text reply — the engine escalates on null.
  return { reply: null, escalated, promptTokens, completionTokens }
}
