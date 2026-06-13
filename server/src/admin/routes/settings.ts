import { inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import { settings } from '../../db/schema.js'
import { DEFAULT_SYSTEM_PROMPT } from '../../brain/prompt.js'
import { DEFAULT_ESCALATION_KEYWORDS } from '../../engine/escalation.js'

const DEFAULT_DAILY_TURN_CAP = 30

export interface SettingsRouteDeps {
  db: Db
}

interface SettingsBody {
  system_prompt?: string
  escalation_keywords?: string[]
  daily_turn_cap?: number
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): void {
  const { db } = deps

  // GET /api/settings — defaults applied for any absent row.
  app.get('/api/settings', async () => {
    const rows = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, ['system_prompt', 'escalation_keywords', 'daily_turn_cap']))
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    return {
      system_prompt: (byKey.get('system_prompt') as string | undefined) ?? DEFAULT_SYSTEM_PROMPT,
      escalation_keywords:
        (byKey.get('escalation_keywords') as string[] | undefined) ?? DEFAULT_ESCALATION_KEYWORDS,
      daily_turn_cap: (byKey.get('daily_turn_cap') as number | undefined) ?? DEFAULT_DAILY_TURN_CAP,
    }
  })

  // PUT /api/settings — upsert each provided key.
  app.put<{ Body: SettingsBody }>('/api/settings', async (req) => {
    const b = req.body ?? {}
    const upserts: { key: string; value: unknown }[] = []
    if (typeof b.system_prompt === 'string') upserts.push({ key: 'system_prompt', value: b.system_prompt })
    if (Array.isArray(b.escalation_keywords)) {
      upserts.push({ key: 'escalation_keywords', value: b.escalation_keywords })
    }
    if (typeof b.daily_turn_cap === 'number') upserts.push({ key: 'daily_turn_cap', value: b.daily_turn_cap })
    for (const u of upserts) {
      await db
        .insert(settings)
        .values({ key: u.key, value: u.value })
        .onConflictDoUpdate({ target: settings.key, set: { value: u.value } })
    }
    return { ok: true }
  })
}
