import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Db } from '../../db/client.js'
import type { Logger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import type { ToolCall, ToolSpec } from '../llm.js'

export interface ToolContext { db: Db; chatId: number; clientId: number | null; notifier: ManagerNotifier; filesDir: string; log: Logger }

export interface AgentTool<T = unknown> {
  name: string
  description: string                                   // Russian-aware description shown to model
  schema: z.ZodType<T>
  execute(args: T, ctx: ToolContext): Promise<string>   // JSON-stringified result for the model
}

export function buildToolSpecs(tools: AgentTool<any>[]): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.schema, { target: 'openAi', $refStrategy: 'none' }) as Record<string, unknown>,
  }))
}

export async function dispatchToolCall(call: ToolCall, tools: AgentTool<any>[], ctx: ToolContext): Promise<string> {
  const tool = tools.find((t) => t.name === call.name)
  if (tool === undefined) return JSON.stringify({ error: 'unknown tool' })

  let raw: unknown
  try {
    raw = call.arguments.trim() === '' ? {} : JSON.parse(call.arguments)
  } catch {
    return JSON.stringify({ error: 'invalid JSON in tool arguments' })
  }

  const parsed = tool.schema.safeParse(raw)
  if (!parsed.success) {
    return JSON.stringify({
      error: 'invalid arguments',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
  }

  try {
    return await tool.execute(parsed.data, ctx)
  } catch (err) {
    ctx.log.error({ err, tool: call.name, chatId: ctx.chatId }, 'tool execution failed')
    return JSON.stringify({ error: 'internal' })
  }
}
