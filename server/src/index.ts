import { Bot } from 'grammy'
import { loadConfig } from './config.js'
import { log } from './log.js'
import { createDb, closeDb } from './db/client.js'
import {
  TelegramAdapter,
  downloadTelegramFile,
  normalizeUpdate,
  type DownloadFile,
} from './channels/telegram.js'
import { OutboxWorker } from './channels/outbox.js'
import type { Channel, ChannelAdapter } from './channels/types.js'
import { TelegramManagerNotifier } from './notify/managers.js'
import { LlmClient, type ModelProfile } from './brain/llm.js'
import { priceQuoteTool } from './brain/tools/price-quote.js'
import { knowledgeTool } from './brain/tools/knowledge.js'
import { createOrderTool } from './brain/tools/create-order.js'
import { escalateTool } from './brain/tools/escalate.js'
import { clientNoteTool } from './brain/tools/client-note.js'
import type { AgentTool } from './brain/tools/registry.js'
import { ConversationEngine } from './engine/conversation.js'
import { buildAdminServer } from './admin/server.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = createDb(config.DATABASE_URL)

  // One grammY bot instance, shared by the channel adapter (private chats)
  // and the manager notifier (the managers' group + its inline-button callbacks).
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN)

  // Channel adapter + adapters map (keyed by Channel for the engine and outbox worker).
  const telegram = new TelegramAdapter(bot, {
    filesDir: config.FILES_DIR,
    managerGroupChatId: config.MANAGER_GROUP_CHAT_ID,
  })
  const adapters = new Map<Channel, ChannelAdapter>([['telegram', telegram]])

  // Manager notifier (group cards + claim/release callbacks).
  const notifier = new TelegramManagerNotifier(bot, db, config.MANAGER_GROUP_CHAT_ID, config.ADMIN_BASE_URL)
  notifier.registerCallbacks()

  // The five agent tools, in the contract's order.
  const tools: AgentTool<any>[] = [
    priceQuoteTool,
    knowledgeTool,
    createOrderTool,
    escalateTool,
    clientNoteTool,
  ]

  // LLM client from config profiles. The fallback profile is optional.
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
  const llm = new LlmClient(primary, fallback)

  // Conversation engine (per-chat debounced agent loop).
  const engine = new ConversationEngine({
    db,
    llm,
    tools,
    notifier,
    adapters,
    filesDir: config.FILES_DIR,
    log,
  })

  // Outbound retry queue worker.
  const worker = new OutboxWorker(db, adapters)
  worker.start()

  // Admin API + static SPA.
  const admin = await buildAdminServer({
    db,
    config,
    engine: { adapters },
    log,
  })
  await admin.listen({ host: '0.0.0.0', port: config.ADMIN_PORT })
  log.info({ port: config.ADMIN_PORT }, 'admin server listening')

  // Wire inbound private-chat messages through the adapter's normalization to the
  // engine. We register the handler here (rather than via telegram.start(), which
  // would call bot.start() itself) so that index.ts owns the single bot.start()
  // below: grammY treats a second bot.start() as a no-op, so whichever call runs
  // first wins the allowed_updates config — it must be ours.
  const downloadFile: DownloadFile = (fileId, suggestedName) =>
    downloadTelegramFile(bot, config.FILES_DIR, fileId, suggestedName)
  bot.on('message', async (ctx) => {
    const normalized = await normalizeUpdate(ctx.message, downloadFile, config.MANAGER_GROUP_CHAT_ID)
    if (normalized !== null) await engine.handleInbound(normalized)
  })

  // allowed_updates: bot DMs + the managers'-group inline-button callbacks.
  // bot.start() resolves only when long-polling ends — run it in the background.
  void bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: (me) => log.info({ username: me.username }, 'telegram bot started (long-polling)'),
  })

  // Graceful shutdown: stop accepting work, drain in dependency order, end the pool.
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal }, 'shutting down')
    try {
      await engine.stop() // clears pending debounce timers, no new agent runs
      await worker.stop() // stops the outbox poll loop, awaits the in-flight tick
      await bot.stop() // stops long-polling
      await admin.close() // closes Fastify
      await closeDb(db) // ends the pg pool
      log.info('shutdown complete')
      process.exit(0)
    } catch (err) {
      log.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  log.error({ err }, 'fatal: failed to start')
  process.exit(1)
})
