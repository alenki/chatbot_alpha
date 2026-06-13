import { z } from 'zod'
import { searchFaq } from '../../knowledge/faq.js'
import type { AgentTool } from './registry.js'

const schema = z.object({ query: z.string() })

export const knowledgeTool: AgentTool<z.infer<typeof schema>> = {
  name: 'search_knowledge',
  description:
    'Поиск по базе знаний компании: сроки производства, требования к макетам и файлам, ' +
    'доставка, оплата, информация о компании и портфолио. ' +
    'query — поисковый запрос на русском языке.',
  schema,
  async execute(args, ctx) {
    const results = await searchFaq(ctx.db, args.query, 3)
    return JSON.stringify({ results })
  },
}
