import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Bot } from 'grammy'
import type { Attachment, ChannelAdapter, InboundMessage, OutboundMessage } from './types.js'

/** Downloads one Telegram file and returns its stored Attachment. Injected into normalizeUpdate so tests need no live bot. */
export type DownloadFile = (fileId: string, suggestedName: string) => Promise<Attachment>

/** Minimal structural slice of a Telegram Bot API Message — grammY's ctx.message satisfies it. */
export interface TgPhotoSize { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }
export interface TgDocument { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number }
export interface TgMessageLike {
  message_id: number
  chat: { id: number; type: string }
  from?: { id: number; first_name?: string; last_name?: string; username?: string }
  text?: string
  caption?: string
  photo?: TgPhotoSize[]
  document?: TgDocument
}

/**
 * Pure normalization of a Telegram message into an InboundMessage.
 * Returns null for anything that is not a private client chat:
 * the managers' group (internal traffic) and all other group/channel chats.
 */
export async function normalizeUpdate(
  update: TgMessageLike,
  downloadFile: DownloadFile,
  managerGroupChatId: string,
): Promise<InboundMessage | null> {
  if (String(update.chat.id) === managerGroupChatId) return null   // managers' group is never client traffic
  if (update.chat.type !== 'private') return null                  // the standalone bot only serves private chats

  const attachments: Attachment[] = []
  if (update.photo !== undefined && update.photo.length > 0) {
    // Telegram sends several sizes of the same photo; keep only the largest by pixel area.
    const largest = update.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    attachments.push(await downloadFile(largest.file_id, 'photo.jpg'))
  }
  if (update.document !== undefined) {
    attachments.push(await downloadFile(update.document.file_id, update.document.file_name ?? 'document'))
  }

  const from = update.from
  const displayName = from === undefined ? '' : [from.first_name, from.last_name].filter(Boolean).join(' ')

  return {
    channel: 'telegram',
    externalChatId: String(update.chat.id),
    externalMessageId: String(update.message_id),
    externalUserId: String(from?.id ?? update.chat.id),
    userDisplayName: displayName === '' ? undefined : displayName,
    text: update.text ?? update.caption ?? '',
    attachments,
  }
}

/** Strips path components and characters invalid on Windows from a client-supplied file name. */
function safeFileName(suggestedName: string): string {
  const base = path.basename(suggestedName).replace(/[\\/:*?"<>|]/g, '_').trim()
  return base === '' ? 'file' : base
}

/**
 * Real DownloadFile implementation: bot.api.getFile + fetch from
 * https://api.telegram.org/file/bot<token>/<file_path>.
 * Saves to filesDir/telegram/<file_unique_id>/<name>.
 */
export async function downloadTelegramFile(bot: Bot, filesDir: string, fileId: string, suggestedName: string): Promise<Attachment> {
  const file = await bot.api.getFile(fileId)
  if (file.file_path === undefined) throw new Error(`telegram getFile returned no file_path for ${fileId}`)
  const res = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`)
  if (!res.ok) throw new Error(`telegram file download failed: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const name = safeFileName(suggestedName)
  const dir = path.join(filesDir, 'telegram', file.file_unique_id)
  await mkdir(dir, { recursive: true })
  const fullPath = path.join(dir, name)
  await writeFile(fullPath, bytes)
  return {
    path: fullPath,
    name,
    mime: res.headers.get('content-type') ?? 'application/octet-stream',
    size: bytes.byteLength,
  }
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram' as const
  private readonly bot: Bot
  private readonly filesDir: string
  private readonly managerGroupChatId: string
  private started = false

  constructor(bot: Bot, opts: { filesDir: string; managerGroupChatId: string }) {
    this.bot = bot
    this.filesDir = opts.filesDir
    this.managerGroupChatId = opts.managerGroupChatId
  }

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const downloadFile: DownloadFile = (fileId, suggestedName) =>
      downloadTelegramFile(this.bot, this.filesDir, fileId, suggestedName)
    this.bot.on('message', async (ctx) => {
      const normalized = await normalizeUpdate(ctx.message, downloadFile, this.managerGroupChatId)
      if (normalized !== null) await onMessage(normalized)
    })
    this.started = true
    // bot.start() resolves only when long-polling ends — run it in the background, never await it here.
    this.bot.start().catch((err: unknown) => {
      console.error('telegram long-polling stopped with error', err)
    })
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    await this.bot.stop()
  }

  async send(msg: OutboundMessage): Promise<void> {
    // No parse_mode: Telegram renders the text exactly as written (no Markdown parsing surprises).
    await this.bot.api.sendMessage(msg.externalChatId, msg.text)
  }

  async sendTyping(externalChatId: string): Promise<void> {
    await this.bot.api.sendChatAction(externalChatId, 'typing')
  }
}
