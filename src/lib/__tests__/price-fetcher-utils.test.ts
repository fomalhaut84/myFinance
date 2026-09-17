import { describe, expect, it } from 'vitest'
// price-fetcher 본체 (Prisma / yahoo top-level 로드) 대신 순수 유틸 모듈에서 직접 import →
// Prisma generate / DATABASE_URL 없이도 테스트 가능 (Codex #429 P2).
import {
  mergeCrossTickersIntoMeta,
  isIndexTicker,
  normalizeMarketTime,
} from '../price-fetcher-utils'
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

  it('FX 티커 (`=X`) 는 market="FX" (Codex #428 재재리뷰 P2 회귀 방지)', () => {
    // market='US' 로 두면 normalizeMarket 이 US 매치 먼저 반환 → `=X` suffix 체크 skip →
    // FX 티커가 US-hours-only 로 굳어짐. 명시 'FX' 로 방지.
    const meta = new Map()
    mergeCrossTickersIntoMeta(meta, ['EURUSD=X', 'GBPJPY=X'])
    expect(meta.get('EURUSD=X')?.market).toBe('FX')
    expect(meta.get('GBPJPY=X')?.market).toBe('FX')
  })

  it('doRefreshPrices 흐름과 정합: normalizeMarket 이 US/KR/FX 로 판정 (Codex #428 P2 회귀 방지)', () => {
    // doRefreshPrices 는 `normalizeMarket(meta.market, ticker)` 를 호출해 PriceCache.market 저장.
    // 이전 구현 (`market: '?'`) 은 SPY 를 'OTHER' 로 판정 → 개선 후 'US'/'KR'/'FX' 정확 반환.
    const meta = new Map()
    mergeCrossTickersIntoMeta(meta, ['SPY', 'VIX', 'QQQ', '005930.KS', 'EURUSD=X'])
    expect(normalizeMarket(meta.get('SPY')!.market, 'SPY')).toBe('US')
    expect(normalizeMarket(meta.get('VIX')!.market, 'VIX')).toBe('US')
    expect(normalizeMarket(meta.get('QQQ')!.market, 'QQQ')).toBe('US')
    expect(normalizeMarket(meta.get('005930.KS')!.market, '005930.KS')).toBe('KR')
    expect(normalizeMarket(meta.get('EURUSD=X')!.market, 'EURUSD=X')).toBe('FX')
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

describe('isIndexTicker (#499)', () => {
  it('^ prefix 는 지수', () => {
    expect(isIndexTicker('^KS11')).toBe(true)
    expect(isIndexTicker('^GSPC')).toBe(true)
    expect(isIndexTicker(' ^DJI')).toBe(true)
  })

  it('일반 종목 / ETF / FX 는 지수 아님', () => {
    expect(isIndexTicker('AAPL')).toBe(false)
    expect(isIndexTicker('005930.KS')).toBe(false)
    expect(isIndexTicker('USDKRW=X')).toBe(false)
    expect(isIndexTicker('')).toBe(false)
  })
})

describe('normalizeMarketTime (#499)', () => {
  it('Date 는 그대로', () => {
    const d = new Date('2026-09-17T06:30:00Z')
    expect(normalizeMarketTime(d)?.toISOString()).toBe('2026-09-17T06:30:00.000Z')
  })

  it('epoch seconds 숫자는 ms 로 환산', () => {
    expect(normalizeMarketTime(1789626600)?.toISOString()).toBe('2026-09-17T06:30:00.000Z')
  })

  it('epoch milliseconds 도 같은 시각으로 해석 (단위 오해석 방어)', () => {
    expect(normalizeMarketTime(1789626600000)?.toISOString()).toBe('2026-09-17T06:30:00.000Z')
    expect(normalizeMarketTime(1789626600000)?.getTime()).toBe(normalizeMarketTime(1789626600)?.getTime())
  })

  it('sanity window 밖 (비현실적 과거/미래) 은 null', () => {
    expect(normalizeMarketTime(1e18)).toBeNull()               // 서기 3만년대
    expect(normalizeMarketTime(Date.parse('1970-01-02T00:00:00Z'))).toBeNull()  // 2000 이전
    expect(normalizeMarketTime(Date.now() + 30 * 24 * 3600 * 1000)).toBeNull()  // 30일 미래
  })

  it('가까운 미래 (시계 스큐 허용 범위) 는 수용', () => {
    const soon = Date.now() + 60 * 1000
    expect(normalizeMarketTime(soon)?.getTime()).toBe(soon)
  })

  it('ISO 문자열도 파싱', () => {
    expect(normalizeMarketTime('2026-09-17T06:30:00Z')?.toISOString()).toBe('2026-09-17T06:30:00.000Z')
  })

  it('해석 불가한 값은 null (거짓 시각 생성 금지)', () => {
    expect(normalizeMarketTime(undefined)).toBeNull()
    expect(normalizeMarketTime(null)).toBeNull()
    expect(normalizeMarketTime('')).toBeNull()
    expect(normalizeMarketTime('not-a-date')).toBeNull()
    expect(normalizeMarketTime(0)).toBeNull()
    expect(normalizeMarketTime(Number.NaN)).toBeNull()
    expect(normalizeMarketTime(new Date('invalid'))).toBeNull()
  })
})
