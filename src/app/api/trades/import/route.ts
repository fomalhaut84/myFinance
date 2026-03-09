import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recalcHolding, calcTotalKRW, validateTradeInput } from '@/lib/trade-utils'
import type { ImportResult } from '@/types/csv-import'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 500

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accountId, market, currency, skipDuplicates, trades } = body

    if (!accountId || !market || !currency || !Array.isArray(trades)) {
      return NextResponse.json(
        { error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      )
    }

    if (!['US', 'KR'].includes(market)) {
      return NextResponse.json({ error: '잘못된 시장입니다.' }, { status: 400 })
    }
    if (!['USD', 'KRW'].includes(currency)) {
      return NextResponse.json({ error: '잘못된 통화입니다.' }, { status: 400 })
    }
    if (market === 'US' && currency !== 'USD') {
      return NextResponse.json({ error: 'US 시장은 USD만 가능합니다.' }, { status: 400 })
    }
    if (market === 'KR' && currency !== 'KRW') {
      return NextResponse.json({ error: 'KR 시장은 KRW만 가능합니다.' }, { status: 400 })
    }

    if (trades.length === 0) {
      return NextResponse.json({ error: '임포트할 거래가 없습니다.' }, { status: 400 })
    }
    if (trades.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `최대 ${MAX_ROWS}건까지 임포트 가능합니다.` },
        { status: 400 }
      )
    }

    // 계좌 존재 확인
    const account = await prisma.account.findUnique({ where: { id: accountId } })
    if (!account) {
      return NextResponse.json({ error: '계좌를 찾을 수 없습니다.' }, { status: 404 })
    }

    // 각 행 검증
    const validTrades: Array<{
      index: number
      ticker: string
      displayName: string
      type: 'BUY' | 'SELL'
      shares: number
      price: number
      fxRate: number | null
      tradedAt: string
      note: string | null
    }> = []
    const resultErrors: ImportResult['errors'] = []

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      const errors = validateTradeInput({
        accountId,
        ticker: t.ticker,
        displayName: t.displayName || t.ticker,
        market,
        type: t.type,
        shares: t.shares,
        price: t.price,
        currency,
        fxRate: currency === 'USD' ? t.fxRate : null,
        tradedAt: t.tradedAt,
      })

      if (errors.length > 0) {
        for (const e of errors) {
          resultErrors.push({ row: i + 1, field: e.field, message: e.message })
        }
      } else {
        validTrades.push({
          index: i,
          ticker: (t.ticker as string).toUpperCase().trim(),
          displayName: (t.displayName || t.ticker) as string,
          type: t.type,
          shares: t.shares,
          price: t.price,
          fxRate: currency === 'USD' ? (t.fxRate ?? null) : null,
          tradedAt: t.tradedAt,
          note: t.note || null,
        })
      }
    }

    // 중복 감지용 기존 거래 조회
    const tickers = Array.from(new Set(validTrades.map((t) => t.ticker)))
    const existingTrades = await prisma.trade.findMany({
      where: { accountId, ticker: { in: tickers } },
      select: { ticker: true, tradedAt: true, shares: true, price: true },
    })

    const existingSet = new Set(
      existingTrades.map((t) => {
        const d = t.tradedAt instanceof Date ? t.tradedAt : new Date(t.tradedAt)
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        return `${t.ticker}|${dateStr}|${t.shares}|${t.price}`
      })
    )

    const toCreate: typeof validTrades = []
    let skipped = 0

    for (const t of validTrades) {
      const dateStr = t.tradedAt.slice(0, 10) // YYYY-MM-DD
      const key = `${t.ticker}|${dateStr}|${t.shares}|${t.price}`
      if (existingSet.has(key)) {
        if (skipDuplicates) {
          skipped++
          continue
        }
      }
      toCreate.push(t)
    }

    if (toCreate.length === 0) {
      const result: ImportResult = {
        total: trades.length,
        created: 0,
        skipped,
        failed: resultErrors.length > 0 ? trades.length - skipped : 0,
        errors: resultErrors,
      }
      return NextResponse.json({ result }, { status: 201 })
    }

    // Serializable 트랜잭션: 일괄 생성 + Holding 재계산
    const created = await prisma.$transaction(async (tx) => {
      const createdTrades = []

      for (const t of toCreate) {
        const totalKRW = calcTotalKRW(t.price, t.shares, currency, t.fxRate)
        const trade = await tx.trade.create({
          data: {
            accountId,
            ticker: t.ticker,
            displayName: t.displayName,
            market,
            type: t.type,
            shares: t.shares,
            price: t.price,
            currency,
            fxRate: t.fxRate,
            totalKRW,
            note: t.note,
            tradedAt: new Date(t.tradedAt),
          },
        })
        createdTrades.push(trade)
      }

      // 영향받은 ticker별 Holding 재계산
      const affectedTickers = Array.from(new Set(toCreate.map((t) => t.ticker)))
      for (const ticker of affectedTickers) {
        const allTrades = await tx.trade.findMany({
          where: { accountId, ticker },
          orderBy: [{ tradedAt: 'asc' }, { createdAt: 'asc' }],
          select: { type: true, shares: true, price: true, currency: true, fxRate: true },
        })

        const holdingState = recalcHolding(allTrades)
        const sampleTrade = toCreate.find((t) => t.ticker === ticker)!

        if (holdingState.shares > 0) {
          await tx.holding.upsert({
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
              displayName: sampleTrade.displayName,
              market,
              shares: holdingState.shares,
              avgPrice: holdingState.avgPrice,
              currency,
              avgPriceFx: holdingState.avgPriceFx,
              avgFxRate: holdingState.avgFxRate,
            },
          })
        } else {
          await tx.holding.deleteMany({ where: { accountId, ticker } })
        }
      }

      return createdTrades.length
    }, { isolationLevel: 'Serializable' })

    const result: ImportResult = {
      total: trades.length,
      created,
      skipped,
      failed: resultErrors.length > 0 ? trades.length - created - skipped : 0,
      errors: resultErrors,
    }

    return NextResponse.json({ result }, { status: 201 })
  } catch (error) {
    console.error('POST /api/trades/import error:', error)
    return NextResponse.json(
      { error: '거래 일괄 등록에 실패했습니다.' },
      { status: 500 }
    )
  }
}
