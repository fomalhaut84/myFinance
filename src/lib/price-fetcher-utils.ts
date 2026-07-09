/**
 * price-fetcher 순수 헬퍼 — DB / yahoo-finance2 사이드 이펙트 없이 유닛 테스트 가능.
 * price-fetcher 본체 (Prisma / yahoo 인스턴스 top-level 생성) 에서 분리 (Codex #429 P2).
 */

export interface TickerMetaValue {
  displayName: string
  market: string
  currency: string
}

/**
 * Pure — 활성 전략의 크로스 티커를 tickerMeta 에 병합 (Phase 34-B follow-up / Codex #428/#428 재리뷰 P2).
 * 이미 등록된 티커 (홀딩·관심종목) 는 그대로. 신규 항목만 placeholder 로 삽입.
 *
 * 시장 fallback (Codex #428 재리뷰 P2 반영):
 *   - `doRefreshPrices` 는 `normalizeMarket(meta.market, ticker)` 로 PriceCache.market 을 저장.
 *     이전엔 `'?'` 를 넘겼으나 SPY/QQQ/VIX 등 US 벤치마크는 `.KS`/`.KQ` suffix 도 없어
 *     `normalizeMarket` 이 `'OTHER'` 를 반환 → 이후 사용자가 그 티커를 관심종목에 추가해도
 *     PriceCache 는 이미 `'OTHER'` 로 굳어져 관심종목 시간대 alert 이 skip 됨.
 *   - 대신 실제 값 (`'KR'` / `'US'`) 을 미리 부여해 normalizeMarket 을 정확히 통과시킴.
 *   - `.KS` / `.KQ` suffix → KR, 그 외 → US (미국 벤치마크 위주 사용 실태).
 */
export function mergeCrossTickersIntoMeta(
  tickerMeta: Map<string, TickerMetaValue>,
  crossTickers: Iterable<string>,
): void {
  for (const t of crossTickers) {
    if (tickerMeta.has(t)) continue
    const isKrx = t.endsWith('.KS') || t.endsWith('.KQ')
    tickerMeta.set(t, {
      displayName: t,
      market: isKrx ? 'KR' : 'US',
      currency: isKrx ? 'KRW' : 'USD',
    })
  }
}
