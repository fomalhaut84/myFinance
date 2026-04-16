import { prisma } from '@/lib/prisma'
import { sendToWhooing } from '@/lib/whooing-webhook'
import { toolResult, toolError, formatMoney } from '../utils'

/**
 * get_spending_summary: 월별 소비/수입 요약 (DB 집계)
 */
export async function getSpendingSummary(args: {
  year: number
  month: number
}) {
  try {
    const { year, month } = args
    // UTC 기준 — 기존 API (src/app/api/transactions/route.ts)와 동일
    const startDate = new Date(Date.UTC(year, month - 1, 1))
    const endDate = new Date(Date.UTC(year, month, 1))

    // DB에서 카테고리별 집계
    const grouped = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        transactedAt: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
      _count: { id: true },
    })

    if (grouped.length === 0) {
      return toolResult(`${year}년 ${month}월 거래 내역이 없습니다.`)
    }

    // 카테고리 정보 조회
    const categoryIds = grouped.map((g) => g.categoryId)
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, type: true },
    })
    const categoryMap = new Map(categories.map((c) => [c.id, c]))

    const allCategories = grouped.map((g) => ({
      name: categoryMap.get(g.categoryId)?.name ?? '기타',
      type: categoryMap.get(g.categoryId)?.type ?? 'expense',
      total: g._sum.amount ?? 0,
      count: g._count.id,
    }))

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

/**
 * get_transactions: 개별 거래 내역 조회 (기간/카테고리/타입 필터)
 */
export async function getTransactions(args: {
  days?: number
  category?: string
  type?: string
}) {
  try {
    const days = Math.min(args.days ?? 7, 365)
    // KST 기준 날짜 경계로 앵커 (자정 기준)
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days))

    // 카테고리 ID 후보 수집 (category + type 교집합)
    let categoryIds: string[] | null = null

    if (args.type && ['expense', 'income', 'transfer'].includes(args.type)) {
      const typeCats = await prisma.category.findMany({
        where: { type: args.type },
        select: { id: true },
      })
      categoryIds = typeCats.map((c) => c.id)
    }

    if (args.category) {
      const matched = await prisma.category.findMany({
        where: { name: { contains: args.category, mode: 'insensitive' } },
        select: { id: true },
      })
      if (matched.length === 0) {
        return toolResult(`'${args.category}' 카테고리를 찾을 수 없습니다.`)
      }
      const matchedIds = matched.map((c) => c.id)
      categoryIds = categoryIds
        ? categoryIds.filter((id) => matchedIds.includes(id))
        : matchedIds
    }

    const where: Record<string, unknown> = {
      transactedAt: { gte: since },
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        category: { select: { name: true, icon: true, type: true } },
      },
      orderBy: [{ transactedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    })

    if (transactions.length === 0) {
      return toolResult(`최근 ${days}일간 해당 조건의 거래 내역이 없습니다.`)
    }

    let totalExpense = 0
    let totalIncome = 0
    for (const tx of transactions) {
      if (tx.category.type === 'expense') totalExpense += tx.amount
      else if (tx.category.type === 'income') totalIncome += tx.amount
    }
    const summaryParts = [`${transactions.length}건`]
    if (totalExpense > 0) summaryParts.push(`소비 ${formatMoney(totalExpense, 'KRW')}`)
    if (totalIncome > 0) summaryParts.push(`수입 ${formatMoney(totalIncome, 'KRW')}`)

    const lines = [`## 거래 내역 (최근 ${days}일, ${summaryParts.join(', ')})\n`]

    for (const tx of transactions) {
      const date = tx.transactedAt.toISOString().slice(0, 10)
      const icon = tx.category.icon ? `${tx.category.icon} ` : ''
      let sign = ''
      if (tx.category.type === 'expense') sign = '-'
      else if (tx.category.type === 'income') sign = '+'
      else if (tx.type === 'transfer_out') sign = '↑'
      else if (tx.type === 'transfer_in') sign = '↓'
      lines.push(`- ${date} | ${icon}${tx.category.name} | ${tx.description} | ${sign}${formatMoney(tx.amount, 'KRW')}`)
    }

    return toolResult(lines.join('\n'))
  } catch (error) {
    return toolError(error)
  }
}

/** 카테고리명으로 매칭 (부분 일치, 대소문자 무시) */
async function resolveCategory(name: string) {
  const matched = await prisma.category.findMany({
    where: { name: { contains: name, mode: 'insensitive' } },
    select: { id: true, name: true, type: true },
  })
  if (matched.length === 0) return { error: `'${name}' 카테고리를 찾을 수 없습니다.` }
  if (matched.length > 1) {
    const names = matched.map((c) => c.name).join(', ')
    return { error: `여러 카테고리가 매칭됩니다: ${names}. 정확한 이름을 지정해주세요.` }
  }
  return { category: matched[0] }
}

/**
 * create_transaction: 가계부 거래 생성
 */
export async function createTransaction(args: {
  amount: number
  description: string
  categoryName: string
  transactedAt?: string
  type?: string
}) {
  try {
    if (!args.description?.trim()) return toolError('내용(description)을 입력해주세요.')
    if (!Number.isFinite(args.amount) || args.amount <= 0) return toolError('금액은 0보다 커야 합니다.')

    const result = await resolveCategory(args.categoryName)
    if ('error' in result) return toolError(result.error)
    const { category } = result

    const roundedAmount = Math.round(args.amount)
    const transactedAt = args.transactedAt ? new Date(`${args.transactedAt}T00:00:00.000Z`) : new Date()
    const txType = args.type ?? null

    // transfer 유형 ↔ transfer 카테고리 검증
    if (txType && category.type !== 'transfer') return toolError('출금/입금은 이체 카테고리에서만 사용할 수 있습니다.')
    if (!txType && category.type === 'transfer') return toolError('이체 카테고리는 출금/입금 유형에서만 사용할 수 있습니다.')

    const tx = await prisma.transaction.create({
      data: {
        amount: roundedAmount,
        description: args.description.trim(),
        categoryId: category.id,
        transactedAt,
        type: txType,
      },
    })

    // 후잉 웹훅 (실패 무시)
    try {
      await sendToWhooing({ amount: tx.amount, description: tx.description, categoryId: tx.categoryId, transactedAt: tx.transactedAt })
    } catch { /* 무시 */ }

    return toolResult(
      `✅ 거래 생성: ${category.name} | ${args.description.trim()} | ${formatMoney(roundedAmount, 'KRW')}\n` +
      `- ID: ${tx.id}\n- 날짜: ${transactedAt.toISOString().slice(0, 10)}`
    )
  } catch (error) {
    return toolError(error)
  }
}

/**
 * update_transaction: 가계부 거래 수정 (ID 기반, 제공 필드만)
 */
export async function updateTransaction(args: {
  id: string
  amount?: number
  description?: string
  categoryName?: string
  transactedAt?: string
}) {
  try {
    const existing = await prisma.transaction.findUnique({ where: { id: args.id } })
    if (!existing) return toolError(`거래를 찾을 수 없습니다: ${args.id}`)

    const data: Record<string, unknown> = {}

    if (args.amount !== undefined) {
      if (!Number.isFinite(args.amount) || args.amount <= 0) return toolError('금액은 0보다 커야 합니다.')
      data.amount = Math.round(args.amount)
    }
    if (args.description !== undefined) {
      if (!args.description.trim()) return toolError('내용이 비어있습니다.')
      data.description = args.description.trim()
    }
    if (args.categoryName !== undefined) {
      const result = await resolveCategory(args.categoryName)
      if ('error' in result) return toolError(result.error)
      data.categoryId = result.category.id
    }
    if (args.transactedAt !== undefined) {
      data.transactedAt = new Date(`${args.transactedAt}T00:00:00.000Z`)
    }

    if (Object.keys(data).length === 0) return toolError('변경할 필드가 없습니다.')

    const updated = await prisma.transaction.update({
      where: { id: args.id },
      data,
      include: { category: { select: { name: true } } },
    })

    return toolResult(
      `✅ 거래 수정: ${updated.category.name} | ${updated.description} | ${formatMoney(updated.amount, 'KRW')}\n` +
      `- ID: ${updated.id}\n- 날짜: ${updated.transactedAt.toISOString().slice(0, 10)}`
    )
  } catch (error) {
    return toolError(error)
  }
}

/**
 * delete_transaction: 가계부 거래 삭제 (ID 기반)
 */
export async function deleteTransaction(args: { id: string }) {
  try {
    const existing = await prisma.transaction.findUnique({
      where: { id: args.id },
      include: { category: { select: { name: true } } },
    })
    if (!existing) return toolError(`거래를 찾을 수 없습니다: ${args.id}`)

    await prisma.transaction.delete({ where: { id: args.id } })
    return toolResult(
      `🗑️ 거래 삭제: ${existing.category.name} | ${existing.description} | ${formatMoney(existing.amount, 'KRW')}`
    )
  } catch (error) {
    return toolError(error)
  }
}
