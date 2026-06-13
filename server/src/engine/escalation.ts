export const DEFAULT_ESCALATION_KEYWORDS: string[] = [
  'позовите человека',
  'оператор',
  'менеджер',
  'живой человек',
  'жалоба',
  'верните деньги',
  'безобразие',
  'юрист',
  'суд',
]

/** Code-enforced trigger: lowercase substring match of any keyword in the text. */
export function matchesEscalationKeywords(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase()
  return keywords.some((keyword) => keyword !== '' && haystack.includes(keyword.toLowerCase()))
}
