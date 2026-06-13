import { beforeEach, describe, expect, it } from 'vitest'
import type { Bot } from 'grammy'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { chats, clients, escalations, orders } from '../db/schema.js'
import { TelegramManagerNotifier } from './managers.js'

const db = getTestDb()
const GROUP_CHAT_ID = '-1001234567890'
const ADMIN_BASE_URL = 'http://localhost:8080'

type RecordedHandler = (ctx: unknown) => Promise<void> | void

/** Stub grammY bot: records api.sendMessage calls and captures callbackQuery handlers. */
function makeStubBot() {
  const sendMessageCalls: { chatId: string | number; text: string; other?: unknown }[] = []
  const callbackHandlers: { trigger: RegExp; handler: RecordedHandler }[] = []
  const bot = {
    api: {
      sendMessage: async (chatId: string | number, text: string, other?: unknown) => {
        sendMessageCalls.push({ chatId, text, other })
        return {}
      },
    },
    callbackQuery: (trigger: RegExp, handler: RecordedHandler) => {
      callbackHandlers.push({ trigger, handler })
    },
  }
  return { bot: bot as unknown as Bot, sendMessageCalls, callbackHandlers }
}

/** Fake grammY callback context for invoking captured handlers directly. */
function makeCallbackCtx(
  data: string,
  trigger: RegExp,
  from: { id: number; first_name: string; last_name?: string },
  originalText: string,
) {
  const edits: { text: string; other?: unknown }[] = []
  let answerCount = 0
  const ctx = {
    match: data.match(trigger),
    from,
    callbackQuery: { data, message: { text: originalText } },
    editMessageText: async (text: string, other?: unknown) => {
      edits.push({ text, other })
      return true
    },
    answerCallbackQuery: async () => {
      answerCount += 1
      return true
    },
  }
  return { ctx, edits, getAnswerCount: () => answerCount }
}

function expectedKeyboard(chatId: number) {
  return {
    inline_keyboard: [
      [{ text: 'Беру', callback_data: `claim:${chatId}` }],
      [{ text: 'Вернуть боту', callback_data: `release:${chatId}` }],
    ],
  }
}

async function seedChat(overrides: Partial<typeof chats.$inferInsert> = {}, withClient = true) {
  let clientId: number | null = null
  if (withClient) {
    const [client] = await db
      .insert(clients)
      .values({ name: 'Иван Петров', phone: '+79991234567' })
      .returning()
    clientId = client!.id
  }
  const [chat] = await db
    .insert(chats)
    .values({ channel: 'telegram', externalChatId: '555001', clientId, ...overrides })
    .returning()
  return chat!
}

beforeEach(async () => {
  await resetDb()
})

describe('TelegramManagerNotifier cards', () => {
  it('orderCard sends a Russian card with order fields, deep link and claim/release buttons', async () => {
    const chat = await seedChat()
    const [order] = await db
      .insert(orders)
      .values({
        chatId: chat.id,
        clientId: chat.clientId,
        serviceType: 'Визитки',
        specs: { 'Бумага': 'мелованная 300г', 'Цвет': '4+4' },
        quantity: 500,
        deadline: 'до пятницы',
        contact: '+7 999 123-45-67',
      })
      .returning()
    const { bot, sendMessageCalls } = makeStubBot()
    const notifier = new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL)

    await notifier.orderCard(order!.id)

    expect(sendMessageCalls).toHaveLength(1)
    const call = sendMessageCalls[0]!
    expect(call.chatId).toBe(GROUP_CHAT_ID)
    // specs lines are sorted by key ('Бумага' < 'Цвет') — Postgres jsonb does not preserve insertion order
    expect(call.text).toBe(
      [
        `🆕 Новый заказ #${order!.id}`,
        'Услуга: Визитки',
        'Тираж: 500',
        'Срок: до пятницы',
        'Бумага: мелованная 300г',
        'Цвет: 4+4',
        'Контакт: +7 999 123-45-67',
        'Клиент: Иван Петров',
        'Канал: telegram',
        `${ADMIN_BASE_URL}/chats/${chat.id}`,
      ].join('\n'),
    )
    expect(call.other).toEqual({ reply_markup: expectedKeyboard(chat.id) })
  })

  it('orderCard falls back to "—" for missing quantity, deadline and client', async () => {
    const chat = await seedChat({}, false)
    const [order] = await db
      .insert(orders)
      .values({ chatId: chat.id, serviceType: 'Листовки', specs: {}, contact: 'tg: @ivan' })
      .returning()
    const { bot, sendMessageCalls } = makeStubBot()
    const notifier = new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL)

    await notifier.orderCard(order!.id)

    expect(sendMessageCalls[0]!.text).toBe(
      [
        `🆕 Новый заказ #${order!.id}`,
        'Услуга: Листовки',
        'Тираж: —',
        'Срок: —',
        'Контакт: tg: @ivan',
        'Клиент: —',
        'Канал: telegram',
        `${ADMIN_BASE_URL}/chats/${chat.id}`,
      ].join('\n'),
    )
  })

  it('escalationCard sends reason, summary, client and channel with the deep link', async () => {
    const chat = await seedChat()
    const [esc] = await db
      .insert(escalations)
      .values({
        chatId: chat.id,
        reason: 'Клиент попросил человека',
        summary: 'Клиент хочет обсудить макет голосом',
      })
      .returning()
    const { bot, sendMessageCalls } = makeStubBot()
    const notifier = new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL)

    await notifier.escalationCard(esc!.id)

    expect(sendMessageCalls).toHaveLength(1)
    expect(sendMessageCalls[0]!.chatId).toBe(GROUP_CHAT_ID)
    expect(sendMessageCalls[0]!.text).toBe(
      [
        `🚨 Эскалация #${esc!.id}`,
        'Причина: Клиент попросил человека',
        'Резюме: Клиент хочет обсудить макет голосом',
        'Клиент: Иван Петров',
        'Канал: telegram',
        `${ADMIN_BASE_URL}/chats/${chat.id}`,
      ].join('\n'),
    )
    expect(sendMessageCalls[0]!.other).toEqual({ reply_markup: expectedKeyboard(chat.id) })
  })

  it('escalationCard prints "—" for a blank summary', async () => {
    const chat = await seedChat()
    const [esc] = await db
      .insert(escalations)
      .values({ chatId: chat.id, reason: 'Достигнут дневной лимит ответов ИИ', summary: '' })
      .returning()
    const { bot, sendMessageCalls } = makeStubBot()
    const notifier = new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL)

    await notifier.escalationCard(esc!.id)

    expect(sendMessageCalls[0]!.text).toContain('Резюме: —')
  })
})

describe('TelegramManagerNotifier callbacks', () => {
  it('registerCallbacks registers exactly the claim and release handlers', () => {
    const { bot, callbackHandlers } = makeStubBot()
    new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL).registerCallbacks()
    expect(callbackHandlers.map((h) => h.trigger.source)).toEqual(['^claim:(\\d+)$', '^release:(\\d+)$'])
  })

  it('claim sets status=human, resolves only this chat open escalations, edits the card and answers', async () => {
    const chat = await seedChat({ botPaused: true })
    const [otherChat] = await db
      .insert(chats)
      .values({ channel: 'telegram', externalChatId: '666002' })
      .returning()
    const [open] = await db
      .insert(escalations)
      .values({ chatId: chat.id, reason: 'Клиент попросил человека', summary: 'Хочу человека' })
      .returning()
    const [alreadyResolved] = await db
      .insert(escalations)
      .values({
        chatId: chat.id,
        reason: 'Старое обращение',
        resolvedBy: 'Пётр',
        resolvedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .returning()
    const [foreign] = await db
      .insert(escalations)
      .values({ chatId: otherChat!.id, reason: 'Другой чат' })
      .returning()
    const { bot, callbackHandlers } = makeStubBot()
    new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL).registerCallbacks()
    const claim = callbackHandlers.find((h) => h.trigger.source.startsWith('^claim'))!
    const { ctx, edits, getAnswerCount } = makeCallbackCtx(
      `claim:${chat.id}`,
      claim.trigger,
      { id: 9001, first_name: 'Мария', last_name: 'Иванова' },
      '🚨 Эскалация #1',
    )

    await claim.handler(ctx)

    const [updatedChat] = await db.select().from(chats).where(eq(chats.id, chat.id))
    expect(updatedChat!.status).toBe('human')
    expect(updatedChat!.botPaused).toBe(true) // claim never resumes the bot

    const [openRow] = await db.select().from(escalations).where(eq(escalations.id, open!.id))
    expect(openRow!.resolvedBy).toBe('Мария Иванова')
    expect(openRow!.resolvedAt).toBeInstanceOf(Date)

    const [resolvedRow] = await db.select().from(escalations).where(eq(escalations.id, alreadyResolved!.id))
    expect(resolvedRow!.resolvedBy).toBe('Пётр') // already-resolved row untouched

    const [foreignRow] = await db.select().from(escalations).where(eq(escalations.id, foreign!.id))
    expect(foreignRow!.resolvedAt).toBeNull() // other chats untouched

    expect(edits).toEqual([
      {
        text: '🚨 Эскалация #1\n\n✅ Взял(а): Мария Иванова',
        other: { reply_markup: expectedKeyboard(chat.id) },
      },
    ])
    expect(getAnswerCount()).toBe(1)
  })

  it('claim uses just the first name when there is no last name', async () => {
    const chat = await seedChat({ botPaused: true })
    await db.insert(escalations).values({ chatId: chat.id, reason: 'Клиент попросил человека' })
    const { bot, callbackHandlers } = makeStubBot()
    new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL).registerCallbacks()
    const claim = callbackHandlers.find((h) => h.trigger.source.startsWith('^claim'))!
    const { ctx, edits } = makeCallbackCtx(
      `claim:${chat.id}`,
      claim.trigger,
      { id: 9003, first_name: 'Олег' },
      '🚨 Эскалация #1',
    )

    await claim.handler(ctx)

    const [openRow] = await db.select().from(escalations)
    expect(openRow!.resolvedBy).toBe('Олег')
    expect(edits[0]!.text).toBe('🚨 Эскалация #1\n\n✅ Взял(а): Олег')
  })

  it('release unpauses the bot, sets status=ai, edits the card and answers', async () => {
    const chat = await seedChat({ botPaused: true, status: 'human' })
    const { bot, callbackHandlers } = makeStubBot()
    new TelegramManagerNotifier(bot, db, GROUP_CHAT_ID, ADMIN_BASE_URL).registerCallbacks()
    const release = callbackHandlers.find((h) => h.trigger.source.startsWith('^release'))!
    const { ctx, edits, getAnswerCount } = makeCallbackCtx(
      `release:${chat.id}`,
      release.trigger,
      { id: 9002, first_name: 'Олег' },
      '🆕 Новый заказ #1',
    )

    await release.handler(ctx)

    const [updatedChat] = await db.select().from(chats).where(eq(chats.id, chat.id))
    expect(updatedChat!.botPaused).toBe(false)
    expect(updatedChat!.status).toBe('ai')
    expect(edits).toEqual([
      {
        text: '🆕 Новый заказ #1\n\n🤖 Возвращён боту',
        other: { reply_markup: expectedKeyboard(chat.id) },
      },
    ])
    expect(getAnswerCount()).toBe(1)
  })
})
