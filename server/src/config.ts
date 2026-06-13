import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  MANAGER_GROUP_CHAT_ID: z.string().min(1),       // e.g. "-1001234567890"
  LLM_PRIMARY_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_PRIMARY_API_KEY: z.string().min(1),
  LLM_PRIMARY_MODEL: z.string().default('deepseek/deepseek-chat:free'), // verify current free tools-capable DeepSeek id on openrouter.ai/models at setup
  LLM_FALLBACK_BASE_URL: z.string().url().optional(),
  LLM_FALLBACK_API_KEY: z.string().optional(),
  LLM_FALLBACK_MODEL: z.string().optional(),
  ADMIN_PORT: z.coerce.number().default(8080),
  ADMIN_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(16),
  ADMIN_BASE_URL: z.string().url().default('http://localhost:8080'), // used in manager-card deep links
  FILES_DIR: z.string().default('./data/files'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export type AppConfig = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid environment configuration — ${details}`)
  }
  return parsed.data
}
