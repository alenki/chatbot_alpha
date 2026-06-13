import { pgTable, bigserial, bigint, text, timestamp, boolean, integer, jsonb, date, numeric, vector, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const clients = pgTable('clients', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name'),
  phone: text('phone'),
  company: text('company'),
  notes: text('notes').default('').notNull(),           // AI-appended facts, newline-separated
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const chats = pgTable('chats', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  channel: text('channel').notNull(),                    // 'telegram' | 'max' | 'whatsapp'
  externalChatId: text('external_chat_id').notNull(),
  clientId: bigint('client_id', { mode: 'number' }).references(() => clients.id),
  botPaused: boolean('bot_paused').default(false).notNull(),
  status: text('status').default('ai').notNull(),        // 'ai' | 'human' | 'closed'
  summary: text('summary').default('').notNull(),        // running history summary
  aiTurnsToday: integer('ai_turns_today').default(0).notNull(),
  aiTurnsDate: date('ai_turns_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('chats_channel_external_uq').on(t.channel, t.externalChatId)])

export const messages = pgTable('messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chatId: bigint('chat_id', { mode: 'number' }).references(() => chats.id).notNull(),
  role: text('role').notNull(),                          // 'client' | 'ai' | 'manager' | 'system'
  content: text('content').default('').notNull(),
  attachments: jsonb('attachments').$type<{ path: string; name: string; mime: string; size: number }[]>().default([]).notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  externalMessageId: text('external_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('messages_chat_idx').on(t.chatId, t.createdAt)])

export const processedUpdates = pgTable('processed_updates', {
  channel: text('channel').notNull(),
  updateId: text('update_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.channel, t.updateId] })])

export const orders = pgTable('orders', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chatId: bigint('chat_id', { mode: 'number' }).references(() => chats.id).notNull(),
  clientId: bigint('client_id', { mode: 'number' }).references(() => clients.id),
  serviceType: text('service_type').notNull(),
  specs: jsonb('specs').$type<Record<string, string>>().default({}).notNull(),
  quantity: integer('quantity'),
  deadline: text('deadline'),
  contact: text('contact').notNull(),
  files: jsonb('files').$type<{ path: string; name: string; mime: string; size: number }[]>().default([]).notNull(),
  status: text('status').default('new').notNull(),       // 'new' | 'confirmed' | 'in_work' | 'done'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const catalogServices = pgTable('catalog_services', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),                          // "Визитки"
  aliases: jsonb('aliases').$type<string[]>().default([]).notNull(),  // ["визитка", "business cards"]
  description: text('description').default('').notNull(),
  unit: text('unit').default('шт').notNull(),
  active: boolean('active').default(true).notNull(),
})

export const catalogOptions = pgTable('catalog_options', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  serviceId: bigint('service_id', { mode: 'number' }).references(() => catalogServices.id).notNull(),
  optionGroup: text('option_group').notNull(),           // "material" | "finishing" | ...
  name: text('name').notNull(),                          // "Ламинация матовая"
  priceDelta: numeric('price_delta', { precision: 12, scale: 2 }).default('0').notNull(),  // per-unit RUB add
})

export const catalogPriceTiers = pgTable('catalog_price_tiers', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  serviceId: bigint('service_id', { mode: 'number' }).references(() => catalogServices.id).notNull(),
  minQty: integer('min_qty').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),  // RUB per unit at this tier
})

export const faqChunks = pgTable('faq_chunks', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 384 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const escalations = pgTable('escalations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chatId: bigint('chat_id', { mode: 'number' }).references(() => chats.id).notNull(),
  reason: text('reason').notNull(),
  summary: text('summary').default('').notNull(),
  resolvedBy: text('resolved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export const outbox = pgTable('outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chatId: bigint('chat_id', { mode: 'number' }).references(() => chats.id).notNull(),
  payload: jsonb('payload').$type<{ channel: string; externalChatId: string; text: string }>().notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),                         // 'system_prompt' | 'escalation_keywords' | 'daily_turn_cap'
  value: jsonb('value').notNull(),
})
