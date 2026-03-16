import Header from '@/components/layout/Header'
import ExpensesClient from './ExpensesClient'

export const dynamic = 'force-dynamic'

async function fetchInitialData() {
  const currentYear = new Date().getFullYear()
  const { prisma } = await import('@/lib/prisma')

  const dateFrom = new Date(Date.UTC(currentYear, 0, 1))
  const dateTo = new Date(Date.UTC(currentYear + 1, 0, 1))

  const [transactions, total, allTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { transactedAt: { gte: dateFrom, lt: dateTo } },
      orderBy: [{ transactedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      include: {
        category: { select: { name: true, icon: true, type: true } },
      },
    }),
    prisma.transaction.count({
      where: { transactedAt: { gte: dateFrom, lt: dateTo } },
    }),
    prisma.transaction.findMany({
      where: { transactedAt: { gte: dateFrom, lt: dateTo } },
      select: {
        amount: true,
        transactedAt: true,
        categoryId: true,
        category: { select: { name: true, icon: true, type: true } },
      },
    }),
  ])

  const byMonth = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    expense: 0,
    income: 0,
  }))

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
    currency: 'KRW' as const,
  }))

  return {
    transactions: serialized,
    total,
    offset: 0,
    limit: 20,
    summary: {
      totalExpense,
      totalIncome,
      net: totalIncome - totalExpense,
      count: allTransactions.length,
    },
    byMonth,
    byCategory,
    year: currentYear,
  }
}

export default async function ExpensesPage() {
  const initialData = await fetchInitialData()

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-7 max-w-[1100px]">
      <Header title="가계부" sub={`${initialData.year}년 거래 ${initialData.summary.count}건`} />

      <div className="mt-5">
        <ExpensesClient initialData={initialData} />
      </div>
    </div>
  )
}
