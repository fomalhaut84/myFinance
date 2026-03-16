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
    const rawMonth = monthStr && /^\d{1,2}$/.test(monthStr) ? parseInt(monthStr) : undefined
    const month = rawMonth && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : undefined

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

    // 연간 범위 (byMonth 차트용 — 항상 해당 연도 전체)
    const yearFrom = new Date(Date.UTC(year, 0, 1))
    const yearTo = new Date(Date.UTC(year + 1, 0, 1))

    // 카테고리 조회 (byCategory 집계에 필요)
    const allCategories = await prisma.category.findMany({
      select: { id: true, name: true, icon: true, type: true },
    })
    const categoryMap = new Map(allCategories.map((c) => [c.id, c]))

    // 병렬 조회
    const [transactions, total, annualTransactions, filteredAgg] = await Promise.all([
      // 1) 페이지네이션된 거래 목록
      prisma.transaction.findMany({
        where: baseWhere,
        orderBy: [{ transactedAt: 'desc' }, { createdAt: 'desc' }],
        skip: offset,
        take: limit,
        include: {
          category: { select: { name: true, icon: true, type: true } },
        },
      }),
      // 2) 필터 적용 건수
      prisma.transaction.count({ where: baseWhere }),
      // 3) 연간 전체 거래 (byMonth 차트용, 타입 필터 없이)
      prisma.transaction.findMany({
        where: { transactedAt: { gte: yearFrom, lt: yearTo } },
        select: {
          amount: true,
          transactedAt: true,
          categoryId: true,
        },
      }),
      // 4) 필터 적용된 카테고리별 집계 (summary + byCategory)
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: baseWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ])

    // byMonth 집계 (12개월, 항상 연간)
    const byMonth = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      expense: 0,
      income: 0,
    }))

    for (const tx of annualTransactions) {
      const m = tx.transactedAt.getUTCMonth()
      const cat = categoryMap.get(tx.categoryId)
      if (!cat) continue

      if (cat.type === 'expense') {
        byMonth[m].expense += tx.amount
      } else {
        byMonth[m].income += tx.amount
      }
    }

    // summary + byCategory (필터 적용된 범위)
    let totalExpense = 0
    let totalIncome = 0
    let filteredCount = 0

    const byCategory = filteredAgg
      .map((row) => {
        const cat = categoryMap.get(row.categoryId)
        if (!cat) return null
        const total = row._sum.amount ?? 0
        const count = row._count

        if (cat.type === 'expense') totalExpense += total
        else totalIncome += total
        filteredCount += count

        return {
          categoryId: row.categoryId,
          categoryName: cat.name,
          icon: cat.icon,
          type: cat.type,
          total,
          count,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.total - a.total)

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
        count: filteredCount,
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
