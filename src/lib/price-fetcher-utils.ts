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
 * Pure — 활성 전략의 크로스 티커를 tickerMeta 에 병합 (Phase 34-B follow-up, Codex #428 x2 P2 반영).
 * 이미 등록된 티커 (홀딩·관심종목) 는 그대로. 신규 항목만 placeholder 로 삽입.
 *
 * 시장 fallback:
 *   - `doRefreshPrices` 는 `normalizeMarket(meta.market, ticker)` 로 PriceCache.market 을 저장.
 *     `normalizeMarket` 은 market 문자열 매치를 먼저 시도하고, 실패해야 ticker suffix 로 fallback.
 *     즉 `market='US'` 로 두면 US 매치 즉시 반환 → `=X` FX suffix 체크 스킵 → FX 회귀.
 *   - suffix 로부터 정확한 값을 명시:
 *     - `.KS` / `.KQ` → 'KR' (KRW)
 *     - `=X` → 'FX' (currency 는 pair 정확 반영이 어려워 USD 로 통일 — USDKRW=X 는 상위 흐름
 *       (`doRefreshPrices` FX_TICKER 오버라이드) 이 덮어씀)
 *     - 그 외 (SPY/VIX/QQQ 등) → 'US' (USD) — 사용실태상 US 벤치마크가 대다수
 *   - 이렇게 하면 이후 사용자가 그 티커를 관심종목에 추가해도 PriceCache 는 이미 정확 값이라
 *     시간대 alert 이 skip 되지 않음.
 */
export function mergeCrossTickersIntoMeta(
  tickerMeta: Map<string, TickerMetaValue>,
  crossTickers: Iterable<string>,
): void {
  for (const t of crossTickers) {
    if (tickerMeta.has(t)) continue
    const isKrx = t.endsWith('.KS') || t.endsWith('.KQ')
    const isFx = t.endsWith('=X')
    tickerMeta.set(t, {
      displayName: t,
      market: isKrx ? 'KR' : isFx ? 'FX' : 'US',
      currency: isKrx ? 'KRW' : 'USD',
    })
  }
}

/**
 * 지수 티커 판별 (#499). 야후는 지수를 `^` prefix 로 제공한다 (`^KS11`, `^GSPC` 등).
 * 지수는 (1) 통화가 아니라 포인트로 표기하고 (2) 보유·관심종목이 아니라
 * 주가 갱신 cron 의 refresh 대상이 아니므로 PriceCache 에 적재하지 않는다.
 */
export function isIndexTicker(ticker: string): boolean {
  return ticker.trim().startsWith('^')
}

/**
 * yahoo-finance2 의 `regularMarketTime` 정규화 (#499).
 *
 * 라이브러리/응답 버전에 따라 `Date` 또는 epoch seconds (숫자) 로 오고,
 * 드물게 ISO 문자열로도 온다. 해석 불가하면 `null` — 거짓 시각을 만들지 않는다.
 */
export function normalizeMarketTime(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // epoch seconds 로 간주 (야후 raw 응답 규격). 0 이하는 무효로 취급.
    if (raw <= 0) return null
    const d = new Date(raw * 1000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}
