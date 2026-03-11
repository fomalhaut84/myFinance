import { prisma } from '@/lib/prisma'
import { periodToStartDate } from './constants'

interface TWRResult {
  accountId: string
  accountName: string
  twr: number | null          // TWR 수익률 (%)
  benchmarkReturn: number | null  // 벤치마크 수익률 (%)
  alpha: number | null        // 초과수익률 (%)
  benchmarkTicker: string | null
  snapshotCount: number
  fallbackSimple: boolean     // 단순수익률 폴백 여부
}

/**
 * TWR(Time-Weighted Return) 계산
 *
 * 1. 기간 내 스냅샷 조회 (날짜순)
 * 2. 기간 내 현금흐름(Trade + Deposit) 조회 (날짜순)
 * 3. 현금흐름 발생일 기준 sub-period 분할
 * 4. 각 sub-period: HPR_i = (V_end - CF) / V_start - 1
 *    CF = 해당일 입금 + 매수금 - 매도금
 * 5. TWR = prod(1 + HPR_i) - 1
 */
export async function calculateTWR(
  accountId: string,
  period: string
): Promise<TWRResult> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { name: true, benchmarkTicker: true },
  })

  const startDate = periodToStartDate(period)

  const snapshots = await prisma.portfolioSnapshot.findMany({
    where: {
      accountId,
      ...(startDate ? { snapshotDate: { gte: startDate } } : {}),
    },
    orderBy: { snapshotDate: 'asc' },
    select: { snapshotDate: true, totalValueKRW: true },
  })

  if (snapshots.length < 2) {
    return {
      accountId,
      accountName: account.name,
      twr: null,
      benchmarkReturn: null,
      alpha: null,
      benchmarkTicker: account.benchmarkTicker,
      snapshotCount: snapshots.length,
      fallbackSimple: false,
    }
  }

  const periodStart = snapshots[0].snapshotDate
  const periodEnd = snapshots[snapshots.length - 1].snapshotDate

  // 현금흐름 조회
  const [trades, deposits] = await Promise.all([
    prisma.trade.findMany({
      where: {
        accountId,
        tradedAt: { gte: periodStart, lte: periodEnd },
      },
      select: { tradedAt: true, type: true, totalKRW: true },
      orderBy: { tradedAt: 'asc' },
    }),
    prisma.deposit.findMany({
      where: {
        accountId,
        depositedAt: { gte: periodStart, lte: periodEnd },
      },
      select: { depositedAt: true, amount: true },
      orderBy: { depositedAt: 'asc' },
    }),
  ])

  // 날짜별 현금흐름 집계
  const cashFlowByDate = new Map<string, number>()
  for (const trade of trades) {
    const dateKey = trade.tradedAt.toISOString().slice(0, 10)
    const cf = trade.type === 'BUY' ? trade.totalKRW : -trade.totalKRW
    cashFlowByDate.set(dateKey, (cashFlowByDate.get(dateKey) ?? 0) + cf)
  }
  for (const deposit of deposits) {
    const dateKey = deposit.depositedAt.toISOString().slice(0, 10)
    cashFlowByDate.set(dateKey, (cashFlowByDate.get(dateKey) ?? 0) + deposit.amount)
  }

  // 스냅샷을 날짜별로 매핑
  const snapshotByDate = new Map<string, number>()
  for (const s of snapshots) {
    snapshotByDate.set(s.snapshotDate.toISOString().slice(0, 10), s.totalValueKRW)
  }

  // TWR 계산: sub-period 분할
  let twrProduct = 1

  for (let i = 1; i < snapshots.length; i++) {
    const vStart = snapshots[i - 1].totalValueKRW
    const vEnd = snapshots[i].totalValueKRW

    // 이 sub-period 내 현금흐름 합산
    const startDateKey = snapshots[i - 1].snapshotDate.toISOString().slice(0, 10)
    const endDateKey = snapshots[i].snapshotDate.toISOString().slice(0, 10)

    let cf = 0
    cashFlowByDate.forEach((amount, dateKey) => {
      if (dateKey > startDateKey && dateKey <= endDateKey) {
        cf += amount
      }
    })

    if (vStart === 0) {
      // 시작 가치 0이면 sub-period 스킵
      continue
    }

    // HPR = (V_end - CF) / V_start - 1
    const hpr = (vEnd - cf) / vStart - 1
    twrProduct *= (1 + hpr)
  }

  const twr = (twrProduct - 1) * 100

  // 벤치마크 수익률
  let benchmarkReturn: number | null = null
  if (account.benchmarkTicker) {
    benchmarkReturn = await calculateBenchmarkReturn(
      account.benchmarkTicker,
      periodStart,
      periodEnd
    )
  }

  const alpha = twr != null && benchmarkReturn != null ? twr - benchmarkReturn : null

  return {
    accountId,
    accountName: account.name,
    twr,
    benchmarkReturn,
    alpha,
    benchmarkTicker: account.benchmarkTicker,
    snapshotCount: snapshots.length,
    fallbackSimple: false,
  }
}

async function calculateBenchmarkReturn(
  ticker: string,
  startDate: Date,
  endDate: Date
): Promise<number | null> {
  const prices = await prisma.benchmarkPrice.findMany({
    where: {
      ticker,
      priceDate: { gte: startDate, lte: endDate },
    },
    orderBy: { priceDate: 'asc' },
    select: { close: true },
  })

  if (prices.length < 2) return null

  const startPrice = prices[0].close
  const endPrice = prices[prices.length - 1].close

  if (startPrice === 0) return null
  return ((endPrice / startPrice) - 1) * 100
}
