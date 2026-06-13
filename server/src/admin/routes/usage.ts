import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'

export interface UsageRouteDeps {
  db: Db
}

interface UsageRow {
  day: string
  clientMessages: number
  aiMessages: number
  managerMessages: number
  promptTokens: number
  completionTokens: number
  escalations: number
}

export function registerUsageRoutes(app: FastifyInstance, deps: UsageRouteDeps): void {
  const { db } = deps

  // GET /api/usage?days=30 — per-day message counts by role, token sums, escalation count.
  app.get<{ Querystring: { days?: string } }>('/api/usage', async (req) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30))

    const msgAgg = await db.execute(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             count(*) FILTER (WHERE role = 'client')  AS client_messages,
             count(*) FILTER (WHERE role = 'ai')      AS ai_messages,
             count(*) FILTER (WHERE role = 'manager') AS manager_messages,
             coalesce(sum(prompt_tokens), 0)          AS prompt_tokens,
             coalesce(sum(completion_tokens), 0)      AS completion_tokens
      FROM messages
      WHERE created_at >= now() - (${days}::int * interval '1 day')
      GROUP BY 1
    `)
    const escAgg = await db.execute(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             count(*) AS escalations
      FROM escalations
      WHERE created_at >= now() - (${days}::int * interval '1 day')
      GROUP BY 1
    `)

    const byDay = new Map<string, UsageRow>()
    const get = (day: string): UsageRow => {
      let row = byDay.get(day)
      if (row === undefined) {
        row = {
          day,
          clientMessages: 0,
          aiMessages: 0,
          managerMessages: 0,
          promptTokens: 0,
          completionTokens: 0,
          escalations: 0,
        }
        byDay.set(day, row)
      }
      return row
    }
    for (const r of msgAgg.rows as Record<string, unknown>[]) {
      const row = get(String(r.day))
      row.clientMessages = Number(r.client_messages)
      row.aiMessages = Number(r.ai_messages)
      row.managerMessages = Number(r.manager_messages)
      row.promptTokens = Number(r.prompt_tokens)
      row.completionTokens = Number(r.completion_tokens)
    }
    for (const r of escAgg.rows as Record<string, unknown>[]) {
      get(String(r.day)).escalations = Number(r.escalations)
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  })
}
