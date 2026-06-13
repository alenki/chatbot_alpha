import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { chats, messages } from '../db/schema.js'
import { log } from '../log.js'
import type { LlmClient } from './llm.js'

const SUMMARIZE_THRESHOLD = 40 // start summarizing above this many messages
const KEEP_VERBATIM = 20       // the newest messages runAgent sends verbatim — never compressed

const ROLE_LABELS: Record<string, string> = {
  client: 'Клиент',
  ai: 'Ассистент',
  manager: 'Менеджер',
  system: 'Система',
}

/**
 * When a chat exceeds 40 messages, compress everything except the newest 20
 * into chats.summary with a single no-tools LLM call. Messages are never
 * deleted — runAgent reads only the last 20, the summary covers the rest.
 * Failures are logged and swallowed: summarization must never block a reply.
 */
export async function maybeSummarizeHistory(db: Db, llm: LlmClient, chatId: number): Promise<void> {
  const all = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt), asc(messages.id))
  if (all.length <= SUMMARIZE_THRESHOLD) return

  const chatRows = await db.select({ summary: chats.summary }).from(chats).where(eq(chats.id, chatId))
  const existingSummary = chatRows[0]?.summary ?? ''

  const older = all.slice(0, all.length - KEEP_VERBATIM)
  const transcript = older.map((m) => `${ROLE_LABELS[m.role] ?? m.role}: ${m.content}`).join('\n')

  try {
    const res = await llm.chat(
      [
        {
          role: 'system',
          content:
            'Ты сжимаешь историю переписки клиента с типографией в краткую сводку. ' +
            'Сохрани главное: что клиент хочет заказать, согласованные характеристики, тираж, ' +
            'сроки, контакты, договорённости и открытые вопросы. ' +
            'Ответь только текстом сводки на русском, без пояснений.',
        },
        {
          role: 'user',
          content:
            `Текущая сводка:\n${existingSummary === '' ? '(пусто)' : existingSummary}\n\n` +
            `Сообщения для сжатия:\n${transcript}\n\n` +
            'Напиши обновлённую сводку.',
        },
      ],
      [],
    )
    const updated = res.content?.trim() ?? ''
    if (updated === '') return
    await db.update(chats).set({ summary: updated }).where(eq(chats.id, chatId))
  } catch (err) {
    log.error({ err, chatId }, 'history summarization failed (non-fatal)')
  }
}
