import { prisma } from '@/lib/prisma'
import { calcCostKRW, calcCurrentValueKRW, DEFAULT_FX_RATE_USD_KRW } from '@/lib/format'
import Header from '@/components/layout/Header'
import FamilyTotalCard from '@/components/dashboard/FamilyTotalCard'
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard'
import FxBanner from '@/components/dashboard/FxBanner'
import RefreshButton from '@/components/dashboard/RefreshButton'

export default async function DashboardPage() {
  const [accounts, prices] = await Promise.all([
    prisma.account.findMany({
      include: {
        holdings: { orderBy: { avgPrice: 'desc' } },
        _count: { select: { holdings: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.priceCache.findMany(),
  ])

  const priceMap = new Map(prices.map((p) => [p.ticker, p]))
  const fxData = priceMap.get('USDKRW=X')
  const currentFxRate = fxData?.price ?? DEFAULT_FX_RATE_USD_KRW
  const hasPriceData = prices.length > 0

  const lastUpdatedAt = prices.length > 0
    ? prices.reduce((latest, p) =>
        p.updatedAt > latest ? p.updatedAt : latest,
        prices[0].updatedAt
      )
    : null

  const accountSummaries = accounts.map((account) => {
    const costKRW = account.holdings.reduce(
      (sum, h) => sum + calcCostKRW(h),
      0
    )

    let currentValueKRW = costKRW
    let dailyChangeKRW = 0

    if (hasPriceData) {
      currentValueKRW = account.holdings.reduce((sum, h) => {
        const price = priceMap.get(h.ticker)
        if (!price) return sum + calcCostKRW(h)
        return sum + calcCurrentValueKRW(h, price.price, currentFxRate)
      }, 0)

      dailyChangeKRW = account.holdings.reduce((sum, h) => {
        const price = priceMap.get(h.ticker)
        if (!price || price.change == null) return sum
        if (h.currency === 'USD') {
          return sum + Math.round(price.change * h.shares * currentFxRate)
        }
        return sum + Math.round(price.change * h.shares)
      }, 0)
    }

    const returnPct = costKRW > 0 ? ((currentValueKRW - costKRW) / costKRW) * 100 : 0
    const usCount = account.holdings.filter((h) => h.market === 'US').length
    const krCount = account.holdings.filter((h) => h.market === 'KR').length

    return {
      id: account.id,
      name: account.name,
      ownerAge: account.ownerAge,
      strategy: account.strategy,
      currentValueKRW,
      costKRW,
      returnPct,
      dailyChangeKRW,
      holdingsCount: account._count.holdings,
      usCount,
      krCount,
    }
  })

  return (
    <>
      <Header
        title="대시보드"
        sub="가족 포트폴리오 현황"
      >
        <RefreshButton lastUpdatedAt={lastUpdatedAt?.toISOString() ?? null} />
      </Header>
      <div className="px-8 py-7 max-w-[960px]">
        <FxBanner
          fxRate={fxData?.price ?? null}
          fxChange={fxData?.change ?? null}
          fxChangePercent={fxData?.changePercent ?? null}
        />

        <FamilyTotalCard
          hasPriceData={hasPriceData}
          accounts={accountSummaries.map((a) => ({
            name: a.name,
            currentValueKRW: a.currentValueKRW,
            costKRW: a.costKRW,
            returnPct: a.returnPct,
            holdingsCount: a.holdingsCount,
          }))}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {accountSummaries.map((account) => (
            <AccountSummaryCard
              key={account.id}
              hasPriceData={hasPriceData}
              {...account}
            />
          ))}
        </div>
      </div>
    </>
  )
}
