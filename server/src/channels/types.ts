export type Channel = 'telegram' | 'max' | 'whatsapp'

export interface Attachment { path: string; name: string; mime: string; size: number }

export interface InboundMessage {
  channel: Channel
  externalChatId: string
  externalMessageId: string
  externalUserId: string
  userDisplayName?: string
  phone?: string
  text: string                     // '' when attachment-only
  attachments: Attachment[]
}

export interface OutboundMessage { channel: Channel; externalChatId: string; text: string }

export interface ChannelAdapter {
  readonly channel: Channel
  start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>
  stop(): Promise<void>
  send(msg: OutboundMessage): Promise<void>
  sendTyping(externalChatId: string): Promise<void>
}
