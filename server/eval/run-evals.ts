import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'

// Load the repo-root .env into process.env before reading config (same approach as
// src/db/seed.ts and vitest.setup.ts) so `pnpm eval` sees DATABASE_URL / LLM keys /
// TEST_DATABASE_URL without a dotenv dependency. server/eval → ../../.env.
try {
  const here = dirname(fileURLToPath(import.meta.url))
  process.loadEnvFile(resolve(here, '..', '..', '.env'))
} catch {
  // .env is optional (CI injects env directly); ignore when absent.
}

import { loadConfig } from '../src/config.js'
import { closeDb, type Db } from '../src/db/client.js'
import { getTestDb, resetDb } from '../src/db/test-utils.js'
import { seed } from '../src/db/seed.js'
import { chats, escalations, orders } from '../src/db/schema.js'
import type { Channel, ChannelAdapter, InboundMessage, OutboundMessage } from '../src/channels/types.js'
import type { ManagerNotifier } from '../src/notify/managers.js'
import { LlmClient, type ModelProfile } from '../src/brain/llm.js'
import { priceQuoteTool } from '../src/brain/tools/price-quote.js'
import { knowledgeTool } from '../src/brain/tools/knowledge.js'
import { createOrderTool } from '../src/brain/tools/create-order.js'
import { escalateTool } from '../src/brain/tools/escalate.js'
import { clientNoteTool } from '../src/brain/tools/client-note.js'
import type { AgentTool } from '../src/brain/tools/registry.js'
import { ConversationEngine } from '../src/engine/conversation.js'
import { log } from '../src/log.js'
import { dialogues, type GoldenDialogue } from './dialogues.js'

/** Fake adapter: records outbound text per chat instead of hitting Telegram. */
class RecordingAdapter implements ChannelAdapter {
  readonly channel: Channel = 'telegram'
  readonly sent = new Map<string, string[]>()
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(msg: OutboundMessage): Promise<void> {
    const arr = this.sent.get(msg.externalChatId) ?? []
    arr.push(msg.text)
    this.sent.set(msg.externalChatId, arr)
  }
  async sendTyping(): Promise<void> {}
  lastReply(externalChatId: string): string {
    const arr = this.sent.get(externalChatId) ?? []
    return arr[arr.length - 1] ?? ''
  }
}

/** Fake notifier: records card calls (no Telegram group needed). */
class RecordingNotifier implements ManagerNotifier {
  readonly orderCards: number[] = []
  readonly escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> {
    this.orderCards.push(orderId)
  }
  async escalationCard(escalationId: number): Promise<void> {
    this.escalationCards.push(escalationId)
  }
}

interface TurnResult { dialogue: string; turn: number; status: 'PASS' | 'FAIL'; detail: string }

function buildLlm(config: ReturnType<typeof loadConfig>): LlmClient {
  const primary: ModelProfile = {
    name: 'primary',
    baseUrl: config.LLM_PRIMARY_BASE_URL,
    apiKey: config.LLM_PRIMARY_API_KEY,
    model: config.LLM_PRIMARY_MODEL,
  }
  const fallback: ModelProfile | undefined =
    config.LLM_FALLBACK_BASE_URL && config.LLM_FALLBACK_API_KEY && config.LLM_FALLBACK_MODEL
      ? {
          name: 'fallback',
          baseUrl: config.LLM_FALLBACK_BASE_URL,
          apiKey: config.LLM_FALLBACK_API_KEY,
          model: config.LLM_FALLBACK_MODEL,
        }
      : undefined
  return new LlmClient(primary, fallback)
}

const TOOLS: AgentTool<any>[] = [
  priceQuoteTool,
  knowledgeTool,
  createOrderTool,
  escalateTool,
  clientNoteTool,
]

async function getChatIdByExternal(db: Db, externalChatId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.externalChatId, externalChatId))
  return row?.id ?? null
}

async function runDialogue(
  db: Db,
  engine: ConversationEngine,
  adapter: RecordingAdapter,
  notifier: RecordingNotifier,
  dialogue: GoldenDialogue,
  index: number,
): Promise<TurnResult[]> {
  const externalChatId = `eval-${index}-${dialogue.name.replace(/\s+/g, '_').slice(0, 24)}`
  const results: TurnResult[] = []
  let msgSeq = 0

  for (let t = 0; t < dialogue.turns.length; t++) {
    const turn = dialogue.turns[t]!
    msgSeq += 1
    const inbound: InboundMessage = {
      channel: 'telegram',
      externalChatId,
      externalMessageId: `${externalChatId}-m${msgSeq}`,
      externalUserId: externalChatId,
      userDisplayName: 'Eval Client',
      text: turn.user,
      attachments: [],
    }
    await engine.handleInbound(inbound)
    const chatId = await getChatIdByExternal(db, externalChatId)
    if (chatId !== null) await engine.flushChat(chatId)

    if (!turn.expect) {
      results.push({ dialogue: dialogue.name, turn: t + 1, status: 'PASS', detail: '(no expectation)' })
      continue
    }

    const failures: string[] = []
    const reply = adapter.lastReply(externalChatId)

    if (turn.expect.escalated !== undefined) {
      const escRows = chatId === null ? [] : await db.select().from(escalations).where(eq(escalations.chatId, chatId))
      const escalated = escRows.length > 0 || notifier.escalationCards.length > 0
      if (escalated !== turn.expect.escalated) {
        failures.push(`escalated expected ${turn.expect.escalated}, got ${escalated}`)
      }
    }
    if (turn.expect.orderCreated !== undefined) {
      const orderRows = chatId === null ? [] : await db.select().from(orders).where(eq(orders.chatId, chatId))
      const created = orderRows.length > 0
      if (created !== turn.expect.orderCreated) {
        failures.push(`orderCreated expected ${turn.expect.orderCreated}, got ${created}`)
      }
    }
    if (turn.expect.replyMatches) {
      if (!new RegExp(turn.expect.replyMatches, 'i').test(reply)) {
        failures.push(`replyMatches /${turn.expect.replyMatches}/i did not match: "${reply.slice(0, 80)}"`)
      }
    }
    if (turn.expect.replyNotMatches) {
      if (new RegExp(turn.expect.replyNotMatches, 'i').test(reply)) {
        failures.push(`replyNotMatches /${turn.expect.replyNotMatches}/i unexpectedly matched: "${reply.slice(0, 80)}"`)
      }
    }

    results.push({
      dialogue: dialogue.name,
      turn: t + 1,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      detail: failures.length === 0 ? 'ok' : failures.join('; '),
    })
  }
  return results
}

async function main(): Promise<void> {
  // Use the TEST database so eval runs never touch production data.
  // `getTestDb()` is the single test-utils pool that `resetDb()` truncates (it
  // reads TEST_DATABASE_URL, default chatbot_test) — reuse it for seed + engine so
  // there is exactly one pg.Pool pointed at chatbot_test (no redundant second pool).
  const config = loadConfig()
  const db = getTestDb()

  // Optional CLI name-substring filter to stay under the free-tier daily request cap.
  // `pnpm eval -- <substring>` forwards a literal `--` separator as the first script
  // arg, so take the first non-empty arg that is not `--` (works for both
  // `pnpm eval -- листовки` and a direct `tsx eval/run-evals.ts листовки`).
  const filter = process.argv.slice(2).find((a) => a !== '--' && a.length > 0)
  const selected = filter ? dialogues.filter((d) => d.name.includes(filter)) : dialogues
  if (selected.length === 0) {
    console.error(`No dialogues match filter "${filter}". Available:`)
    for (const d of dialogues) console.error(`  - ${d.name}`)
    await closeDb(db)
    process.exit(1)
  }

  console.log(`Running ${selected.length}/${dialogues.length} golden dialogue(s) against ${config.LLM_PRIMARY_MODEL}`)
  console.log('WARNING: each turn spends real OpenRouter requests. Free tier ~50/day. Filter with: pnpm eval -- <substring>\n')

  // Fresh schema state + catalog/FAQ once for the whole run.
  // resetDb() takes no argument (contract) — it truncates the getTestDb() pool,
  // which is the same `db` used below, so seed + engine see the cleared tables.
  await resetDb()
  await seed(db, { faq: true })

  const adapter = new RecordingAdapter()
  const notifier = new RecordingNotifier()
  const llm = buildLlm(config)
  const engine = new ConversationEngine({
    db,
    llm,
    tools: TOOLS,
    notifier,
    adapters: new Map<Channel, ChannelAdapter>([['telegram', adapter]]),
    filesDir: config.FILES_DIR,
    log,
    debounceMs: 50,
  })

  const allResults: TurnResult[] = []
  for (let i = 0; i < selected.length; i++) {
    const dialogue = selected[i]!
    try {
      const results = await runDialogue(db, engine, adapter, notifier, dialogue, i)
      allResults.push(...results)
    } catch (err) {
      allResults.push({
        dialogue: dialogue.name,
        turn: 0,
        status: 'FAIL',
        detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  await engine.stop()
  await closeDb(db)

  console.table(
    allResults.map((r) => ({ dialogue: r.dialogue, turn: r.turn, status: r.status, detail: r.detail })),
  )
  const failed = allResults.filter((r) => r.status === 'FAIL')
  console.log(`\n${allResults.length - failed.length}/${allResults.length} turn-checks passed.`)
  if (failed.length > 0) {
    console.error(`${failed.length} FAILED.`)
    process.exit(1)
  }
  console.log('All selected golden dialogues passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('eval harness crashed:', err)
  process.exit(1)
})
