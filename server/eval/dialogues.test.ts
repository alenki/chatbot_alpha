import { describe, expect, it } from 'vitest'
import { dialogues } from './dialogues.js'

describe('golden dialogues data', () => {
  it('defines around twenty dialogues', () => {
    expect(dialogues.length).toBeGreaterThanOrEqual(18)
    expect(dialogues.length).toBeLessThanOrEqual(24)
  })

  it('every dialogue has a unique name and at least one turn', () => {
    const names = new Set<string>()
    for (const d of dialogues) {
      expect(d.name.length).toBeGreaterThan(0)
      expect(names.has(d.name)).toBe(false)
      names.add(d.name)
      expect(d.turns.length).toBeGreaterThanOrEqual(1)
      for (const t of d.turns) {
        expect(typeof t.user).toBe('string')
        expect(t.user.length).toBeGreaterThan(0)
      }
    }
  })

  it('every replyMatches / replyNotMatches is a valid regex', () => {
    for (const d of dialogues) {
      for (const t of d.turns) {
        if (t.expect?.replyMatches) expect(() => new RegExp(t.expect!.replyMatches!, 'i')).not.toThrow()
        if (t.expect?.replyNotMatches) expect(() => new RegExp(t.expect!.replyNotMatches!, 'i')).not.toThrow()
      }
    }
  })

  it('covers the required hard-case scenarios', () => {
    const names = dialogues.map((d) => d.name)
    const hasEscalation = dialogues.some((d) => d.turns.some((t) => t.expect?.escalated === true))
    const hasOrderCreated = dialogues.some((d) => d.turns.some((t) => t.expect?.orderCreated === true))
    expect(hasEscalation).toBe(true)
    expect(hasOrderCreated).toBe(true)
    // a few named scenarios that must exist
    expect(names.some((n) => n.includes('инъекц'))).toBe(true) // prompt injection
    expect(names.some((n) => n.includes('человек'))).toBe(true) // explicit human request
  })
})
