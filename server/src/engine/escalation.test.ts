import { describe, expect, it } from 'vitest'
import { DEFAULT_ESCALATION_KEYWORDS, matchesEscalationKeywords } from './escalation.js'

describe('DEFAULT_ESCALATION_KEYWORDS', () => {
  it('contains exactly the contract keyword list, in order', () => {
    expect(DEFAULT_ESCALATION_KEYWORDS).toEqual([
      'позовите человека',
      'оператор',
      'менеджер',
      'живой человек',
      'жалоба',
      'верните деньги',
      'безобразие',
      'юрист',
      'суд',
    ])
  })
})

describe('matchesEscalationKeywords', () => {
  it('matches a keyword as a substring', () => {
    expect(matchesEscalationKeywords('Позовите человека, пожалуйста!', DEFAULT_ESCALATION_KEYWORDS)).toBe(true)
  })

  it('is case-insensitive on the input text', () => {
    expect(matchesEscalationKeywords('ВЕРНИТЕ ДЕНЬГИ немедленно', DEFAULT_ESCALATION_KEYWORDS)).toBe(true)
  })

  it('matches keywords inside longer sentences (plain substring, no word boundaries)', () => {
    expect(matchesEscalationKeywords('мне нужен живой человек а не бот', DEFAULT_ESCALATION_KEYWORDS)).toBe(true)
  })

  it('lowercases the keywords too', () => {
    expect(matchesEscalationKeywords('хочу поговорить с менеджером', ['МЕНЕДЖЕР'])).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(matchesEscalationKeywords('Сколько стоят визитки 4+4?', DEFAULT_ESCALATION_KEYWORDS)).toBe(false)
  })

  it('returns false for an empty keyword list', () => {
    expect(matchesEscalationKeywords('позовите человека', [])).toBe(false)
  })

  it('ignores empty-string keywords instead of matching everything', () => {
    expect(matchesEscalationKeywords('обычный вопрос про печать', [''])).toBe(false)
  })
})
