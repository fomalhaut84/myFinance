/**
 * Phase 34-A (#419) — 어닝 캘린더 fetcher.
 * yahoo-finance2 `quoteSummary(ticker, { modules: ['calendarEvents'] })` 사용.
 * 무료. 미국주 위주 — 한국 종목은 대부분 미지원 (nextEarningsDate=null 로 그레이스풀).
 */

import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

export interface EarningsFetchResult {
  ticker: string
  nextEarningsDate: Date | null
  error?: string
}

/**
 * 단일 티커 어닝 조회. 실패해도 예외 던지지 않고 error 필드로 반환.
 * 성공 시 다음 예정 어닝 중 가장 가까운 날짜를 반환.
 */
export async function fetchEarnings(ticker: string): Promise<EarningsFetchResult> {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ['calendarEvents'],
    })
    const raw = result?.calendarEvents?.earnings?.earningsDate
    const dates = Array.isArray(raw) ? raw : raw ? [raw] : []
    const parsed = dates
      .map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())

    // 다음 어닝 = 미래 중 가장 이른 것 (yahoo 는 과거를 넘겨줄 수도 있음)
    const now = Date.now()
    const nextEarningsDate = parsed.find((d) => d.getTime() >= now) ?? null

    return { ticker, nextEarningsDate }
  } catch (error) {
    return {
      ticker,
      nextEarningsDate: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 여러 티커 병렬 조회 (concurrency 제한). yahoo API 부담 방지.
 */
export async function fetchEarningsMany(
  tickers: string[],
  concurrency = 5,
): Promise<EarningsFetchResult[]> {
  const results: EarningsFetchResult[] = []
  const queue = [...tickers]
  const workers = Array.from({ length: Math.min(concurrency, tickers.length) }, async () => {
    while (queue.length > 0) {
      const t = queue.shift()
      if (!t) return
      results.push(await fetchEarnings(t))
    }
  })
  await Promise.all(workers)
  return results
}
