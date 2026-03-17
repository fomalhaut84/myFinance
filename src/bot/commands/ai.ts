import { Bot, Context } from 'grammy'
import {
  askAdvisor,
  AdvisorRateLimitError,
  AdvisorTimeoutError,
  AdvisorError,
} from '@/lib/ai/claude-advisor'
import { getRateLimitStatus } from '@/lib/ai/rate-limiter'
import { splitMessage } from '../utils/formatter'

/**
 * AI 질문 처리 (공통 핸들러)
 */
async function handleAiQuestion(ctx: Context, question: string): Promise<void> {
  // typing indicator 시작
  await ctx.replyWithChatAction('typing')

  // typing을 주기적으로 갱신 (5초마다, 최대 120초)
  const typingInterval = setInterval(async () => {
    try {
      await ctx.replyWithChatAction('typing')
    } catch {
      // typing 전송 실패 무시
    }
  }, 5000)

  try {
    const result = await askAdvisor(question)

    clearInterval(typingInterval)

    // 응답 전송 (4096자 제한 분할)
    const chunks = splitMessage(result.response)
    for (const chunk of chunks) {
      await ctx.reply(chunk)
    }

    // 잔여 횟수 표시
    await ctx.reply(
      `💡 남은 AI 질문: ${result.rateLimitRemaining}회/일`
    )
  } catch (error) {
    clearInterval(typingInterval)

    if (error instanceof AdvisorRateLimitError) {
      await ctx.reply(
        `⚠️ ${error.message}\n내일 다시 이용해주세요.`
      )
      return
    }

    if (error instanceof AdvisorTimeoutError) {
      await ctx.reply(
        '⚠️ AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
      )
      return
    }

    if (error instanceof AdvisorError) {
      await ctx.reply(`⚠️ ${error.message}`)
      return
    }

    console.error('[bot] AI 질문 처리 실패:', error)
    await ctx.reply('⚠️ AI 질문 처리에 실패했습니다.')
  }
}

/**
 * /ai 커맨드 + AI fallback 등록
 */
export function registerAiCommands(bot: Bot): void {
  // /ai [질문] 커맨드
  bot.command('ai', async (ctx) => {
    try {
      const question = ctx.match?.toString().trim()

      if (!question) {
        const status = getRateLimitStatus()
        await ctx.reply(
          '🤖 AI 어드바이저에게 질문하세요.\n\n' +
            '사용법: /ai 전체 포트폴리오 현황 분석해줘\n' +
            '또는 그냥 자연어로 질문하면 됩니다.\n\n' +
            `남은 질문: ${status.remaining}회/일`
        )
        return
      }

      await handleAiQuestion(ctx, question)
    } catch (error) {
      console.error('[bot] /ai 커맨드 실패:', error)
      await ctx.reply('⚠️ AI 질문 처리에 실패했습니다.')
    }
  })
}

/**
 * AI 자연어 fallback (숫자 없는 메시지 → AI 전달)
 * 반드시 expenseFallback보다 뒤에 등록해야 함
 */
export function registerAiFallback(bot: Bot): void {
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text

    // 슬래시 커맨드는 무시
    if (text.startsWith('/')) return

    // 기존 커맨드 패턴은 무시
    if (/^(현황|계좌|주가|환율|매수|매도|수입|예산설정)(\s|$)/i.test(text)) return
    if (/^(소비|예산)\s*$/i.test(text)) return

    // 숫자 포함 → 소비 입력 (expense fallback에서 처리)
    if (/\d/.test(text)) return

    // 너무 짧은 메시지 무시 (2자 이하)
    if (text.trim().length <= 2) return

    try {
      await handleAiQuestion(ctx, text)
    } catch (error) {
      console.error('[bot] AI fallback 실패:', error)
      await ctx.reply('⚠️ AI 질문 처리에 실패했습니다.')
    }
  })
}
