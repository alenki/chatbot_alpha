import { describe, expect, it } from 'vitest'
import { createLogger, log } from './log.js'

describe('createLogger', () => {
  it('uses debug level in development', () => {
    expect(createLogger('development').level).toBe('debug')
  })

  it('uses info level in production', () => {
    expect(createLogger('production').level).toBe('info')
  })

  it('is silent in test', () => {
    expect(createLogger('test').level).toBe('silent')
  })

  it('exports a root logger built from the current NODE_ENV', () => {
    // vitest sets NODE_ENV=test, so the import-time root logger must be silent
    expect(log.level).toBe('silent')
  })
})
