import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

/** Minimal env containing exactly the required (no-default) vars. */
function validEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/chatbot',
    TELEGRAM_BOT_TOKEN: '123456:test-token',
    MANAGER_GROUP_CHAT_ID: '-1001234567890',
    LLM_PRIMARY_API_KEY: 'sk-or-test',
    ADMIN_PASSWORD: 'super-secret-password',
    SESSION_SECRET: 'a-session-secret-of-32-characters',
  }
}

describe('loadConfig', () => {
  it('parses a minimal valid environment', () => {
    const config = loadConfig(validEnv())
    expect(config.DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/chatbot')
    expect(config.TELEGRAM_BOT_TOKEN).toBe('123456:test-token')
    expect(config.MANAGER_GROUP_CHAT_ID).toBe('-1001234567890')
  })

  it('throws on a missing required var and names the offender', () => {
    const env = validEnv()
    delete env.DATABASE_URL
    expect(() => loadConfig(env)).toThrowError(/DATABASE_URL/)
  })

  it('throws when TELEGRAM_BOT_TOKEN is empty', () => {
    const env = validEnv()
    env.TELEGRAM_BOT_TOKEN = ''
    expect(() => loadConfig(env)).toThrowError(/TELEGRAM_BOT_TOKEN/)
  })

  it('throws when ADMIN_PASSWORD is shorter than 8 chars', () => {
    const env = validEnv()
    env.ADMIN_PASSWORD = 'short'
    expect(() => loadConfig(env)).toThrowError(/ADMIN_PASSWORD/)
  })

  it('applies defaults for vars with defaults', () => {
    const config = loadConfig(validEnv())
    expect(config.LLM_PRIMARY_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(config.LLM_PRIMARY_MODEL).toBe('deepseek/deepseek-chat:free')
    expect(config.ADMIN_PORT).toBe(8080)
    expect(config.ADMIN_BASE_URL).toBe('http://localhost:8080')
    expect(config.FILES_DIR).toBe('./data/files')
    expect(config.NODE_ENV).toBe('development')
  })

  it('coerces ADMIN_PORT from string to number', () => {
    const env = validEnv()
    env.ADMIN_PORT = '9090'
    const config = loadConfig(env)
    expect(config.ADMIN_PORT).toBe(9090)
    expect(typeof config.ADMIN_PORT).toBe('number')
  })

  it('rejects a non-numeric ADMIN_PORT', () => {
    const env = validEnv()
    env.ADMIN_PORT = 'not-a-port'
    expect(() => loadConfig(env)).toThrowError(/ADMIN_PORT/)
  })

  it('leaves optional fallback profile vars undefined when absent', () => {
    const config = loadConfig(validEnv())
    expect(config.LLM_FALLBACK_BASE_URL).toBeUndefined()
    expect(config.LLM_FALLBACK_API_KEY).toBeUndefined()
    expect(config.LLM_FALLBACK_MODEL).toBeUndefined()
  })

  it('accepts a full fallback profile', () => {
    const env = validEnv()
    env.LLM_FALLBACK_BASE_URL = 'https://api.deepseek.com/v1'
    env.LLM_FALLBACK_API_KEY = 'sk-fallback'
    env.LLM_FALLBACK_MODEL = 'deepseek-chat'
    const config = loadConfig(env)
    expect(config.LLM_FALLBACK_BASE_URL).toBe('https://api.deepseek.com/v1')
    expect(config.LLM_FALLBACK_MODEL).toBe('deepseek-chat')
  })

  it('rejects an invalid NODE_ENV', () => {
    const env = validEnv()
    env.NODE_ENV = 'staging'
    expect(() => loadConfig(env)).toThrowError(/NODE_ENV/)
  })
})
