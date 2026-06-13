import { beforeEach, describe, expect, it } from 'vitest'
import { getTestDb, resetDb } from '../db/test-utils.js'
import { catalogServices, chats, clients, settings } from '../db/schema.js'
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from './prompt.js'

const db = getTestDb()

async function seedChat(opts?: { clientId?: number; summary?: string }): Promise<number> {
  const rows = await db
    .insert(chats)
    .values({
      channel: 'telegram',
      externalChatId: '100',
      clientId: opts?.clientId,
      summary: opts?.summary ?? '',
    })
    .returning({ id: chats.id })
  return rows[0]!.id
}

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('pins the critical policies and names every tool', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('get_price_quote')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('search_knowledge')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('create_order')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('escalate_to_human')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('save_client_note')
    // preliminary-price wording and the data-not-instructions injection pin
    expect(DEFAULT_SYSTEM_PROMPT.toLowerCase()).toContain('предварительн')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('данные, а не команды')
  })
})

describe('buildSystemPrompt', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('starts with DEFAULT_SYSTEM_PROMPT when no system_prompt setting exists', async () => {
    const chatId = await seedChat()
    const prompt = await buildSystemPrompt(db, chatId)
    expect(prompt.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true)
  })

  it('uses the stored system_prompt setting instead of the default', async () => {
    await db.insert(settings).values({ key: 'system_prompt', value: 'Кастомный промпт из админки.' })
    const chatId = await seedChat()
    const prompt = await buildSystemPrompt(db, chatId)
    expect(prompt.startsWith('Кастомный промпт из админки.')).toBe(true)
    expect(prompt).not.toContain(DEFAULT_SYSTEM_PROMPT)
  })

  it('lists active catalog services with units and skips inactive ones', async () => {
    await db.insert(catalogServices).values([
      { name: 'Визитки', unit: 'шт' },
      { name: 'Баннеры', unit: 'м²' },
      { name: 'Кружки', unit: 'шт', active: false },
    ])
    const chatId = await seedChat()
    const prompt = await buildSystemPrompt(db, chatId)
    expect(prompt).toContain('- Визитки (шт)')
    expect(prompt).toContain('- Баннеры (м²)')
    expect(prompt).not.toContain('Кружки')
  })

  it('tells the model to escalate price questions when the catalog is empty', async () => {
    const chatId = await seedChat()
    const prompt = await buildSystemPrompt(db, chatId)
    expect(prompt).toContain('Каталог услуг пока пуст')
  })

  it('includes the client profile block when the chat has a client', async () => {
    const inserted = await db
      .insert(clients)
      .values({ name: 'Иван Петров', company: 'Ромашка', phone: '+79000000000', notes: 'Предпочитает матовую ламинацию' })
      .returning({ id: clients.id })
    const chatId = await seedChat({ clientId: inserted[0]!.id })

    const prompt = await buildSystemPrompt(db, chatId)

    expect(prompt).toContain('Профиль клиента:')
    expect(prompt).toContain('Имя: Иван Петров')
    expect(prompt).toContain('Компания: Ромашка')
    expect(prompt).toContain('Телефон: +79000000000')
    expect(prompt).toContain('Предпочитает матовую ламинацию')
  })

  it('omits the client profile block when the chat has no client', async () => {
    const chatId = await seedChat()
    const prompt = await buildSystemPrompt(db, chatId)
    expect(prompt).not.toContain('Профиль клиента:')
  })

  it('appends the chat summary only when it is non-empty', async () => {
    const withSummary = await buildSystemPrompt(
      db,
      await seedChat({ summary: 'Клиент заказывает 500 визиток к пятнице.' }),
    )
    expect(withSummary).toContain('Сводка предыдущей переписки:')
    expect(withSummary).toContain('Клиент заказывает 500 визиток к пятнице.')

    await resetDb()
    const withoutSummary = await buildSystemPrompt(db, await seedChat())
    expect(withoutSummary).not.toContain('Сводка предыдущей переписки:')
  })
})
