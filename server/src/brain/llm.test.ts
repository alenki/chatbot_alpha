import { describe, expect, it } from 'vitest'
import {
  LlmClient,
  LlmRateLimitedError,
  LlmUnavailableError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatTransport,
  type LlmMessage,
  type ModelProfile,
  type ToolSpec,
} from './llm.js'

/** Error shaped like the openai package's APIError: a plain Error with a numeric `status`. */
interface HttpishError extends Error { status?: number }
function httpError(status: number, message: string): HttpishError {
  const err = new Error(message) as HttpishError
  err.status = status
  return err
}

type Step = { ok: ChatCompletionResult } | { fail: HttpishError }

/**
 * Fake OpenAI-compatible transport. Each profile gets a script of steps;
 * every chat.completions.create call consumes the next step (a canned result
 * or a thrown error) and records the full request body.
 */
function makeFakeFactory(scripts: Record<string, Step[]>) {
  const requests: { profile: string; request: ChatCompletionRequest }[] = []
  const createClient = (profile: ModelProfile): ChatTransport => ({
    chat: {
      completions: {
        create: async (request: ChatCompletionRequest): Promise<ChatCompletionResult> => {
          requests.push({ profile: profile.name, request })
          const step = scripts[profile.name]?.shift()
          if (step === undefined) throw new Error(`no scripted step left for profile "${profile.name}"`)
          if ('fail' in step) throw step.fail
          return step.ok
        },
      },
    },
  })
  return { createClient, requests }
}

const primary: ModelProfile = {
  name: 'primary',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
  model: 'deepseek/deepseek-chat:free',
  temperature: 0.3,
}
const fallback: ModelProfile = {
  name: 'fallback',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-ds-test',
  model: 'deepseek-chat',
}

function makeClient(scripts: Record<string, Step[]>, withFallback: boolean) {
  const { createClient, requests } = makeFakeFactory(scripts)
  const client = new LlmClient(primary, withFallback ? fallback : undefined, {
    maxRetries: 2,
    retryBaseMs: 1, // keep the expo backoff invisible in tests
    createClient,
  })
  return { client, requests }
}

const userOnly: LlmMessage[] = [{ role: 'user', content: 'Привет' }]

const textResult: ChatCompletionResult = {
  choices: [{ message: { content: 'Здравствуйте! Чем можем помочь?' } }],
  usage: { prompt_tokens: 120, completion_tokens: 25 },
}

describe('LlmClient response mapping', () => {
  it('maps content, tool calls and usage into LlmResponse', async () => {
    const { client } = makeClient(
      {
        primary: [{
          ok: {
            choices: [{
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'get_price_quote', arguments: '{"service":"Визитки","quantity":100}' } },
                  { id: 'call_2', type: 'function', function: { name: 'search_knowledge', arguments: '{"query":"доставка"}' } },
                ],
              },
            }],
            usage: { prompt_tokens: 321, completion_tokens: 42 },
          },
        }],
      },
      false,
    )

    const res = await client.chat(userOnly, [])

    expect(res).toEqual({
      content: null,
      toolCalls: [
        { id: 'call_1', name: 'get_price_quote', arguments: '{"service":"Визитки","quantity":100}' },
        { id: 'call_2', name: 'search_knowledge', arguments: '{"query":"доставка"}' },
      ],
      promptTokens: 321,
      completionTokens: 42,
    })
  })

  it('defaults token counts to zero when usage is missing', async () => {
    const { client } = makeClient(
      { primary: [{ ok: { choices: [{ message: { content: 'ок' } }] } }] },
      false,
    )

    const res = await client.chat(userOnly, [])

    expect(res.content).toBe('ок')
    expect(res.toolCalls).toEqual([])
    expect(res.promptTokens).toBe(0)
    expect(res.completionTokens).toBe(0)
  })
})

describe('LlmClient request mapping', () => {
  it('sends model, temperature, OpenAI-format messages and tools', async () => {
    const { client, requests } = makeClient({ primary: [{ ok: textResult }] }, false)
    const history: LlmMessage[] = [
      { role: 'system', content: 'Ты ассистент типографии.' },
      { role: 'user', content: 'Сколько стоят 100 визиток?' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'call_1', name: 'get_price_quote', arguments: '{"service":"Визитки","quantity":100}' }],
      },
      { role: 'tool', content: '{"kind":"quote","total":450}', toolCallId: 'call_1' },
      { role: 'assistant', content: 'Предварительно 450 ₽, менеджер подтвердит.' },
    ]
    const tools: ToolSpec[] = [{
      name: 'get_price_quote',
      description: 'Цена из каталога',
      parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
    }]

    await client.chat(history, tools)

    expect(requests).toHaveLength(1)
    const request = requests[0]!.request
    expect(request.model).toBe('deepseek/deepseek-chat:free')
    expect(request.temperature).toBe(0.3)
    expect(request.messages).toEqual([
      { role: 'system', content: 'Ты ассистент типографии.' },
      { role: 'user', content: 'Сколько стоят 100 визиток?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_price_quote', arguments: '{"service":"Визитки","quantity":100}' } }],
      },
      { role: 'tool', content: '{"kind":"quote","total":450}', tool_call_id: 'call_1' },
      { role: 'assistant', content: 'Предварительно 450 ₽, менеджер подтвердит.' },
    ])
    expect(request.tools).toEqual([{
      type: 'function',
      function: {
        name: 'get_price_quote',
        description: 'Цена из каталога',
        parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
      },
    }])
  })

  it('omits the tools field entirely when no tools are passed', async () => {
    const { client, requests } = makeClient({ primary: [{ ok: textResult }] }, false)

    await client.chat(userOnly, [])

    expect(requests[0]!.request.tools).toBeUndefined()
  })
})

describe('LlmClient retries and fallback', () => {
  it('retries the primary after a 500 and succeeds', async () => {
    const { client, requests } = makeClient(
      { primary: [{ fail: httpError(500, 'server exploded') }, { ok: textResult }] },
      false,
    )

    const res = await client.chat(userOnly, [])

    expect(res.content).toBe('Здравствуйте! Чем можем помочь?')
    expect(requests.map((r) => r.profile)).toEqual(['primary', 'primary'])
  })

  it('falls back to the fallback profile when the primary exhausts its retries', async () => {
    const { client, requests } = makeClient(
      {
        primary: [
          { fail: httpError(500, 'boom 1') },
          { fail: httpError(502, 'boom 2') },
          { fail: httpError(500, 'boom 3') },
        ],
        fallback: [{ ok: textResult }],
      },
      true,
    )

    const res = await client.chat(userOnly, [])

    expect(res.content).toBe('Здравствуйте! Чем можем помочь?')
    // maxRetries=2 → 3 attempts on primary, then the fallback
    expect(requests.map((r) => r.profile)).toEqual(['primary', 'primary', 'primary', 'fallback'])
    expect(requests[3]!.request.model).toBe('deepseek-chat')
  })

  it('throws LlmRateLimitedError when every profile returns 429 — without retrying 429s', async () => {
    const { client, requests } = makeClient(
      {
        primary: [{ fail: httpError(429, 'free tier exhausted') }],
        fallback: [{ fail: httpError(429, 'rate limited') }],
      },
      true,
    )

    await expect(client.chat(userOnly, [])).rejects.toBeInstanceOf(LlmRateLimitedError)
    // one attempt per profile: a 429 is a hard daily/minute cap, not a transient blip
    expect(requests.map((r) => r.profile)).toEqual(['primary', 'fallback'])
  })

  it('throws LlmUnavailableError when all profiles fail with non-429 errors', async () => {
    const fails = () => [
      { fail: httpError(500, 'down') },
      { fail: httpError(500, 'down') },
      { fail: httpError(500, 'down') },
    ]
    const { client, requests } = makeClient({ primary: fails(), fallback: fails() }, true)

    await expect(client.chat(userOnly, [])).rejects.toBeInstanceOf(LlmUnavailableError)
    expect(requests).toHaveLength(6) // 3 attempts × 2 profiles
  })

  it('throws LlmUnavailableError (not RateLimited) when only some profiles hit 429', async () => {
    const { client } = makeClient(
      {
        primary: [
          { fail: httpError(500, 'down') },
          { fail: httpError(500, 'down') },
          { fail: httpError(500, 'down') },
        ],
        fallback: [{ fail: httpError(429, 'rate limited') }],
      },
      true,
    )

    await expect(client.chat(userOnly, [])).rejects.toBeInstanceOf(LlmUnavailableError)
  })

  it('throws LlmUnavailableError after exhausting the primary when no fallback is configured', async () => {
    const { client, requests } = makeClient(
      {
        primary: [
          { fail: httpError(503, 'down') },
          { fail: httpError(503, 'down') },
          { fail: httpError(503, 'down') },
        ],
      },
      false,
    )

    await expect(client.chat(userOnly, [])).rejects.toBeInstanceOf(LlmUnavailableError)
    expect(requests).toHaveLength(3)
  })
})
