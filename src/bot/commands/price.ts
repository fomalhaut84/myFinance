import { Bot, Context } from 'grammy'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatUSD, splitMessage } from '../utils/formatter'

type PriceRow = Prisma.PriceCacheGetPayload<object>

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
  const match = text.match(/^주가(?:\s+(.*))?$/)
  const query = match?.[1]?.trim()

  if (!query) {
    await ctx.reply('사용법: 주가 [종목명 또는 티커]\n예: 주가 AAPL, 주가 카카오')
    return
  }

  const upperQuery = query.toUpperCase()

  // 1. 정확 일치 (ticker)
  const exactByTicker = await prisma.priceCache.findUnique({
    where: { ticker: upperQuery },
  })
  if (exactByTicker) {
    await replyPrice(ctx, exactByTicker)
    return
  }

  // 2. 정확 일치 (displayName)
  const exactByName = await prisma.priceCache.findFirst({
    where: { displayName: query },
  })
  if (exactByName) {
    await replyPrice(ctx, exactByName)
    return
  }

  // 3. 부분 일치 (displayName contains 또는 ticker contains)
  const partialMatches = await prisma.priceCache.findMany({
    where: {
      OR: [
        { displayName: { contains: query } },
        { ticker: { contains: upperQuery } },
      ],
    },
    take: 11,
  })

  if (partialMatches.length === 1) {
    await replyPrice(ctx, partialMatches[0])
    return
  }

  if (partialMatches.length > 1) {
    const candidates = partialMatches
      .slice(0, 10)
      .map((p) => `${p.displayName} (${p.ticker})`)
      .join('\n  ')
    const suffix = partialMatches.length > 10 ? '\n  외 다수' : ''
    await ctx.reply(
      `여러 종목이 매칭됩니다:\n  ${candidates}${suffix}\n\n정확한 종목명 또는 티커를 입력해주세요.`
    )
    return
  }

  // 4. 미매칭 시 조회 가능 종목 안내
  const allPrices = await prisma.priceCache.findMany({
    where: { ticker: { not: 'USDKRW=X' } },
    select: { displayName: true, ticker: true },
    orderBy: { ticker: 'asc' },
  })
  const tickerList = allPrices
    .slice(0, 20)
    .map((p) => `${p.displayName} (${p.ticker})`)
    .join('\n  ')
  const suffix = allPrices.length > 20 ? `\n  외 ${allPrices.length - 20}개` : ''
  const message = `종목을 찾을 수 없습니다: ${query}\n\n조회 가능한 종목:\n  ${tickerList}${suffix}`
  for (const chunk of splitMessage(message)) {
    await ctx.reply(chunk)
  }
}

async function replyPrice(ctx: Context, matchedPrice: PriceRow): Promise<void> {
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
  bot.hears(/^주가(?:\s+.*)?$/, async (ctx) => {
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
