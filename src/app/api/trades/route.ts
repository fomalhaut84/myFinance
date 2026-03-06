import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recalcHolding, calcTotalKRW, validateTradeInput } from '@/lib/trade-utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const accountId = searchParams.get('accountId')
    const ticker = searchParams.get('ticker')
    const type = searchParams.get('type')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
    const offset = parseInt(searchParams.get('offset') ?? '0')

    const where: Record<string, unknown> = {}
    if (accountId) where.accountId = accountId
    if (ticker) where.ticker = ticker
    if (type) where.type = type
    if (from || to) {
      where.tradedAt = {}
      if (from) (where.tradedAt as Record<string, unknown>).gte = new Date(from)
      if (to) (where.tradedAt as Record<string, unknown>).lte = new Date(to)
    }

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where,
        orderBy: { tradedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { account: { select: { name: true } } },
      }),
      prisma.trade.count({ where }),
    ])

    return NextResponse.json({ trades, total, limit, offset })
  } catch (error) {
    console.error('GET /api/trades error:', error)
    return NextResponse.json(
      { error: '거래 내역을 불러올 수 없습니다.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const errors = validateTradeInput(body)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0].message, errors }, { status: 400 })
    }

    const { accountId, ticker, displayName, market, type, shares, price, currency, fxRate, note, tradedAt } = body
    const totalKRW = calcTotalKRW(price, shares, currency, fxRate)

    // 계좌 존재 확인
    const account = await prisma.account.findUnique({ where: { id: accountId } })
    if (!account) {
      return NextResponse.json({ error: '계좌를 찾을 수 없습니다.' }, { status: 404 })
    }

    // SELL: 보유수량 확인
    if (type === 'SELL') {
      const holding = await prisma.holding.findUnique({
        where: { accountId_ticker: { accountId, ticker } },
      })
      if (!holding || holding.shares < shares) {
        const current = holding?.shares ?? 0
        return NextResponse.json(
          { error: `보유 수량(${current}주)을 초과합니다.` },
          { status: 400 }
        )
      }
    }

    // Transaction: Trade 생성 + Holding 업데이트
    const result = await prisma.$transaction(async (tx) => {
      const trade = await tx.trade.create({
        data: {
          accountId,
          ticker,
          displayName,
          market,
          type,
          shares,
          price,
          currency,
          fxRate: currency === 'USD' ? fxRate : null,
          totalKRW,
          note: note || null,
          tradedAt: new Date(tradedAt),
        },
      })

      // 해당 계좌+종목의 전체 거래로 Holding 재계산
      const allTrades = await tx.trade.findMany({
        where: { accountId, ticker },
        orderBy: { tradedAt: 'asc' },
        select: { type: true, shares: true, price: true, currency: true, fxRate: true },
      })

      const holdingState = recalcHolding(allTrades)

      let holding = null
      if (holdingState.shares > 0) {
        holding = await tx.holding.upsert({
          where: { accountId_ticker: { accountId, ticker } },
          update: {
            shares: holdingState.shares,
            avgPrice: holdingState.avgPrice,
            avgPriceFx: holdingState.avgPriceFx,
            avgFxRate: holdingState.avgFxRate,
          },
          create: {
            accountId,
            ticker,
            displayName,
            market,
            shares: holdingState.shares,
            avgPrice: holdingState.avgPrice,
            currency,
            avgPriceFx: holdingState.avgPriceFx,
            avgFxRate: holdingState.avgFxRate,
          },
        })
      } else {
        // 전량 매도 → Holding 삭제
        await tx.holding.deleteMany({
          where: { accountId, ticker },
        })
      }

      return { trade, holding }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('POST /api/trades error:', error)
    return NextResponse.json(
      { error: '거래 기록에 실패했습니다.' },
      { status: 500 }
    )
  }
}
