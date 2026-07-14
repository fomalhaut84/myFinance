/**
 * Phase 38-A (#448) — parser 프롬프트 문서화 회귀 방지.
 *
 * Codex #457 P2: 스키마 확장 (types.ts 의 CrossTickerMetric) 만으로는 자연어 진입
 * 경로 (parseStrategyText / editStrategyByNL) 가 새 metric 을 생성할 수 없다.
 * AI 프롬프트가 metric 목록·인코딩·예시를 명시해야 사용자가 실제로 활용 가능.
 *
 * PROMPT_HEADER 는 등록/편집 양쪽에서 재사용되므로 여기서 한번 검증하면 두 경로
 * 모두 커버.
 */

import { describe, expect, it } from 'vitest'
import { PROMPT_HEADER } from '../parser'

describe('PROMPT_HEADER — cross_ticker 신규 metric 문서화 (Phase 38-A #448 회귀)', () => {
  it('metric 4종 이름을 모두 언급', () => {
    expect(PROMPT_HEADER).toContain('"rsi"')
    expect(PROMPT_HEADER).toContain('"macd_signal"')
    expect(PROMPT_HEADER).toContain('"sma_cross"')
    expect(PROMPT_HEADER).toContain('"bb_position"')
  })

  it('카테고리컬 metric 은 == operator 만 허용됨을 명시', () => {
    // 3종 모두 "==" 로만 쓸 수 있음을 언급 — AI 가 다른 operator 를 생성하지 않도록.
    expect(PROMPT_HEADER).toContain('operator 는 "==" 만')
  })

  it('정수 인코딩 컨벤션 (1=GOLDEN, 0=NONE/WITHIN, -1=DEAD/BELOW) 명시', () => {
    expect(PROMPT_HEADER).toMatch(/1=GOLDEN/)
    expect(PROMPT_HEADER).toMatch(/-1=DEAD/)
    expect(PROMPT_HEADER).toMatch(/1=ABOVE_UPPER/)
    expect(PROMPT_HEADER).toMatch(/-1=BELOW_LOWER/)
  })

  it('rsi 값 범위 (0~100) 명시', () => {
    expect(PROMPT_HEADER).toContain('0~100')
  })

  it('cross_ticker v3 예시에 각 신규 metric 이 실제 JSON 으로 등장', () => {
    // 예시 없이 목록만 보면 AI 가 필드명을 유추 실패할 수 있음 — 실 JSON 예시 필수.
    expect(PROMPT_HEADER).toMatch(/"metric":"rsi"/)
    expect(PROMPT_HEADER).toMatch(/"metric":"macd_signal"/)
    expect(PROMPT_HEADER).toMatch(/"metric":"sma_cross"/)
    expect(PROMPT_HEADER).toMatch(/"metric":"bb_position"/)
  })
})
