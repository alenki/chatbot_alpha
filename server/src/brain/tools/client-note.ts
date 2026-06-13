import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { chats, clients } from '../../db/schema.js'
import type { AgentTool } from './registry.js'

const schema = z.object({ note: z.string() })

export const clientNoteTool: AgentTool<z.infer<typeof schema>> = {
  name: 'save_client_note',
  description:
    'Сохранить факт о клиенте в его профиль: имя, компания, телефон, предпочтения. ' +
    'note — одна короткая строка с фактом на русском, например «Зовут Иван, компания Ромашка».',
  schema,
  async execute(args, ctx) {
    const note = args.note.trim()
    if (note === '') return JSON.stringify({ error: 'note is empty' })

    let clientId = ctx.clientId
    if (clientId === null) {
      // The chat has no client profile yet — create one and link it.
      const inserted = await ctx.db.insert(clients).values({}).returning({ id: clients.id })
      clientId = inserted[0]!.id
      await ctx.db.update(chats).set({ clientId }).where(eq(chats.id, ctx.chatId))
    }

    const existing = await ctx.db
      .select({ notes: clients.notes })
      .from(clients)
      .where(eq(clients.id, clientId))
    const current = existing[0]?.notes ?? ''
    const updated = current === '' ? note : `${current}\n${note}`
    await ctx.db.update(clients).set({ notes: updated }).where(eq(clients.id, clientId))

    return JSON.stringify({ ok: true })
  },
}
