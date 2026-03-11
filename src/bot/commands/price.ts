import { Bot, Context } from 'grammy'
import { prisma } from '@/lib/prisma'
import { formatUSD, splitMessage } from '../utils/formatter'

function formatChange(change: number, currency: string): string {
  const sign = change >= 0 ? '+' : ''
  return currency === 'USD'
    ? `${sign}${formatUSD(change)}`
    : `${sign}₩${Math.round(change).toLocaleString('ko-KR')}`
}

function formatChangePercent(changePercent: number): string {
  const sign = changePercent >= 0 ? '+' : ''
  return ` (${sign}${changePercent.toFixed(2)}%)`
}

async function handlePrice(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? ''
  const match = text.match(/^주가(?:\s+(.+))?$/)
  const query = match?.[1]?.trim()

  if (!query) {
    await ctx.reply('사용법: 주가 [종목명 또는 티커]\n예: 주가 AAPL, 주가 카카오')
    return
  }

  const prices = await prisma.priceCache.findMany()
  const upperQuery = query.toUpperCase()

  // 정확 일치 우선, 부분 일치 후순위
  const exactMatch = prices.find(
    (p) =>
      p.ticker.toUpperCase() === upperQuery ||
      p.displayName === query
  )

  if (exactMatch) {
    await replyPrice(ctx, exactMatch)
    return
  }

  const partialMatches = prices.filter(
    (p) =>
      p.displayName.includes(query) ||
      p.ticker.toUpperCase().includes(upperQuery)
  )

  if (partialMatches.length === 0) {
    const tickers = prices
      .filter((p) => p.ticker !== 'USDKRW=X')
      .map((p) => `${p.displayName} (${p.ticker})`)
    const tickerList = tickers.slice(0, 20).join('\n  ')
    const suffix = tickers.length > 20 ? `\n  외 ${tickers.length - 20}개` : ''
    const message = `종목을 찾을 수 없습니다: ${query}\n\n조회 가능한 종목:\n  ${tickerList}${suffix}`
    for (const chunk of splitMessage(message)) {
      await ctx.reply(chunk)
    }
    return
  }

  if (partialMatches.length === 1) {
    await replyPrice(ctx, partialMatches[0])
    return
  }

  // 다중 매칭 시 후보 목록 반환
  const candidates = partialMatches
    .slice(0, 10)
    .map((p) => `${p.displayName} (${p.ticker})`)
    .join('\n  ')
  const suffix = partialMatches.length > 10 ? `\n  외 ${partialMatches.length - 10}개` : ''
  await ctx.reply(
    `여러 종목이 매칭됩니다:\n  ${candidates}${suffix}\n\n정확한 종목명 또는 티커를 입력해주세요.`
  )
}

async function replyPrice(
  ctx: Context,
  matchedPrice: { ticker: string; displayName: string; price: number; change: number | null; changePercent: number | null; currency: string; updatedAt: Date }
): Promise<void> {
  const changeStr = matchedPrice.change != null ? formatChange(matchedPrice.change, matchedPrice.currency) : ''
  const changePctStr = matchedPrice.changePercent != null ? formatChangePercent(matchedPrice.changePercent) : ''
  const emoji = matchedPrice.changePercent != null ? (matchedPrice.changePercent >= 0 ? '🟢' : '🔴') : ''

  const priceStr =
    matchedPrice.currency === 'USD'
      ? formatUSD(matchedPrice.price)
      : `₩${Math.round(matchedPrice.price).toLocaleString('ko-KR')}`

  const updatedAt = matchedPrice.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  await ctx.reply(
    `📈 ${matchedPrice.displayName} (${matchedPrice.ticker})\n\n` +
      `현재가: ${priceStr} ${emoji}\n` +
      `변동: ${changeStr}${changePctStr}\n` +
      `갱신: ${updatedAt}`
  )
}

async function handleFxRate(ctx: Context): Promise<void> {
  const fxData = await prisma.priceCache.findUnique({
    where: { ticker: 'USDKRW=X' },
  })

  if (!fxData) {
    await ctx.reply('⚠️ 환율 데이터가 없습니다. 주가 갱신을 확인해주세요.')
    return
  }

  const changeStr = fxData.change != null ? formatChange(fxData.change, 'KRW') : ''
  const changePctStr = fxData.changePercent != null ? formatChangePercent(fxData.changePercent) : ''

  const updatedAt = fxData.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  await ctx.reply(
    `💱 USD/KRW 환율\n\n` +
      `$1 = ₩${fxData.price.toFixed(2)}\n` +
      `변동: ${changeStr}${changePctStr}\n` +
      `갱신: ${updatedAt}`
  )
}

export function registerPriceCommands(bot: Bot): void {
  bot.hears(/^주가(?:\s+.+)?$/, async (ctx) => {
    try {
      await handlePrice(ctx)
    } catch (error) {
      console.error('[bot] 주가 조회 실패:', error)
      await ctx.reply('⚠️ 주가 조회에 실패했습니다.')
    }
  })

  bot.hears(/^환율$/, async (ctx) => {
    try {
      await handleFxRate(ctx)
    } catch (error) {
      console.error('[bot] 환율 조회 실패:', error)
      await ctx.reply('⚠️ 환율 조회에 실패했습니다.')
    }
  })
}
