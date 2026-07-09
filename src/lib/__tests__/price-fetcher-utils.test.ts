import { describe, expect, it } from 'vitest'
// price-fetcher 본체 (Prisma / yahoo top-level 로드) 대신 순수 유틸 모듈에서 직접 import →
// Prisma generate / DATABASE_URL 없이도 테스트 가능 (Codex #429 P2).
import { mergeCrossTickersIntoMeta } from '../price-fetcher-utils'
import { normalizeMarket } from '../market-hours'

describe('mergeCrossTickersIntoMeta (Codex #428 P2 회귀 방지)', () => {
  it('신규 US 벤치마크는 market="US" / currency="USD" 로 삽입', () => {
    const meta = new Map()
    mergeCrossTickersIntoMeta(meta, ['SPY', 'VIX'])
    expect(meta.get('SPY')).toEqual({ displayName: 'SPY', market: 'US', currency: 'USD' })
    expect(meta.get('VIX')).toEqual({ displayName: 'VIX', market: 'US', currency: 'USD' })
  })

  it('KRX suffix (.KS/.KQ) 는 market="KR" / currency="KRW"', () => {
    const meta = new Map()
    mergeCrossTickersIntoMeta(meta, ['005930.KS', '035720.KS', '091990.KQ'])
    expect(meta.get('005930.KS')).toEqual({ displayName: '005930.KS', market: 'KR', currency: 'KRW' })
    expect(meta.get('091990.KQ')?.market).toBe('KR')
    expect(meta.get('091990.KQ')?.currency).toBe('KRW')
  })

  it('doRefreshPrices 흐름과 정합: normalizeMarket 이 US/KR 로 판정 (Codex #428 재리뷰 P2 회귀 방지)', () => {
    // doRefreshPrices 는 `normalizeMarket(meta.market, ticker)` 를 호출해 PriceCache.market 저장.
    // 이전 구현 (`market: '?'`) 은 SPY 처럼 suffix 없는 US 벤치마크를 'OTHER' 로 판정 →
    // 이후 관심종목 추가 시 시간대 alert 이 skip. 새 fallback 은 실제 값 반환해야 함.
    const meta = new Map()
    mergeCrossTickersIntoMeta(meta, ['SPY', 'VIX', 'QQQ', '005930.KS'])
    expect(normalizeMarket(meta.get('SPY')!.market, 'SPY')).toBe('US')
    expect(normalizeMarket(meta.get('VIX')!.market, 'VIX')).toBe('US')
    expect(normalizeMarket(meta.get('QQQ')!.market, 'QQQ')).toBe('US')
    expect(normalizeMarket(meta.get('005930.KS')!.market, '005930.KS')).toBe('KR')
  })

  it('이미 등록된 티커는 덮어쓰지 않음 (holdings/watchlist 메타 우선)', () => {
    const meta = new Map([['SPY', { displayName: 'S&P 500 ETF', market: 'US', currency: 'USD' }]])
    mergeCrossTickersIntoMeta(meta, ['SPY', 'VIX'])
    expect(meta.get('SPY')).toEqual({ displayName: 'S&P 500 ETF', market: 'US', currency: 'USD' })
    expect(meta.get('VIX')?.displayName).toBe('VIX')
  })

  it('빈 crossTickers → 원본 그대로', () => {
    const meta = new Map([['AAPL', { displayName: 'Apple', market: 'US', currency: 'USD' }]])
    const before = new Map(meta)
    mergeCrossTickersIntoMeta(meta, [])
    expect(meta).toEqual(before)
  })

  it('Set 타입도 수용 (Iterable 인터페이스)', () => {
    const meta = new Map()
    mergeCrossTickersIntoMeta(meta, new Set(['SPY', 'QQQ']))
    expect(meta.has('SPY')).toBe(true)
    expect(meta.has('QQQ')).toBe(true)
  })
})
