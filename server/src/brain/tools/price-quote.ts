import { z } from 'zod'
import { getPriceQuote } from '../../catalog/pricing.js'
import type { AgentTool } from './registry.js'

const schema = z.object({
  service: z.string(),
  quantity: z.number(),
  options: z.array(z.string()).optional(),
})

export const priceQuoteTool: AgentTool<z.infer<typeof schema>> = {
  name: 'get_price_quote',
  description:
    'Единственный допустимый источник цен. Считает предварительную цену по каталогу типографии. ' +
    'service — название услуги (например, «визитки»), quantity — тираж в штуках, ' +
    'options — выбранные опции (материал, отделка). ' +
    'Если вернулся kind="needs_manager" — цену не называть, предложить уточнение у менеджера.',
  schema,
  async execute(args, ctx) {
    const result = await getPriceQuote(ctx.db, {
      service: args.service,
      quantity: args.quantity,
      options: args.options,
    })
    return JSON.stringify(result)
  },
}
