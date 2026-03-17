/**
 * AI 질문 트리거 판별
 *
 * 한글 단어 경계를 고려한 패턴 매칭.
 * expense fallback과 AI fallback에서 공통 사용.
 */

/** 질문형 키워드 (문장 중간/끝) */
const QUESTION_KEYWORDS = [
  '분석', '비교', '추천', '설명', '요약',
  '어때', '어떻게', '얼마', '언제',
  '알려줘', '알려', '해줘',
]

/** 키워드가 공백/시작/끝 경계에 있는지 확인 (한글 단어 경계) */
function hasKeyword(text: string, keyword: string): boolean {
  const idx = text.indexOf(keyword)
  if (idx === -1) return false

  // 앞: 시작이거나 공백/구두점
  const before = idx === 0 || /[\s.,!?:;]/.test(text[idx - 1])
  // 뒤: 끝이거나 공백/구두점/조사
  const afterIdx = idx + keyword.length
  const after = afterIdx >= text.length || /[\s.,!?:;을를이가은는도에서]/.test(text[afterIdx])

  return before && after
}

/**
 * 텍스트가 AI 질문인지 판별
 */
export function isAiQuestion(text: string): boolean {
  // ? 포함
  if (/[?？]/.test(text)) return true

  // 질문형 키워드 매칭
  return QUESTION_KEYWORDS.some((kw) => hasKeyword(text, kw))
}
