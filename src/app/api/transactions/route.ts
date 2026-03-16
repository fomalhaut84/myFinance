import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/transactions
 *
 * Query params:
 *   type     — "expense" | "income" (카테고리 type 기준 필터)
 *   year     — 연도 (기본: 올해)
 *   month    — 월 (선택)
 *   offset   — 페이지네이션 (기본 0)
 *   limit    — 페이지 크기 (기본 20, 최대 100)
 *
 * 응답:
 *   transactions — 거래 내역 (최신순)
 *   summary — { totalExpense, totalIncome, count }
 *   byMonth — [{ month, expense, income }] (12개월)
 *   byCategory — [{ categoryId, categoryName, icon, total, count }]
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const type = sp.get('type') ?? undefined
    const yearStr = sp.get('year')
    const monthStr = sp.get('month')
    const offsetStr = sp.get('offset')
    const limitStr = sp.get('limit')

    const currentYear = new Date().getFullYear()
    const year = yearStr && /^\d{4}$/.test(yearStr) ? parseInt(yearStr) : currentYear
    const month = monthStr && /^\d{1,2}$/.test(monthStr) ? parseInt(monthStr) : undefined

    const rawOffset = parseInt(offsetStr ?? '0')
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset
    const rawLimit = parseInt(limitStr ?? '20')
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100)

    // 기간 범위 계산
    let dateFrom: Date
    let dateTo: Date

    if (month) {
      dateFrom = new Date(Date.UTC(year, month - 1, 1))
      dateTo = new Date(Date.UTC(year, month, 1))
    } else {
      dateFrom = new Date(Date.UTC(year, 0, 1))
      dateTo = new Date(Date.UTC(year + 1, 0, 1))
    }

    // 카테고리 타입별 ID 조회
    let categoryIds: string[] | undefined
    if (type) {
      const cats = await prisma.category.findMany({
        where: { type },
        select: { id: true },
      })
      categoryIds = cats.map((c) => c.id)
    }

    const baseWhere = {
      transactedAt: { gte: dateFrom, lt: dateTo },
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    }

    // 병렬 조회: 거래 목록 + 카운트 + 전체 기간 집계 (byMonth/byCategory)
    const [transactions, total, allTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: baseWhere,
        orderBy: [{ transactedAt: 'desc' }, { createdAt: 'desc' }],
        skip: offset,
        take: limit,
        include: {
          category: { select: { name: true, icon: true, type: true } },
        },
      }),
      prisma.transaction.count({ where: baseWhere }),
      // 집계용: 해당 연도 전체 (타입 필터 없이)
      prisma.transaction.findMany({
        where: {
          transactedAt: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        select: {
          amount: true,
          transactedAt: true,
          categoryId: true,
          category: { select: { name: true, icon: true, type: true } },
        },
      }),
    ])

    // byMonth 집계 (12개월)
    const byMonth = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      expense: 0,
      income: 0,
    }))

    // byCategory 집계
    const catMap = new Map<
      string,
      { categoryId: string; categoryName: string; icon: string | null; type: string; total: number; count: number }
    >()

    let totalExpense = 0
    let totalIncome = 0

    for (const tx of allTransactions) {
      const m = tx.transactedAt.getUTCMonth()
      const catType = tx.category.type

      if (catType === 'expense') {
        byMonth[m].expense += tx.amount
        totalExpense += tx.amount
      } else {
        byMonth[m].income += tx.amount
        totalIncome += tx.amount
      }

      // 타입 필터가 있으면 해당 타입만 카테고리 집계
      if (!type || catType === type) {
        const existing = catMap.get(tx.categoryId)
        if (existing) {
          existing.total += tx.amount
          existing.count += 1
        } else {
          catMap.set(tx.categoryId, {
            categoryId: tx.categoryId,
            categoryName: tx.category.name,
            icon: tx.category.icon,
            type: catType,
            total: tx.amount,
            count: 1,
          })
        }
      }
    }

    const byCategory = Array.from(catMap.values()).sort((a, b) => b.total - a.total)

    const serialized = transactions.map((tx) => ({
      id: tx.id,
      amount: tx.amount,
      description: tx.description,
      categoryId: tx.categoryId,
      categoryName: tx.category.name,
      categoryIcon: tx.category.icon,
      categoryType: tx.category.type,
      transactedAt: tx.transactedAt.toISOString(),
      currency: 'KRW',
    }))

    return NextResponse.json({
      transactions: serialized,
      total,
      offset,
      limit,
      summary: {
        totalExpense,
        totalIncome,
        net: totalIncome - totalExpense,
        count: allTransactions.length,
        currency: 'KRW',
      },
      byMonth,
      byCategory,
      year,
    })
  } catch (error) {
    console.error('[api/transactions] GET 실패:', error)
    return NextResponse.json({ error: '거래 내역 조회에 실패했습니다.' }, { status: 500 })
  }
}
