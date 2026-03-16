/**
 * 자연어 소비/수입 입력 파서.
 * "점심 12000" → { description: "점심", amount: 12000, type: "expense" }
 * "수입 월급 5000000" → { description: "월급", amount: 5000000, type: "income" }
 */

export interface ParsedExpense {
  description: string
  amount: number
  type: 'expense' | 'income'
}

export interface ParseError {
  error: string
}

export type ParseResult = ParsedExpense | ParseError

export function isParseError(result: ParseResult): result is ParseError {
  return 'error' in result
}

/**
 * 자연어 입력을 파싱한다.
 *
 * 형식:
 * - "{설명} {금액}" — 소비
 * - "{금액} {설명}" — 소비
 * - "수입 {설명} {금액}" — 수입
 * - "수입 {금액} {설명}" — 수입
 *
 * 금액은 콤마 허용 (12,000 → 12000)
 */
export function parseExpenseInput(input: string): ParseResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { error: '입력이 비어있습니다.' }
  }

  // "수입" prefix 감지
  let type: 'expense' | 'income' = 'expense'
  let body = trimmed

  if (/^수입\s+/.test(body)) {
    type = 'income'
    body = body.replace(/^수입\s+/, '').trim()
  }

  if (!body) {
    return { error: '설명과 금액을 입력해주세요.\n예: 점심 12000' }
  }

  // 공백으로 분리된 토큰 중 순수 숫자(콤마 허용)인 것을 금액 후보로 채택
  // "RTX4090 케이스 800" → 토큰: ["RTX4090", "케이스", "800"] → 800이 금액
  // 독립 토큰이 없으면 텍스트 내 숫자 fallback
  const tokens = body.split(/\s+/)
  let amountToken: { amount: number; tokenIndex: number } | null = null

  for (let i = tokens.length - 1; i >= 0; i--) {
    const raw = tokens[i].replace(/,/g, '')
    if (/^\d+$/.test(raw)) {
      const num = parseInt(raw, 10)
      if (num > 0) {
        amountToken = { amount: num, tokenIndex: i }
        break // 마지막(가장 오른쪽) 독립 숫자 토큰 채택
      }
    }
  }

  if (!amountToken) {
    return { error: '금액을 찾을 수 없습니다.\n예: 점심 12000' }
  }

  // 금액 토큰을 제거하고 나머지를 설명으로
  const descTokens = tokens.filter((_, i) => i !== amountToken!.tokenIndex)
  const description = descTokens.join(' ').trim()

  if (!description) {
    return { error: '설명을 입력해주세요.\n예: 점심 12000' }
  }

  return { description, amount: amountToken.amount, type }
}
