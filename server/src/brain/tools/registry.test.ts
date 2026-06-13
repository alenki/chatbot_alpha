import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getTestDb } from '../../db/test-utils.js'
import { createLogger } from '../../log.js'
import type { ManagerNotifier } from '../../notify/managers.js'
import type { ToolCall } from '../llm.js'
import { buildToolSpecs, dispatchToolCall, type AgentTool, type ToolContext } from './registry.js'

class FakeNotifier implements ManagerNotifier {
  orderCards: number[] = []
  escalationCards: number[] = []
  async orderCard(orderId: number): Promise<void> { this.orderCards.push(orderId) }
  async escalationCard(escalationId: number): Promise<void> { this.escalationCards.push(escalationId) }
}

function makeCtx(): ToolContext {
  return {
    db: getTestDb(),
    chatId: 1,
    clientId: null,
    notifier: new FakeNotifier(),
    filesDir: './data/files',
    log: createLogger('test'),
  }
}

const echoSchema = z.object({ city: z.string(), count: z.number() })
const echoTool: AgentTool<z.infer<typeof echoSchema>> = {
  name: 'echo',
  description: 'Echoes validated arguments back.',
  schema: echoSchema,
  async execute(args) {
    return JSON.stringify({ echoed: args })
  },
}

const boomSchema = z.object({})
const boomTool: AgentTool<z.infer<typeof boomSchema>> = {
  name: 'boom',
  description: 'Always throws.',
  schema: boomSchema,
  async execute() {
    throw new Error('kaboom')
  },
}

function call(name: string, args: unknown): ToolCall {
  return { id: 'call_1', name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
}

describe('buildToolSpecs', () => {
  it('converts zod schemas into OpenAI-style JSON Schema tool specs', () => {
    const specs = buildToolSpecs([echoTool, boomTool])

    expect(specs).toHaveLength(2)
    expect(specs[0]!.name).toBe('echo')
    expect(specs[0]!.description).toBe('Echoes validated arguments back.')
    expect(specs[0]!.parameters).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string' }, count: { type: 'number' } },
      required: ['city', 'count'],
    })
    expect(specs[1]!.name).toBe('boom')
    expect(specs[1]!.parameters).toMatchObject({ type: 'object' })
  })
})

describe('dispatchToolCall', () => {
  it('dispatches to the matching tool with parsed, validated args', async () => {
    const result = await dispatchToolCall(call('echo', { city: 'Москва', count: 3 }), [echoTool], makeCtx())
    expect(JSON.parse(result)).toEqual({ echoed: { city: 'Москва', count: 3 } })
  })

  it('returns {"error":"unknown tool"} for an unregistered tool name', async () => {
    const result = await dispatchToolCall(call('nope', {}), [echoTool], makeCtx())
    expect(result).toBe('{"error":"unknown tool"}')
  })

  it('returns a JSON error when arguments are not valid JSON', async () => {
    const result = await dispatchToolCall(call('echo', '{not json'), [echoTool], makeCtx())
    expect(JSON.parse(result)).toEqual({ error: 'invalid JSON in tool arguments' })
  })

  it('returns a JSON error listing zod issues when args fail validation', async () => {
    const result = await dispatchToolCall(call('echo', { city: 42 }), [echoTool], makeCtx())
    const parsed = JSON.parse(result)
    expect(parsed.error).toBe('invalid arguments')
    expect(parsed.issues).toEqual(expect.arrayContaining([expect.stringContaining('city')]))
    expect(parsed.issues).toEqual(expect.arrayContaining([expect.stringContaining('count')]))
  })

  it('returns {"error":"internal"} and logs when execute throws', async () => {
    const ctx = makeCtx()
    const errorSpy = vi.spyOn(ctx.log, 'error')

    const result = await dispatchToolCall(call('boom', {}), [boomTool], ctx)

    expect(result).toBe('{"error":"internal"}')
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})
