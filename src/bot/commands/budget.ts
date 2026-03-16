import { Bot, Context } from 'grammy'
import { prisma } from '@/lib/prisma'
import { formatKRWFull } from '../utils/formatter'

/** 현재 KST 기준 연/월 */
function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date()
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  return { year: kst.getFullYear(), month: kst.getMonth() + 1 }
}

/** KST 기준 이번 달 시작/끝 (UTC) */
function getMonthRange(year: number, month: number): { start: Date; end: Date } {
  // KST 기준 1일 00:00 → UTC
  const start = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`)
  // 다음 달 1일 00:00 → UTC
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+09:00`)
  return { start, end }
}

/**
 * /소비 — 이번 달 소비 요약 (카테고리별 합계)
 */
async function handleExpenseSummary(ctx: Context): Promise<void> {
  const { year, month } = getCurrentYearMonth()
  const { start, end } = getMonthRange(year, month)

  const transactions = await prisma.transaction.findMany({
    where: {
      transactedAt: { gte: start, lt: end },
      category: { type: 'expense' },
    },
    include: { category: { select: { name: true, icon: true } } },
  })

  if (transactions.length === 0) {
    await ctx.reply(`📊 ${month}월 소비 내역이 없습니다.`)
    return
  }

  // 카테고리별 합계
  const categoryTotals = new Map<string, { name: string; icon: string | null; total: number; count: number }>()
  let grandTotal = 0

  for (const tx of transactions) {
    const key = tx.categoryId
    const existing = categoryTotals.get(key)
    if (existing) {
      existing.total += tx.amount
      existing.count++
    } else {
      categoryTotals.set(key, {
        name: tx.category.name,
        icon: tx.category.icon,
        total: tx.amount,
        count: 1,
      })
    }
    grandTotal += tx.amount
  }

  // 합계 내림차순 정렬
  const sorted = Array.from(categoryTotals.values()).sort((a, b) => b.total - a.total)

  const lines = sorted.map((cat) => {
    const label = cat.icon ? `${cat.icon} ${cat.name}` : cat.name
    const pct = grandTotal > 0 ? ((cat.total / grandTotal) * 100).toFixed(0) : '0'
    return `${label}: ${formatKRWFull(cat.total)} (${pct}%, ${cat.count}건)`
  })

  await ctx.reply(
    `📊 ${month}월 소비 요약\n\n` +
      lines.join('\n') +
      `\n\n💰 총 소비: ${formatKRWFull(grandTotal)} (${transactions.length}건)`
  )
}

/**
 * /수입 — 이번 달 수입 요약 (카테고리별 합계)
 */
async function handleIncomeSummary(ctx: Context): Promise<void> {
  const { year, month } = getCurrentYearMonth()
  const { start, end } = getMonthRange(year, month)

  const transactions = await prisma.transaction.findMany({
    where: {
      transactedAt: { gte: start, lt: end },
      category: { type: 'income' },
    },
    include: { category: { select: { name: true, icon: true } } },
  })

  if (transactions.length === 0) {
    await ctx.reply(`📊 ${month}월 수입 내역이 없습니다.`)
    return
  }

  const categoryTotals = new Map<string, { name: string; icon: string | null; total: number; count: number }>()
  let grandTotal = 0

  for (const tx of transactions) {
    const key = tx.categoryId
    const existing = categoryTotals.get(key)
    if (existing) {
      existing.total += tx.amount
      existing.count++
    } else {
      categoryTotals.set(key, {
        name: tx.category.name,
        icon: tx.category.icon,
        total: tx.amount,
        count: 1,
      })
    }
    grandTotal += tx.amount
  }

  const sorted = Array.from(categoryTotals.values()).sort((a, b) => b.total - a.total)

  const lines = sorted.map((cat) => {
    const label = cat.icon ? `${cat.icon} ${cat.name}` : cat.name
    return `${label}: ${formatKRWFull(cat.total)} (${cat.count}건)`
  })

  await ctx.reply(
    `📊 ${month}월 수입 요약\n\n` +
      lines.join('\n') +
      `\n\n💰 총 수입: ${formatKRWFull(grandTotal)} (${transactions.length}건)`
  )
}

/**
 * /예산 — 이번 달 예산 잔여 확인
 */
async function handleBudgetStatus(ctx: Context): Promise<void> {
  const { year, month } = getCurrentYearMonth()
  const { start, end } = getMonthRange(year, month)

  // 전체 예산 (categoryId === null)
  const totalBudget = await prisma.budget.findFirst({
    where: { categoryId: null, year, month },
  })

  // 카테고리별 예산
  const categoryBudgets = await prisma.budget.findMany({
    where: { year, month, categoryId: { not: null } },
    include: { category: { select: { name: true, icon: true } } },
  })

  if (!totalBudget && categoryBudgets.length === 0) {
    await ctx.reply(
      `📋 ${month}월 예산이 설정되지 않았습니다.\n\n` +
        `예산설정 [금액]으로 월 예산을 설정하세요.\n` +
        `예: 예산설정 2000000`
    )
    return
  }

  // 이번 달 소비 합계
  const expenseResult = await prisma.transaction.aggregate({
    where: {
      transactedAt: { gte: start, lt: end },
      category: { type: 'expense' },
    },
    _sum: { amount: true },
  })
  const totalSpent = expenseResult._sum.amount ?? 0

  const lines: string[] = []

  if (totalBudget) {
    const remaining = totalBudget.amount - totalSpent
    const pct = totalBudget.amount > 0 ? ((totalSpent / totalBudget.amount) * 100).toFixed(0) : '0'
    const emoji = remaining >= 0 ? '🟢' : '🔴'
    lines.push(`${emoji} 전체 예산: ${formatKRWFull(totalBudget.amount)}`)
    lines.push(`   소비: ${formatKRWFull(totalSpent)} (${pct}%)`)
    lines.push(`   잔여: ${formatKRWFull(remaining)}`)
  }

  if (categoryBudgets.length > 0) {
    // 카테고리별 소비 합계
    const catSpent = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        transactedAt: { gte: start, lt: end },
        category: { type: 'expense' },
      },
      _sum: { amount: true },
    })
    const spentMap = new Map(catSpent.map((c) => [c.categoryId, c._sum.amount ?? 0]))

    if (lines.length > 0) lines.push('')
    lines.push('카테고리별 예산:')

    for (const budget of categoryBudgets) {
      const spent = spentMap.get(budget.categoryId!) ?? 0
      const remaining = budget.amount - spent
      const label = budget.category?.icon
        ? `${budget.category.icon} ${budget.category.name}`
        : budget.category?.name ?? '알 수 없음'
      const emoji = remaining >= 0 ? '🟢' : '🔴'
      lines.push(`${emoji} ${label}: ${formatKRWFull(spent)} / ${formatKRWFull(budget.amount)}`)
    }
  }

  await ctx.reply(`📋 ${month}월 예산 현황\n\n` + lines.join('\n'))
}

/**
 * 예산설정 {금액} — 월 전체 예산 설정
 */
async function handleBudgetSet(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? ''
  const match = text.match(/^예산설정\s+(.+)$/)
  const amountStr = match?.[1]?.trim().replace(/,/g, '')

  if (!amountStr || !/^\d+$/.test(amountStr)) {
    await ctx.reply('사용법: 예산설정 [금액]\n예: 예산설정 2000000')
    return
  }

  const amount = parseInt(amountStr, 10)
  if (amount <= 0) {
    await ctx.reply('⚠️ 예산은 0보다 큰 금액이어야 합니다.')
    return
  }

  const { year, month } = getCurrentYearMonth()

  const existing = await prisma.budget.findFirst({
    where: { categoryId: null, year, month },
  })

  if (existing) {
    await prisma.budget.update({
      where: { id: existing.id },
      data: { amount },
    })
  } else {
    await prisma.budget.create({
      data: { year, month, amount },
    })
  }

  await ctx.reply(
    `✅ ${month}월 전체 예산이 설정되었습니다.\n\n` +
      `예산: ${formatKRWFull(amount)}`
  )
}

export function registerBudgetCommands(bot: Bot): void {
  bot.hears(/^소비\s*$/, async (ctx) => {
    try {
      await handleExpenseSummary(ctx)
    } catch (error) {
      console.error('[bot] 소비 조회 실패:', error)
      await ctx.reply('⚠️ 소비 조회에 실패했습니다.')
    }
  })

  bot.hears(/^수입\s*$/, async (ctx) => {
    try {
      await handleIncomeSummary(ctx)
    } catch (error) {
      console.error('[bot] 수입 조회 실패:', error)
      await ctx.reply('⚠️ 수입 조회에 실패했습니다.')
    }
  })

  bot.hears(/^예산\s*$/, async (ctx) => {
    try {
      await handleBudgetStatus(ctx)
    } catch (error) {
      console.error('[bot] 예산 조회 실패:', error)
      await ctx.reply('⚠️ 예산 조회에 실패했습니다.')
    }
  })

  bot.hears(/^예산설정(?:\s+.*)?$/, async (ctx) => {
    try {
      await handleBudgetSet(ctx)
    } catch (error) {
      console.error('[bot] 예산 설정 실패:', error)
      await ctx.reply('⚠️ 예산 설정에 실패했습니다.')
    }
  })
}
