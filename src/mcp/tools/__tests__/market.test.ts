/**
 * #499 회귀 — get_prices 출력의 지수 포인트 표기 + 시세 기준 시각.
 *
 * 1) 지수 (^KS11) 가 "6,717원" 처럼 통화로 표기되면 안 된다.
 * 2) 반환값이 언제 기준인지 (marketTime/marketState) 출력에 드러나야 한다.
 * 3) marketTime 이 없으면 거짓 시각을 만들지 않고 표기를 생략한다.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    priceCache: { findUnique: vi.fn(), findMany: vi.fn() },
    holding: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/price-fetcher', () => ({ fetchQuote: vi.fn() }))

import { getPrices } from '../market'
import { fetchQuote } from '@/lib/price-fetcher'
import { prisma } from '@/lib/prisma'

// 2026-09-17 15:30 KST = 2026-09-17 06:30 UTC (한국장 마감)
const KR_CLOSE = new Date('2026-09-17T06:30:00Z')

function kospiQuote(overrides: Record<string, unknown> = {}) {
  return {
    ticker: '^KS11',
    displayName: 'KOSPI Composite Index',
    price: 6717.28,
    currency: 'KRW',
    market: 'KR',
    change: -12.3,
    changePercent: -0.18,
    marketTime: KR_CLOSE,
    marketState: 'CLOSED',
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(fetchQuote).mockReset()
  vi.mocked(prisma.priceCache.findUnique).mockReset()
})

describe('getPrices — 지수 티커 표기 (#499)', () => {
  it('지수는 원화가 아니라 포인트로 표기', async () => {
    vi.mocked(fetchQuote).mockResolvedValueOnce(kospiQuote())

    const result = await getPrices({ tickers: ['^KS11'] })
    const text = result.content[0].text

    expect(text).toContain('6,717.28')
    expect(text).not.toContain('원')
    expect(text).not.toContain('$')
  })

  it('시세 기준 시각 + 장 상태 라벨을 표기', async () => {
    vi.mocked(fetchQuote).mockResolvedValueOnce(kospiQuote())

    const text = (await getPrices({ tickers: ['^KS11'] })).content[0].text

    expect(text).toContain('시세 기준: 09-17 15:30 KST (마감)')
    // 호출 시각 라인은 별개 의미로 유지
    expect(text).toContain('조회 시각:')
  })

  it('marketTime 이 없으면 시세 기준 라인을 생략', async () => {
    vi.mocked(fetchQuote).mockResolvedValueOnce(
      kospiQuote({ marketTime: null, marketState: null }),
    )

    const text = (await getPrices({ tickers: ['^KS11'] })).content[0].text

    expect(text).not.toContain('시세 기준')
    expect(text).toContain('조회 시각:')
  })

  it('기준 시각이 종목별로 다르면 라인별로 표기', async () => {
    vi.mocked(fetchQuote)
      .mockResolvedValueOnce(kospiQuote())
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        displayName: 'Apple Inc.',
        price: 252.82,
        currency: 'USD',
        market: 'US',
        change: 1.1,
        changePercent: 0.44,
        marketTime: new Date('2026-09-16T20:00:00Z'), // 09-17 05:00 KST
        marketState: 'REGULAR',
      })

    const text = (await getPrices({ tickers: ['^KS11', 'AAPL'] })).content[0].text

    expect(text).toContain('· 시세 기준 09-17 15:30 KST (마감)')
    expect(text).toContain('· 시세 기준 09-17 05:00 KST (장중)')
    expect(text).not.toContain('\n시세 기준:')
    expect(text).toContain('$252.82')
  })

  it('지수 실시간 실패 + 캐시 미스 → 조회 실패 (stale 캐시 유입 없음)', async () => {
    vi.mocked(fetchQuote).mockRejectedValueOnce(new Error('network'))
    vi.mocked(prisma.priceCache.findUnique).mockResolvedValueOnce(null)

    const text = (await getPrices({ tickers: ['^KS11'] })).content[0].text

    expect(text).toContain('^KS11: 조회 실패')
  })
})
