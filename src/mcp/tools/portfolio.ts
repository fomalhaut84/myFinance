import { prisma } from '@/lib/prisma'
import {
  calcProfitLoss,
  calcCostKRW,
  calcCurrentValueKRW,
  formatDate,
  DEFAULT_FX_RATE_USD_KRW,
} from '@/lib/format'
import {
  resolveAccountId,
  getAllAccountIds,
  toolResult,
  toolError,
  formatMoney,
} from '../utils'

/**
 * get_portfolio: 계좌별 보유 종목 + 손익 현황
 */
export async function getPortfolio(args: { account_name: string }) {
  try {
    const accountId = await resolveAccountId(args.account_name)

    // 환율 조회
    const fxCache = await prisma.priceCache.findUnique({
      where: { ticker: 'USDKRW=X' },
    })
    const fxRate = fxCache?.price ?? DEFAULT_FX_RATE_USD_KRW

    const accounts =
      accountId != null
        ? [{ id: accountId, name: args.account_name }]
        : await getAllAccountIds()

    const results: string[] = []

    for (const account of accounts) {
      const holdings = await prisma.holding.findMany({
        where: { accountId: account.id },
        orderBy: { ticker: 'asc' },
      })

      if (holdings.length === 0) {
        results.push(`## ${account.name}\n보유 종목 없음`)
        continue
      }

      // 현재가 조회
      const tickers = holdings.map((h) => h.ticker)
      const prices = await prisma.priceCache.findMany({
        where: { ticker: { in: tickers } },
      })
      const priceMap = new Map(prices.map((p) => [p.ticker, p]))

      let totalCost = 0
      let totalValue = 0
      const lines: string[] = [`## ${account.name}`]

      for (const h of holdings) {
        const price = priceMap.get(h.ticker)
        const currentPrice = price?.price ?? 0
        const currentFxRate = h.currency === 'USD' ? fxRate : 1

        const cost = calcCostKRW(h)
        const value = calcCurrentValueKRW(h, currentPrice, currentFxRate)
        const pl = calcProfitLoss(h, currentPrice, currentFxRate)

        totalCost += cost
        totalValue += value

        const priceStr =
          h.currency === 'USD'
            ? `$${currentPrice.toFixed(2)}`
            : `${currentPrice.toLocaleString('ko-KR')}원`

        lines.push(
          `- ${h.displayName} (${h.ticker}): ${h.shares}주 × ${priceStr}` +
            ` = ${formatMoney(value, 'KRW')}` +
            ` | 손익 ${formatMoney(pl.totalPL, 'KRW')} (${pl.returnPct >= 0 ? '+' : ''}${pl.returnPct.toFixed(1)}%)`
        )
      }

      const totalPL = totalValue - totalCost
      const totalReturn = totalCost > 0 ? (totalPL / totalCost) * 100 : 0
      lines.push(
        `\n**합계**: 평가금 ${formatMoney(totalValue, 'KRW')}` +
          ` | 매입금 ${formatMoney(totalCost, 'KRW')}` +
          ` | 손익 ${formatMoney(totalPL, 'KRW')} (${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%)`
      )
      lines.push(`환율: ${fxRate.toLocaleString('ko-KR')}원/달러`)

      results.push(lines.join('\n'))
    }

    return toolResult(results.join('\n\n'))
  } catch (error) {
    return toolError(error)
  }
}

/**
 * get_trades: 최근 거래 내역 조회
 */
export async function getTrades(args: {
  account_name: string
  days?: number
}) {
  try {
    const accountId = await resolveAccountId(args.account_name)
    const days = args.days ?? 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const accounts =
      accountId != null
        ? [{ id: accountId, name: args.account_name }]
        : await getAllAccountIds()

    const results: string[] = []

    for (const account of accounts) {
      const trades = await prisma.trade.findMany({
        where: {
          accountId: account.id,
          tradedAt: { gte: since },
        },
        orderBy: { tradedAt: 'desc' },
      })

      if (trades.length === 0) {
        results.push(`## ${account.name}\n최근 ${days}일간 거래 없음`)
        continue
      }

      const lines = [`## ${account.name} (최근 ${days}일, ${trades.length}건)`]
      for (const t of trades) {
        const typeLabel = t.type === 'BUY' ? '매수' : '매도'
        const priceStr = formatMoney(t.price, t.currency)
        lines.push(
          `- ${formatDate(t.tradedAt)} ${typeLabel} ${t.displayName} (${t.ticker})` +
            ` ${t.shares}주 × ${priceStr}` +
            ` = ${formatMoney(t.totalKRW, 'KRW')}`
        )
      }

      results.push(lines.join('\n'))
    }

    return toolResult(results.join('\n\n'))
  } catch (error) {
    return toolError(error)
  }
}
