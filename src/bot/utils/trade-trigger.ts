/**
 * 거래 키워드 감지
 *
 * 자연어 메시지에서 매수/매도 의도를 감지한다.
 * expense fallback과 AI fallback 사이에서 거래 파싱 라우팅에 사용.
 */

const TRADE_KEYWORDS = [
  '샀어', '샀다', '매수했', '매수함',
  '팔았어', '팔았다', '매도했', '매도함',
  '사줘', '팔아줘',
  '주 샀', '주 팔',
]

/**
 * 텍스트에 거래 의도 키워드가 포함되어 있는지 판별
 */
export function isTradeMessage(text: string): boolean {
  return TRADE_KEYWORDS.some((kw) => text.includes(kw))
}
