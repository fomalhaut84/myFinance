import { prisma } from '@/lib/prisma'
import { toolResult, toolError, formatMoney } from '../utils'

/**
 * get_spending_summary: 월별 소비/수입 요약
 */
export async function getSpendingSummary(args: {
  year: number
  month: number
}) {
  try {
    const { year, month } = args
    if (month < 1 || month > 12) {
      return toolError('month는 1~12 사이여야 합니다.')
    }

    const monthStr = String(month).padStart(2, '0')
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const nextMonthStr = String(nextMonth).padStart(2, '0')
    const startDate = new Date(`${year}-${monthStr}-01T00:00:00+09:00`)
    const endDate = new Date(`${nextYear}-${nextMonthStr}-01T00:00:00+09:00`)

    const transactions = await prisma.transaction.findMany({
      where: {
        transactedAt: { gte: startDate, lt: endDate },
      },
      include: { category: { select: { name: true, type: true } } },
    })

    if (transactions.length === 0) {
      return toolResult(`${year}년 ${month}월 거래 내역이 없습니다.`)
    }

    // 카테고리별 집계
    const categoryMap = new Map<
      string,
      { name: string; type: string; total: number; count: number }
    >()

    for (const t of transactions) {
      const key = t.categoryId
      const existing = categoryMap.get(key)
      if (existing) {
        existing.total += t.amount
        existing.count += 1
      } else {
        categoryMap.set(key, {
          name: t.category.name,
          type: t.category.type,
          total: t.amount,
          count: 1,
        })
      }
    }

    const allCategories = Array.from(categoryMap.values())

    const expenses = allCategories
      .filter((c) => c.type === 'expense')
      .sort((a, b) => b.total - a.total)

    const incomes = allCategories
      .filter((c) => c.type === 'income')
      .sort((a, b) => b.total - a.total)

    const totalExpense = expenses.reduce((s, c) => s + c.total, 0)
    const totalIncome = incomes.reduce((s, c) => s + c.total, 0)

    const lines = [`## ${year}년 ${month}월 소비/수입 요약`]

    if (expenses.length > 0) {
      lines.push(`\n### 소비 (${formatMoney(totalExpense, 'KRW')})`)
      for (const c of expenses) {
        const pct = totalExpense > 0 ? ((c.total / totalExpense) * 100).toFixed(1) : '0.0'
        lines.push(`- ${c.name}: ${formatMoney(c.total, 'KRW')} (${pct}%, ${c.count}건)`)
      }
    }

    if (incomes.length > 0) {
      lines.push(`\n### 수입 (${formatMoney(totalIncome, 'KRW')})`)
      for (const c of incomes) {
        lines.push(`- ${c.name}: ${formatMoney(c.total, 'KRW')} (${c.count}건)`)
      }
    }

    lines.push(`\n**순수입**: ${formatMoney(totalIncome - totalExpense, 'KRW')}`)

    return toolResult(lines.join('\n'))
  } catch (error) {
    return toolError(error)
  }
}
