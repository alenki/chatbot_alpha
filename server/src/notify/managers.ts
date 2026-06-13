import type { Bot } from 'grammy'
import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { chats, clients, escalations, orders } from '../db/schema.js'

/**
 * Posts notification cards to the managers' Telegram group.
 * Tools and the agent depend only on this interface; the Telegram-backed
 * TelegramManagerNotifier implementation is added in Task 11 (same file).
 */
export interface ManagerNotifier {
  orderCard(orderId: number): Promise<void>
  escalationCard(escalationId: number): Promise<void>
}

/** Inline keyboard shown under every manager card. */
function claimReleaseKeyboard(chatId: number): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return {
    inline_keyboard: [
      [{ text: 'Беру', callback_data: `claim:${chatId}` }],
      [{ text: 'Вернуть боту', callback_data: `release:${chatId}` }],
    ],
  }
}

/** Extracts the original card text from a callback's message, tolerating inaccessible messages. */
function originalCardText(message: unknown): string {
  if (typeof message === 'object' && message !== null && 'text' in message) {
    const text = (message as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

/** "First Last" from a Telegram user, falling back to just the first name. */
function clickerName(from: { first_name: string; last_name?: string } | undefined): string {
  if (from === undefined) return 'Менеджер'
  return [from.first_name, from.last_name].filter((p) => p !== undefined && p !== '').join(' ')
}

export class TelegramManagerNotifier implements ManagerNotifier {
  private readonly bot: Bot
  private readonly db: Db
  private readonly groupChatId: string
  private readonly adminBaseUrl: string

  constructor(bot: Bot, db: Db, groupChatId: string, adminBaseUrl: string) {
    this.bot = bot
    this.db = db
    this.groupChatId = groupChatId
    this.adminBaseUrl = adminBaseUrl
  }

  private async chatInfo(chatId: number): Promise<{ channel: string; clientName: string }> {
    const [chat] = await this.db.select().from(chats).where(eq(chats.id, chatId))
    if (chat === undefined) throw new Error(`chat ${chatId} not found`)
    let clientName = '—'
    if (chat.clientId !== null) {
      const [client] = await this.db.select().from(clients).where(eq(clients.id, chat.clientId))
      if (client !== undefined && client.name !== null && client.name !== '') clientName = client.name
    }
    return { channel: chat.channel, clientName }
  }

  private async sendCard(chatId: number, lines: string[]): Promise<void> {
    const text = [...lines, `${this.adminBaseUrl}/chats/${chatId}`].join('\n')
    await this.bot.api.sendMessage(this.groupChatId, text, {
      reply_markup: claimReleaseKeyboard(chatId),
    })
  }

  async orderCard(orderId: number): Promise<void> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId))
    if (order === undefined) throw new Error(`order ${orderId} not found`)
    const { channel, clientName } = await this.chatInfo(order.chatId)
    // Postgres jsonb does not preserve key insertion order — sort for stable, predictable cards.
    const specLines = Object.entries(order.specs)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}: ${value}`)
    await this.sendCard(order.chatId, [
      `🆕 Новый заказ #${orderId}`,
      `Услуга: ${order.serviceType}`,
      `Тираж: ${order.quantity ?? '—'}`,
      `Срок: ${order.deadline ?? '—'}`,
      ...specLines,
      `Контакт: ${order.contact}`,
      `Клиент: ${clientName}`,
      `Канал: ${channel}`,
    ])
  }

  async escalationCard(escalationId: number): Promise<void> {
    const [esc] = await this.db.select().from(escalations).where(eq(escalations.id, escalationId))
    if (esc === undefined) throw new Error(`escalation ${escalationId} not found`)
    const { channel, clientName } = await this.chatInfo(esc.chatId)
    await this.sendCard(esc.chatId, [
      `🚨 Эскалация #${escalationId}`,
      `Причина: ${esc.reason}`,
      `Резюме: ${esc.summary === '' ? '—' : esc.summary}`,
      `Клиент: ${clientName}`,
      `Канал: ${channel}`,
    ])
  }

  /** Wire the claim/release inline-button handlers. Call once at startup, before bot.start(). */
  registerCallbacks(): void {
    this.bot.callbackQuery(/^claim:(\d+)$/, async (ctx) => {
      const chatId = Number(ctx.match?.[1])
      if (!Number.isInteger(chatId)) {
        await ctx.answerCallbackQuery()
        return
      }
      const name = clickerName(ctx.from)
      // status -> human; claim never resumes the bot (botPaused untouched).
      await this.db.update(chats).set({ status: 'human' }).where(eq(chats.id, chatId))
      // Resolve every still-open escalation for THIS chat, stamping the clicker as resolver.
      await this.db
        .update(escalations)
        .set({ resolvedAt: new Date(), resolvedBy: name })
        .where(and(eq(escalations.chatId, chatId), isNull(escalations.resolvedAt)))
      const original = originalCardText(ctx.callbackQuery.message)
      await ctx.editMessageText(`${original}\n\n✅ Взял(а): ${name}`, {
        reply_markup: claimReleaseKeyboard(chatId),
      })
      await ctx.answerCallbackQuery()
    })

    this.bot.callbackQuery(/^release:(\d+)$/, async (ctx) => {
      const chatId = Number(ctx.match?.[1])
      if (!Number.isInteger(chatId)) {
        await ctx.answerCallbackQuery()
        return
      }
      await this.db.update(chats).set({ botPaused: false, status: 'ai' }).where(eq(chats.id, chatId))
      const original = originalCardText(ctx.callbackQuery.message)
      await ctx.editMessageText(`${original}\n\n🤖 Возвращён боту`, {
        reply_markup: claimReleaseKeyboard(chatId),
      })
      await ctx.answerCallbackQuery()
    })
  }
}
