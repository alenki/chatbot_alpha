import OpenAI from 'openai'

export interface ModelProfile { name: string; baseUrl: string; apiKey: string; model: string; temperature?: number }
export interface ToolCall { id: string; name: string; arguments: string }   // arguments = raw JSON string
export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }  // JSON Schema
export interface LlmResponse { content: string | null; toolCalls: ToolCall[]; promptTokens: number; completionTokens: number }

export class LlmUnavailableError extends Error {}
export class LlmRateLimitedError extends Error {}      // 429 from provider — engine switches to degrade mode for the day

// --- Transport abstraction -------------------------------------------------
// Minimal structural slice of the openai package's client: just enough for
// chat.completions.create. The real OpenAI instance satisfies it; tests
// inject a fake via opts.createClient.

export interface ChatCompletionRequest {
  model: string
  temperature?: number
  messages: Record<string, unknown>[]
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
}

export interface ChatCompletionResult {
  choices: {
    message: {
      content?: string | null
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export interface ChatTransport {
  chat: { completions: { create(request: ChatCompletionRequest): Promise<ChatCompletionResult> } }
}

export type CreateClient = (profile: ModelProfile) => ChatTransport

const defaultCreateClient: CreateClient = (profile) =>
  // The OpenAI client accepts our plain request object and its response is a
  // structural superset of ChatCompletionResult — the cast bridges the nominal types.
  new OpenAI({ baseURL: profile.baseUrl, apiKey: profile.apiKey }) as unknown as ChatTransport

// --- Mapping ----------------------------------------------------------------

function toOpenAiMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      const out: Record<string, unknown> = { role: 'assistant', content: m.content }
      if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }))
      }
      return out
    }
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId }
    }
    return { role: m.role, content: m.content }
  })
}

function toOpenAiTools(tools: ToolSpec[]): ChatCompletionRequest['tools'] {
  if (tools.length === 0) return undefined
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

function mapResult(result: ChatCompletionResult): LlmResponse {
  const message = result.choices[0]?.message
  if (message === undefined) throw new Error('LLM response contained no choices')
  return {
    content: message.content ?? null,
    toolCalls: (message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })),
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
  }
}

function isRateLimit(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- Client -----------------------------------------------------------------

export class LlmClient {
  private readonly profiles: ModelProfile[]
  private readonly maxRetries: number
  private readonly retryBaseMs: number
  private readonly createClient: CreateClient
  private readonly clients = new Map<string, ChatTransport>()

  constructor(
    primary: ModelProfile,
    fallback?: ModelProfile,
    opts?: { maxRetries?: number; retryBaseMs?: number; createClient?: CreateClient },
  ) {
    this.profiles = fallback === undefined ? [primary] : [primary, fallback]
    this.maxRetries = opts?.maxRetries ?? 2
    this.retryBaseMs = opts?.retryBaseMs ?? 500
    this.createClient = opts?.createClient ?? defaultCreateClient
  }

  private getClient(profile: ModelProfile): ChatTransport {
    let client = this.clients.get(profile.name)
    if (client === undefined) {
      client = this.createClient(profile)
      this.clients.set(profile.name, client)
    }
    return client
  }

  /** try primary (retries) → fallback (retries) → throw LlmUnavailableError; 429 on ALL profiles → LlmRateLimitedError */
  async chat(messages: LlmMessage[], tools: ToolSpec[]): Promise<LlmResponse> {
    const mappedMessages = toOpenAiMessages(messages)
    const mappedTools = toOpenAiTools(tools)

    let allRateLimited = true
    let lastError: unknown

    for (const profile of this.profiles) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        try {
          const request: ChatCompletionRequest = {
            model: profile.model,
            ...(profile.temperature !== undefined ? { temperature: profile.temperature } : {}),
            messages: mappedMessages,
            ...(mappedTools !== undefined ? { tools: mappedTools } : {}),
          }
          const result = await this.getClient(profile).chat.completions.create(request)
          return mapResult(result)
        } catch (err) {
          lastError = err
          if (isRateLimit(err)) break // hard cap on this profile — move straight to the next one
          allRateLimited = false
          if (attempt < this.maxRetries) await sleep(this.retryBaseMs * 2 ** attempt)
        }
      }
    }

    if (allRateLimited) {
      throw new LlmRateLimitedError('all model profiles are rate-limited (HTTP 429)')
    }
    throw new LlmUnavailableError(
      `all model profiles failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    )
  }
}
