import { describe, expect, it } from 'vitest'
import type { Bot } from 'grammy'
import type { InboundMessage } from './types.js'
import { normalizeUpdate, TelegramAdapter, type DownloadFile, type TgMessageLike } from './telegram.js'

const MANAGER_GROUP = '-1001234567890'

/** Fake DownloadFile: records calls, returns a deterministic Attachment. */
function makeDownloadRecorder() {
  const calls: { fileId: string; suggestedName: string }[] = []
  const downloadFile: DownloadFile = async (fileId, suggestedName) => {
    calls.push({ fileId, suggestedName })
    return {
      path: `/data/files/telegram/uniq/${suggestedName}`,
      name: suggestedName,
      mime: 'application/octet-stream',
      size: 42,
    }
  }
  return { calls, downloadFile }
}

describe('normalizeUpdate', () => {
  it('normalizes a private text message', async () => {
    const { calls, downloadFile } = makeDownloadRecorder()
    const update: TgMessageLike = {
      message_id: 101,
      chat: { id: 555001, type: 'private' },
      from: { id: 555001, first_name: 'Иван', last_name: 'Петров', username: 'ivanp' },
      text: 'Сколько стоят визитки?',
    }

    const msg = await normalizeUpdate(update, downloadFile, MANAGER_GROUP)

    expect(msg).toEqual({
      channel: 'telegram',
      externalChatId: '555001',
      externalMessageId: '101',
      externalUserId: '555001',
      userDisplayName: 'Иван Петров',
      text: 'Сколько стоят визитки?',
      attachments: [],
    })
    expect(calls).toHaveLength(0)
  })

  it('downloads the largest photo size and keeps the caption as text', async () => {
    const { calls, downloadFile } = makeDownloadRecorder()
    const update: TgMessageLike = {
      message_id: 102,
      chat: { id: 555001, type: 'private' },
      from: { id: 555001, first_name: 'Иван' },
      caption: 'Макет визитки во вложении',
      photo: [
        // deliberately unordered: the largest must be picked by area, not position
        { file_id: 'photo-small', file_unique_id: 'us', width: 90, height: 60 },
        { file_id: 'photo-large', file_unique_id: 'ul', width: 1280, height: 853 },
        { file_id: 'photo-medium', file_unique_id: 'um', width: 320, height: 213 },
      ],
    }

    const msg = await normalizeUpdate(update, downloadFile, MANAGER_GROUP)

    expect(calls).toEqual([{ fileId: 'photo-large', suggestedName: 'photo.jpg' }])
    expect(msg?.text).toBe('Макет визитки во вложении')
    expect(msg?.attachments).toEqual([
      { path: '/data/files/telegram/uniq/photo.jpg', name: 'photo.jpg', mime: 'application/octet-stream', size: 42 },
    ])
  })

  it('downloads a document using its original file name', async () => {
    const { calls, downloadFile } = makeDownloadRecorder()
    const update: TgMessageLike = {
      message_id: 103,
      chat: { id: 555001, type: 'private' },
      from: { id: 555001, first_name: 'Иван' },
      document: { file_id: 'doc-1', file_unique_id: 'ud', file_name: 'maket.pdf', mime_type: 'application/pdf', file_size: 2048 },
    }

    const msg = await normalizeUpdate(update, downloadFile, MANAGER_GROUP)

    expect(calls).toEqual([{ fileId: 'doc-1', suggestedName: 'maket.pdf' }])
    expect(msg?.text).toBe('')                           // attachment-only message
    expect(msg?.attachments).toHaveLength(1)
    expect(msg?.attachments[0]?.name).toBe('maket.pdf')
  })

  it('returns null for messages from group chats', async () => {
    const { calls, downloadFile } = makeDownloadRecorder()
    const update: TgMessageLike = {
      message_id: 104,
      chat: { id: -200300, type: 'group' },
      from: { id: 9, first_name: 'Кто-то' },
      text: 'обычная группа',
    }

    expect(await normalizeUpdate(update, downloadFile, MANAGER_GROUP)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns null for messages from the manager group', async () => {
    const { downloadFile } = makeDownloadRecorder()
    const update: TgMessageLike = {
      message_id: 105,
      chat: { id: -1001234567890, type: 'supergroup' },
      from: { id: 10, first_name: 'Менеджер' },
      text: 'внутренний чат менеджеров',
    }

    expect(await normalizeUpdate(update, downloadFile, MANAGER_GROUP)).toBeNull()
  })
})

describe('TelegramAdapter', () => {
  function makeStubBot() {
    const sendMessageCalls: { chatId: number | string; text: string; other: unknown }[] = []
    const sendChatActionCalls: { chatId: number | string; action: string }[] = []
    let messageHandler: ((ctx: { message: TgMessageLike }) => Promise<void>) | undefined
    const bot = {
      api: {
        sendMessage: async (chatId: number | string, text: string, other?: unknown) => {
          sendMessageCalls.push({ chatId, text, other })
          return {}
        },
        sendChatAction: async (chatId: number | string, action: string) => {
          sendChatActionCalls.push({ chatId, action })
          return true
        },
      },
      on: (_event: string, handler: (ctx: { message: TgMessageLike }) => Promise<void>) => {
        messageHandler = handler
      },
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    }
    return {
      bot: bot as unknown as Bot,
      sendMessageCalls,
      sendChatActionCalls,
      getMessageHandler: () => messageHandler,
    }
  }

  const opts = { filesDir: './data/files', managerGroupChatId: MANAGER_GROUP }

  it('send() delivers plain text with no parse_mode', async () => {
    const { bot, sendMessageCalls } = makeStubBot()
    const adapter = new TelegramAdapter(bot, opts)

    await adapter.send({ channel: 'telegram', externalChatId: '555001', text: 'Цена *предварительная*, менеджер подтвердит' })

    expect(sendMessageCalls).toEqual([
      { chatId: '555001', text: 'Цена *предварительная*, менеджер подтвердит', other: undefined },
    ])
  })

  it('sendTyping() sends the "typing" chat action', async () => {
    const { bot, sendChatActionCalls } = makeStubBot()
    const adapter = new TelegramAdapter(bot, opts)

    await adapter.sendTyping('555001')

    expect(sendChatActionCalls).toEqual([{ chatId: '555001', action: 'typing' }])
  })

  it('start() wires bot messages through normalizeUpdate to onMessage and drops non-private chats', async () => {
    const { bot, getMessageHandler } = makeStubBot()
    const adapter = new TelegramAdapter(bot, opts)
    const received: InboundMessage[] = []

    await adapter.start(async (msg) => { received.push(msg) })
    const handler = getMessageHandler()
    expect(handler).toBeDefined()

    await handler!({ message: { message_id: 7, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Анна' }, text: 'Привет' } })
    await handler!({ message: { message_id: 8, chat: { id: -55, type: 'group' }, from: { id: 1, first_name: 'X' }, text: 'spam' } })

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ channel: 'telegram', externalChatId: '42', externalMessageId: '7', text: 'Привет' })

    await adapter.stop()
  })
})
