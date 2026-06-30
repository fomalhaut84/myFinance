/**
 * RSU 베스팅 확정/취소 inline keyboard callback handler.
 *
 * callback_data 형식: `vest:confirm:<rsuId>` 또는 `vest:cancel:<rsuId>`
 *
 * confirm 시: vest-preview 재호출 → 최신 종가로 vest 트랜잭션 → 결과 메시지 갱신
 * cancel 시: 알림 메시지를 "취소됨" 으로 갱신 (실제 schedule 상태는 변경 없음)
 */

import { Bot } from 'grammy'
import {
  getRsuVestPreview,
  processRsuVest,
  RsuVestError,
} from '@/lib/rsu-vest-service'
import { formatKRWFull } from '@/bot/utils/formatter'
import { sanitizeError } from '@/bot/utils/error'

export function registerVestConfirmHandler(bot: Bot): void {
  bot.callbackQuery(/^vest:(confirm|cancel):(.+)$/, async (ctx) => {
    const action = ctx.match[1]
    const rsuId = ctx.match[2]

    if (action === 'cancel') {
      try {
        await ctx.editMessageText('🚫 RSU 베스팅 처리가 취소되었습니다.')
      } catch (err) {
        console.error(`[vest-confirm] cancel editMessage 실패: ${sanitizeError(err)}`)
      }
      await ctx.answerCallbackQuery({ text: '취소됨' })
      return
    }

    // confirm — 최신 preview 재조회 (D-1 → 베스팅일 당일 종가 fetch)
    let preview
    try {
      preview = await getRsuVestPreview(rsuId)
    } catch (err) {
      if (err instanceof RsuVestError) {
        const msg = err.code === 'NOT_FOUND'
          ? 'RSU 스케줄을 찾을 수 없습니다.'
          : '이미 처리된 베스팅입니다.'
        await ctx.answerCallbackQuery({ text: msg, show_alert: true })
        return
      }
      console.error(`[vest-confirm] preview 실패: ${sanitizeError(err)}`)
      await ctx.answerCallbackQuery({ text: '미리보기 실패. 웹에서 확인해주세요.', show_alert: true })
      return
    }

    if (preview.vestPrice == null) {
      await ctx.answerCallbackQuery({
        text: '종가 자동 조회 실패. 웹 페이지에서 직접 처리해주세요.',
        show_alert: true,
      })
      return
    }

    try {
      const result = await processRsuVest(rsuId, preview.vestPrice, preview.autoSellDefault)
      const lines = [
        '✅ RSU 베스팅 처리 완료',
        '',
        `종목: ${preview.displayName} (${preview.ticker})`,
        `계좌: ${preview.accountName}`,
        `종가: ${formatKRWFull(result.vestPrice)} (${preview.vestPriceSource})`,
        `매수: ${result.buyShares}주`,
      ]
      if (result.sellShares > 0) lines.push(`매도: ${result.sellShares}주`)
      if (result.holding) lines.push(`보유: ${result.holding.shares}주 (평단 ${formatKRWFull(Math.round(result.holding.avgPrice))})`)

      await ctx.editMessageText(lines.join('\n'))
      await ctx.answerCallbackQuery({ text: '완료' })
    } catch (err) {
      if (err instanceof RsuVestError) {
        await ctx.answerCallbackQuery({ text: `처리 실패: ${err.code}`, show_alert: true })
        return
      }
      console.error(`[vest-confirm] processRsuVest 실패: ${sanitizeError(err)}`)
      await ctx.answerCallbackQuery({ text: '처리 실패. 잠시 후 다시 시도하거나 웹에서 처리해주세요.', show_alert: true })
    }
  })
}
