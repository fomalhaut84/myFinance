/**
 * 분기 점검 리마인더
 * 1/1, 4/1, 7/1, 10/1 09:00 KST
 */

import { prisma } from '@/lib/prisma'
import { getBot } from '@/bot/index'
import {
  calcCurrentValueKRW,
  DEFAULT_FX_RATE_USD_KRW,
} from '@/lib/format'
import {
  accountEmoji,
  formatKRWFull,
  formatPercent,
} from '@/bot/utils/formatter'

function getQuarterLabel(month: number): string {
  if (month <= 3) return 'Q1'
  if (month <= 6) return 'Q2'
  if (month <= 9) return 'Q3'
  return 'Q4'
}

export async function sendQuarterlyReminder(chatIds: number[]): Promise<void> {
  const bot = getBot()

  const [accounts, prices] = await Promise.all([
    prisma.account.findMany({
      include: { holdings: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.priceCache.findMany(),
  ])

  const priceMap = new Map(prices.map((p) => [p.ticker, p]))
  const fxData = priceMap.get('USDKRW=X')
  const currentFxRate = fxData?.price ?? DEFAULT_FX_RATE_USD_KRW

  const now = new Date()
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const year = kst.getFullYear()
  const quarter = getQuarterLabel(kst.getMonth() + 1)

  const lines = [`📋 ${year}년 ${quarter} 분기 점검 리마인더\n`]

  let totalValue = 0
  for (const account of accounts) {
    const value = account.holdings.reduce((sum, h) => {
      const price = priceMap.get(h.ticker)
      if (!price) return sum
      return sum + calcCurrentValueKRW(h, price.price, currentFxRate)
    }, 0)
    totalValue += value
    lines.push(`${accountEmoji(account.name)} ${account.name}: ${formatKRWFull(value)}`)
  }

  lines.push(`\n💰 합계: ${formatKRWFull(totalValue)}`)

  if (fxData) {
    lines.push(`💱 환율: $1 = ₩${fxData.price.toFixed(2)}`)
  }

  // 증여 현황 요약
  const deposits = await prisma.deposit.findMany({
    include: { account: { select: { name: true } } },
  })

  const giftByAccount = new Map<string, number>()
  for (const d of deposits) {
    if (d.source === 'gift') {
      const prev = giftByAccount.get(d.account.name) ?? 0
      giftByAccount.set(d.account.name, prev + d.amount)
    }
  }

  if (giftByAccount.size > 0) {
    lines.push('\n🎁 증여 누적:')
    giftByAccount.forEach((amount, name) => {
      const pct = (amount / 20_000_000) * 100
      lines.push(`  ${name}: ${formatKRWFull(amount)} (${formatPercent(pct - 100 > 0 ? pct : pct).replace('+', '')} / 2,000만원)`)
    })
  }

  lines.push('\n📌 점검 사항:')
  lines.push('  • 자산배분 비율 확인')
  lines.push('  • 리밸런싱 필요 여부')
  lines.push('  • 증여 한도 확인')
  lines.push('  • 세금 이벤트 점검')

  const message = lines.join('\n')

  for (const chatId of chatIds) {
    try {
      await bot.api.sendMessage(chatId, message)
    } catch (error) {
      console.error(`[notification] 분기 점검 발송 실패 (chatId: ${chatId}):`, error)
    }
  }

  console.log('[notification] 분기 점검 리마인더 발송 완료')
}
