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

  // 금액 패턴: 연속 숫자(콤마 포함)
  const amountPattern = /[\d,]+/g
  const matches = Array.from(body.matchAll(amountPattern))

  if (matches.length === 0) {
    return { error: '금액을 찾을 수 없습니다.\n예: 점심 12000' }
  }

  // 유효한 금액 후보 찾기 (1 이상의 정수)
  let bestMatch: { amount: number; index: number; length: number } | null = null

  for (const m of matches) {
    const raw = m[0].replace(/,/g, '')
    // 순수 숫자인지 확인 (빈 문자열, 콤마만 있는 경우 제외)
    if (!/^\d+$/.test(raw)) continue
    const num = parseInt(raw, 10)
    if (num <= 0) continue
    // 가장 큰 숫자를 금액으로 채택 (보통 금액이 가장 큰 숫자)
    if (!bestMatch || num > bestMatch.amount) {
      bestMatch = { amount: num, index: m.index!, length: m[0].length }
    }
  }

  if (!bestMatch) {
    return { error: '유효한 금액을 찾을 수 없습니다.\n예: 점심 12000' }
  }

  // 금액 부분을 제거하고 나머지를 설명으로
  const description = (
    body.slice(0, bestMatch.index) + body.slice(bestMatch.index + bestMatch.length)
  ).trim()

  if (!description) {
    return { error: '설명을 입력해주세요.\n예: 점심 12000' }
  }

  return { description, amount: bestMatch.amount, type }
}
