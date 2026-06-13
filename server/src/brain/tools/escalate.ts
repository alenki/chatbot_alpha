import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { chats, escalations } from '../../db/schema.js'
import type { AgentTool } from './registry.js'

const schema = z.object({ reason: z.string(), summary: z.string() })

export const escalateTool: AgentTool<z.infer<typeof schema>> = {
  name: 'escalate_to_human',
  description:
    'Передать диалог менеджеру-человеку и остановить автоматические ответы. ' +
    'Вызывай когда: клиент просит человека; клиент раздражён или жалуется; ' +
    'вопросы оплаты, возвратов, скидок; юридические претензии; запрос вне каталога; ' +
    'или когда не уверен в правильном ответе. ' +
    'reason — краткая причина, summary — сводка диалога для менеджера на русском.',
  schema,
  async execute(args, ctx) {
    await ctx.db
      .update(chats)
      .set({ botPaused: true, status: 'human' })
      .where(eq(chats.id, ctx.chatId))

    const inserted = await ctx.db
      .insert(escalations)
      .values({ chatId: ctx.chatId, reason: args.reason, summary: args.summary })
      .returning({ id: escalations.id })

    await ctx.notifier.escalationCard(inserted[0]!.id)
    return JSON.stringify({ ok: true })
  },
}
