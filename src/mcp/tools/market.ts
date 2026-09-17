import { prisma } from '@/lib/prisma'
import { fetchQuote } from '@/lib/price-fetcher'
import { formatDate, DEFAULT_FX_RATE_USD_KRW } from '@/lib/format'
import { toolResult, toolError, formatQuoteValue, formatMarketStamp } from '../utils'

/**
 * get_prices: 보유 종목 또는 지정 종목의 현재 시세
 *
 * 지정 종목: fetchQuote로 실시간 조회 (최신가 보장)
 * 전체 보유종목: PriceCache에서 조회 (종목 수가 많을 수 있어 API 부하 방지)
 */
export async function getPrices(args: { tickers?: string[] }) {
  try {
    const isExplicit = args.tickers && args.tickers.length > 0

    // 지정 종목: 실시간 조회 (병렬, 실패 시 캐시 fallback)
    if (isExplicit) {
      const requestedTickers = args.tickers!
      const results = await Promise.allSettled(
        requestedTickers.map((ticker) => fetchQuote(ticker))
      )

      // 종목별로 시세 기준 시각이 다를 수 있어 라인과 stamp 를 분리해 모은 뒤 조합 (#499)
      const entries: { text: string; stamp: string | null }[] = []
      for (let i = 0; i < requestedTickers.length; i++) {
        const ticker = requestedTickers[i]
        const result = results[i]
        if (result.status === 'fulfilled') {
          const quote = result.value
          const priceStr = formatQuoteValue(ticker, quote.price, quote.currency)
          const changeStr = quote.changePercent != null
            ? ` (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`
            : ''
          entries.push({
            text: `- ${quote.displayName} (${ticker}): ${priceStr}${changeStr}`,
            stamp: formatMarketStamp(quote.marketTime, quote.marketState),
          })
        } else {
          // 실시간 실패 → PriceCache fallback
          // (지수 티커는 캐시에 적재하지 않으므로 여기서 미스 → '조회 실패')
          const cached = await prisma.priceCache.findUnique({ where: { ticker } })
          if (cached) {
            const priceStr = formatQuoteValue(ticker, cached.price, cached.currency)
            entries.push({ text: `- ${cached.displayName} (${ticker}): ${priceStr} [캐시]`, stamp: null })
          } else {
            entries.push({ text: `- ${ticker}: 조회 실패`, stamp: null })
          }
        }
      }

      // 모든 라인의 기준 시각이 동일하면 하단 1줄, 다르거나 일부만 있으면 라인별 표기.
      const stamps = entries.map((e) => e.stamp)
      const uniqueStamps = new Set(stamps.filter((s): s is string => s !== null))
      const sharedStamp =
        stamps.length > 0 && stamps.every((s) => s !== null) && uniqueStamps.size === 1
          ? stamps[0]
          : null

      const lines = [`## 실시간 시세 (${requestedTickers.length}종목)`]
      for (const entry of entries) {
        lines.push(
          !sharedStamp && entry.stamp ? `${entry.text} · 시세 기준 ${entry.stamp}` : entry.text,
        )
      }

      const footer: string[] = []
      if (sharedStamp) footer.push(`시세 기준: ${sharedStamp}`)
      footer.push(`조회 시각: ${formatDate(new Date())}`)
      lines.push(`\n${footer.join('\n')}`)

      return toolResult(lines.join('\n'))
    }

    // 전체 보유종목: PriceCache에서 조회
    const holdings = await prisma.holding.findMany({
      select: { ticker: true },
      distinct: ['ticker'],
    })
    const tickers = holdings.map((h) => h.ticker)
    if (tickers.length === 0) {
      return toolResult('보유 종목이 없습니다.')
    }

    const prices = await prisma.priceCache.findMany({
      where: { ticker: { in: tickers } },
      orderBy: { ticker: 'asc' },
    })

    const displayPrices = prices.filter((p) => p.ticker !== 'USDKRW=X')
    if (displayPrices.length === 0) {
      return toolResult('시세 데이터가 없습니다.')
    }

    const lines = [`## 시세 (${displayPrices.length}종목)`]
    for (const p of displayPrices) {
      const priceStr = formatQuoteValue(p.ticker, p.price, p.currency)
      const changeStr = p.changePercent != null
        ? ` (${p.changePercent >= 0 ? '+' : ''}${p.changePercent.toFixed(2)}%)`
        : ''
      lines.push(`- ${p.displayName} (${p.ticker}): ${priceStr}${changeStr} [${p.market}]`)
    }

    const latestUpdate = displayPrices.reduce(
      (latest, p) => (p.updatedAt > latest ? p.updatedAt : latest),
      displayPrices[0].updatedAt
    )
    lines.push(`\n갱신: ${formatDate(latestUpdate)}`)

    return toolResult(lines.join('\n'))
  } catch (error) {
    return toolError(error)
  }
}

/**
 * get_fx_rate: 현재 원/달러 환율
 */
export async function getFxRate() {
  try {
    const fx = await prisma.priceCache.findUnique({
      where: { ticker: 'USDKRW=X' },
    })

    if (!fx) {
      return toolResult(
        `환율 데이터 없음. 기본값 사용: ${DEFAULT_FX_RATE_USD_KRW.toLocaleString('ko-KR')}원/달러`
      )
    }

    const changeStr =
      fx.changePercent != null
        ? ` (${fx.changePercent >= 0 ? '+' : ''}${fx.changePercent.toFixed(2)}%)`
        : ''

    return toolResult(
      `USD/KRW: ${fx.price.toLocaleString('ko-KR')}원${changeStr}\n갱신: ${formatDate(fx.updatedAt)}`
    )
  } catch (error) {
    return toolError(error)
  }
}
