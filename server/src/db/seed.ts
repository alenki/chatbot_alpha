import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { createDb, type Db } from './client.js'
import {
  catalogOptions,
  catalogPriceTiers,
  catalogServices,
  faqChunks,
  settings,
} from './schema.js'
import { DEFAULT_SYSTEM_PROMPT } from '../brain/prompt.js'
import { DEFAULT_ESCALATION_KEYWORDS } from '../engine/escalation.js'
import { upsertFaqChunk } from '../knowledge/faq.js'
import { log } from '../log.js'

/** Idempotent upsert of a settings row keyed by `key`. */
async function upsertSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
}

/** Returns the id of a catalog service by name, creating it idempotently. */
async function upsertService(
  db: Db,
  svc: { name: string; aliases: string[]; unit: string; description?: string },
): Promise<number> {
  const [existing] = await db
    .select()
    .from(catalogServices)
    .where(eq(catalogServices.name, svc.name))
  if (existing) {
    await db
      .update(catalogServices)
      .set({ aliases: svc.aliases, unit: svc.unit, description: svc.description ?? '', active: true })
      .where(eq(catalogServices.id, existing.id))
    return existing.id
  }
  const [created] = await db
    .insert(catalogServices)
    .values({
      name: svc.name,
      aliases: svc.aliases,
      unit: svc.unit,
      description: svc.description ?? '',
      active: true,
    })
    .returning({ id: catalogServices.id })
  return created!.id
}

/** Idempotent price tier keyed by (serviceId, minQty). */
async function upsertTier(db: Db, serviceId: number, minQty: number, unitPrice: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(catalogPriceTiers)
    .where(and(eq(catalogPriceTiers.serviceId, serviceId), eq(catalogPriceTiers.minQty, minQty)))
  if (existing) {
    await db
      .update(catalogPriceTiers)
      .set({ unitPrice })
      .where(eq(catalogPriceTiers.id, existing.id))
    return
  }
  await db.insert(catalogPriceTiers).values({ serviceId, minQty, unitPrice })
}

/** Idempotent option keyed by (serviceId, name). */
async function upsertOption(
  db: Db,
  serviceId: number,
  opt: { optionGroup: string; name: string; priceDelta: string },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(catalogOptions)
    .where(and(eq(catalogOptions.serviceId, serviceId), eq(catalogOptions.name, opt.name)))
  if (existing) {
    await db
      .update(catalogOptions)
      .set({ optionGroup: opt.optionGroup, priceDelta: opt.priceDelta })
      .where(eq(catalogOptions.id, existing.id))
    return
  }
  await db.insert(catalogOptions).values({ serviceId, ...opt })
}

/** Five real Russian FAQ chunks for the print/ad agency. */
const FAQ_CHUNKS: { title: string; content: string }[] = [
  {
    title: 'Сроки изготовления',
    content:
      'Стандартный срок изготовления визиток и листовок — 2–3 рабочих дня после утверждения макета и оплаты. ' +
      'Баннеры и широкоформатная печать — 1–2 рабочих дня. Срочное изготовление за 1 день возможно с наценкой 30% ' +
      'и подтверждается менеджером. Сроки начинают считаться с момента, когда макет принят в печать.',
  },
  {
    title: 'Требования к макетам',
    content:
      'Макеты принимаем в форматах PDF, TIFF, EPS, CDR (CorelDRAW) и AI (Adobe Illustrator). ' +
      'Разрешение растровых изображений — не менее 300 dpi, цветовая модель CMYK. ' +
      'Обязательно добавляйте припуски под обрез 2–3 мм с каждой стороны и не размещайте важные элементы ближе 5 мм к краю. ' +
      'Шрифты должны быть переведены в кривые. Если макета нет, наш дизайнер сделает его — это отдельная услуга.',
  },
  {
    title: 'Доставка',
    content:
      'Доставку по городу осуществляем курьером в течение 1–2 рабочих дней, стоимость — от 300 рублей в зависимости от района. ' +
      'Самовывоз из офиса бесплатный. В другие города отправляем транспортными компаниями (СДЭК, Деловые Линии) — ' +
      'стоимость и сроки рассчитываются по тарифам перевозчика. Готовность заказа к выдаче сообщаем в этом же чате.',
  },
  {
    title: 'Оплата',
    content:
      'Принимаем оплату наличными в офисе, переводом на карту и безналичным расчётом для юридических лиц (с НДС и без). ' +
      'Для физических лиц работаем по 100% предоплате. Для постоянных корпоративных клиентов возможна оплата по счёту ' +
      'с отсрочкой. Печать запускается после поступления оплаты. Чек или закрывающие документы предоставляем по запросу.',
  },
  {
    title: 'Как заказать дизайн',
    content:
      'Если у вас нет готового макета, наш дизайнер разработает его с нуля. Опишите задачу: что нужно (визитки, листовка, баннер), ' +
      'желаемый стиль, тексты, логотип и контакты, которые надо разместить. Стоимость дизайна визитки — от 800 рублей, ' +
      'листовки — от 1500 рублей, баннера — от 2000 рублей и зависит от сложности. Включено до двух правок; ' +
      'итоговую стоимость и сроки подтверждает менеджер.',
  },
]

export interface SeedOptions {
  /** When false, skips FAQ embedding (used by the fast unit test). Defaults to true. */
  faq?: boolean
}

/** Idempotently seeds settings, catalog and FAQ. Safe to run repeatedly. */
export async function seed(db: Db, opts: SeedOptions = {}): Promise<void> {
  const withFaq = opts.faq ?? true

  // 1. Settings
  await upsertSetting(db, 'system_prompt', DEFAULT_SYSTEM_PROMPT)
  await upsertSetting(db, 'escalation_keywords', DEFAULT_ESCALATION_KEYWORDS)
  await upsertSetting(db, 'daily_turn_cap', 30)

  // 2. Catalog — Визитки
  const vizitki = await upsertService(db, {
    name: 'Визитки',
    aliases: ['визитка', 'визитки'],
    unit: 'шт',
    description: 'Печать визитных карточек, односторонняя и двусторонняя.',
  })
  await upsertTier(db, vizitki, 100, '4.50')
  await upsertTier(db, vizitki, 500, '3.20')
  await upsertTier(db, vizitki, 1000, '2.80')
  await upsertOption(db, vizitki, { optionGroup: 'material', name: 'Мелованная 300г', priceDelta: '0.00' })
  await upsertOption(db, vizitki, { optionGroup: 'material', name: 'Дизайнерская бумага', priceDelta: '1.50' })
  await upsertOption(db, vizitki, { optionGroup: 'finishing', name: 'Ламинация', priceDelta: '2.00' })

  // 3. Catalog — Листовки А5
  const listovki = await upsertService(db, {
    name: 'Листовки А5',
    aliases: ['листовка', 'листовки', 'флаер', 'флаеры'],
    unit: 'шт',
    description: 'Рекламные листовки формата А5, полноцветная печать.',
  })
  await upsertTier(db, listovki, 500, '2.10')
  await upsertTier(db, listovki, 1000, '1.60')

  // 4. Catalog — Баннер
  const banner = await upsertService(db, {
    name: 'Баннер',
    aliases: ['баннер', 'баннеры', 'широкоформат'],
    unit: 'м2',
    description: 'Широкоформатная печать баннеров на ПВХ.',
  })
  await upsertTier(db, banner, 1, '450.00')

  // 5. FAQ chunks (embedding on write — slow on first model download)
  if (withFaq) {
    for (const chunk of FAQ_CHUNKS) {
      const [existing] = await db
        .select()
        .from(faqChunks)
        .where(eq(faqChunks.title, chunk.title))
      await upsertFaqChunk(db, { id: existing?.id, title: chunk.title, content: chunk.content })
    }
  }

  log.info('seed: settings, catalog and FAQ written')
}

// CLI entrypoint: `pnpm seed` (tsx src/db/seed.ts). Uses DATABASE_URL from the environment.
// pathToFileURL normalizes process.argv[1] (a raw OS path) into the same file:// URL
// form as import.meta.url, so the guard fires on Windows (backslashes, spaces, drive
// letter) as well as POSIX — the plain `file://${process.argv[1]}` comparison does not.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Load the repo-root .env into process.env (same approach as vitest.setup.ts) so the
  // CLI sees the cloud DATABASE_URL without a dotenv dependency. server/src/db → ../../../.env.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    process.loadEnvFile(resolve(here, '..', '..', '..', '.env'))
  } catch {
    // .env is optional (CI injects env directly); ignore when absent.
  }
  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/chatbot'
  const db = createDb(url)
  seed(db)
    .then(() => {
      log.info('seed complete')
      process.exit(0)
    })
    .catch((err) => {
      log.error({ err }, 'seed failed')
      process.exit(1)
    })
}
