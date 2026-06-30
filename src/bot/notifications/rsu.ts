/**
 * RSU 베스팅일 + 스톡옵션 행사 가능일 리마인더
 * 매일 09:00 KST 실행, D-7 / D-1 대상 확인.
 *
 * D-1 RSU 알림은 inline keyboard ([✅ 확정] [✖️ 취소]) 첨부 — 한 번 탭으로 vest 처리.
 * callback 처리는 src/bot/commands/vest-confirm.ts.
 */

import { InlineKeyboard } from 'grammy'
import { prisma } from '@/lib/prisma'
import { getBot } from '@/bot/index'
import { formatKRWFull } from '@/bot/utils/formatter'
import { sendHtml, escapeHtml, h } from '@/bot/utils/telegram'
import { getRsuVestPreview } from '@/lib/rsu-vest-service'
import { sanitizeError } from '@/bot/utils/error'

function formatDate(date: Date): string {
  return date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}

function diffDays(target: Date): number {
  const now = new Date()
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const kstTarget = new Date(target.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))

  // 날짜만 비교 (시간 제거)
  kstNow.setHours(0, 0, 0, 0)
  kstTarget.setHours(0, 0, 0, 0)

  return Math.round((kstTarget.getTime() - kstNow.getTime()) / (1000 * 60 * 60 * 24))
}

export async function sendRSUReminders(chatIds: number[]): Promise<void> {
  const bot = getBot()
  const lines: string[] = []

  // D-7 ~ D-1 범위 (KST 기준 오늘 + 1일 ~ 오늘 + 7일)
  const now = new Date()
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  kstNow.setHours(0, 0, 0, 0)
  const rangeStart = new Date(kstNow)
  rangeStart.setDate(rangeStart.getDate() + 1)
  const rangeEnd = new Date(kstNow)
  rangeEnd.setDate(rangeEnd.getDate() + 8) // D-7 포함 (exclusive upper bound)

  // RSU 베스팅 확인 (D-1 ~ D-7 범위만 조회)
  const pendingRSU = await prisma.rSUSchedule.findMany({
    where: {
      status: 'pending',
      vestingDate: { gte: rangeStart, lt: rangeEnd },
    },
    include: { account: { select: { name: true } } },
    orderBy: { vestingDate: 'asc' },
  })

  // D-1 RSU 는 인라인 키보드 첨부 후 개별 발송, D-7 은 summary lines 에 합산
  const d1Rsus: typeof pendingRSU = []
  for (const rsu of pendingRSU) {
    const daysLeft = diffDays(rsu.vestingDate)
    if (daysLeft === 1) {
      d1Rsus.push(rsu)
    } else if (daysLeft === 7) {
      lines.push(
        `${h.b('📅 D-7 RSU 베스팅')}\n` +
        `  ${escapeHtml(rsu.account.name)} | ${rsu.shares}주\n` +
        `  베스팅일: ${formatDate(rsu.vestingDate)}\n` +
        `  기준가: ${formatKRWFull(rsu.basisValue)}`
      )
    }
  }

  // 스톡옵션 행사 가능일 확인 (D-1 ~ D-7 범위만 조회)
  const pendingOptions = await prisma.stockOptionVesting.findMany({
    where: {
      status: 'pending',
      vestingDate: { gte: rangeStart, lt: rangeEnd },
    },
    include: {
      stockOption: {
        select: { displayName: true, strikePrice: true },
      },
    },
    orderBy: { vestingDate: 'asc' },
  })

  for (const vest of pendingOptions) {
    const daysLeft = diffDays(vest.vestingDate)
    if (daysLeft === 7 || daysLeft === 1) {
      const label = daysLeft === 1 ? '⚠️ D-1' : '📅 D-7'
      lines.push(
        `${h.b(label + ' 스톡옵션 행사 가능')}\n` +
        `  ${escapeHtml(vest.stockOption.displayName)} | ${vest.shares}주\n` +
        `  행사가: ${formatKRWFull(vest.stockOption.strikePrice)}\n` +
        `  행사 가능일: ${formatDate(vest.vestingDate)}`
      )
    }
  }

  // 일반 summary (D-7 RSU + D-7/D-1 스톡옵션)
  if (lines.length > 0) {
    const fullMessage = `🔔 ${h.b('RSU/스톡옵션 리마인더')}\n\n${lines.join('\n\n')}`
    for (const chatId of chatIds) {
      try {
        await sendHtml(bot, chatId, fullMessage)
      } catch (error) {
        console.error(`[notification] RSU 리마인더 발송 실패 (chatId: ${chatId}): ${sanitizeError(error)}`)
      }
    }
  }

  // D-1 RSU 는 인라인 키보드 첨부, 종가 자동 조회 결과 포함, 개별 발송
  for (const rsu of d1Rsus) {
    let priceLine = ''
    let autoSellLine = (rsu.sellShares ?? 0) > 0
      ? `  매도 예정: ${rsu.sellShares}주 (autoSell=✓)`
      : `  매도 예정: 없음 (autoSell=✗)`
    try {
      const preview = await getRsuVestPreview(rsu.id)
      if (preview.vestPrice != null) {
        priceLine = `  종가 (자동조회): ${formatKRWFull(Math.round(preview.vestPrice))} <i>(${preview.vestPriceSource})</i>`
      } else {
        priceLine = `  종가: <i>자동 조회 실패 — 웹에서 직접 처리</i>`
      }
      // autoSell 기본값을 preview 기준으로 갱신 (sellShares 변경 가능성)
      autoSellLine = preview.autoSellDefault
        ? `  매도 예정: ${preview.sellShares ?? 0}주 (autoSell=✓)`
        : `  매도 예정: 없음 (autoSell=✗)`
    } catch (err) {
      console.error(`[notification] vest-preview 실패 (${rsu.id}): ${sanitizeError(err)}`)
      priceLine = `  종가: <i>조회 실패</i>`
    }

    const msg =
      `🎯 ${h.b('D-1 RSU 베스팅 — 내일 처리 준비')}\n` +
      `  ${escapeHtml(rsu.account.name)} | ${rsu.shares}주\n` +
      `  베스팅일: ${formatDate(rsu.vestingDate)}\n` +
      `  기준가: ${formatKRWFull(rsu.basisValue)}\n` +
      `${priceLine}\n` +
      `${autoSellLine}\n\n` +
      `<i>D-day 다시 알림이 오면 [확정] 버튼 한 번으로 처리됩니다.</i>`

    const keyboard = new InlineKeyboard()
      .text('✅ 확정', `vest:confirm:${rsu.id}`)
      .text('✖️ 취소', `vest:cancel:${rsu.id}`)

    for (const chatId of chatIds) {
      try {
        await bot.api.sendMessage(chatId, msg, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        })
      } catch (error) {
        console.error(`[notification] D-1 RSU 알림 발송 실패 (chatId: ${chatId}): ${sanitizeError(error)}`)
      }
    }
  }

  console.log('[notification] RSU/스톡옵션 리마인더 발송 완료')
}
