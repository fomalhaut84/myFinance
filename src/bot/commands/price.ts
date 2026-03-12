import { Bot, Context } from 'grammy'
import { prisma } from '@/lib/prisma'
import { fetchQuote, QuoteResult } from '@/lib/price-fetcher'
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
  const match = text.match(/^주가(?:\s+(.*))?$/)
  const query = match?.[1]?.trim()

  if (!query) {
    await ctx.reply('사용법: 주가 [종목명 또는 티커]\n예: 주가 AAPL, 주가 카카오')
    return
  }

  const upperQuery = query.toUpperCase()

  // 1. PriceCache에서 ticker 확정 시도 (보유 종목 빠른 매칭)
  const resolvedTicker = await resolveTickerFromCache(ctx, query, upperQuery)

  if (resolvedTicker === null) {
    // 여러 후보가 있어서 사용자에게 안내함 → 종료
    return
  }

  if (resolvedTicker) {
    // 보유 종목 ticker 확정 → 실시간 조회
    await fetchAndReply(ctx, resolvedTicker)
    return
  }

  // 2. PriceCache 미매칭 → 입력값을 ticker로 간주하여 yahoo-finance2 직접 조회
  await fetchAndReply(ctx, upperQuery)
}

/**
 * PriceCache에서 ticker를 확정한다.
 * - 단일 매칭: ticker 반환
 * - 다중 매칭: 사용자에게 후보 안내 후 null 반환
 * - 미매칭: undefined 반환
 */
async function resolveTickerFromCache(
  ctx: Context,
  query: string,
  upperQuery: string
): Promise<string | null | undefined> {
  // 정확 일치 (ticker)
  const exactByTicker = await prisma.priceCache.findUnique({
    where: { ticker: upperQuery },
    select: { ticker: true },
  })
  if (exactByTicker) return exactByTicker.ticker

  // 정확 일치 (displayName, case-insensitive)
  const exactByName = await prisma.priceCache.findMany({
    where: { displayName: { equals: query, mode: 'insensitive' } },
    select: { ticker: true, displayName: true },
    take: 2,
  })
  if (exactByName.length === 1) return exactByName[0].ticker
  if (exactByName.length > 1) {
    const candidates = exactByName.map((p) => `${p.displayName} (${p.ticker})`).join('\n  ')
    for (const chunk of splitMessage(`여러 종목이 매칭됩니다:\n  ${candidates}\n\n티커를 입력해주세요.`)) {
      await ctx.reply(chunk)
    }
    return null
  }

  // 부분 일치
  const partialMatches = await prisma.priceCache.findMany({
    where: {
      OR: [
        { displayName: { contains: query, mode: 'insensitive' } },
        { ticker: { contains: upperQuery, mode: 'insensitive' } },
      ],
    },
    select: { ticker: true, displayName: true },
    orderBy: { ticker: 'asc' },
    take: 11,
  })

  if (partialMatches.length === 1) return partialMatches[0].ticker
  if (partialMatches.length > 1) {
    const candidates = partialMatches
      .slice(0, 10)
      .map((p) => `${p.displayName} (${p.ticker})`)
      .join('\n  ')
    const suffix = partialMatches.length > 10 ? '\n  외 다수' : ''
    for (const chunk of splitMessage(`여러 종목이 매칭됩니다:\n  ${candidates}${suffix}\n\n정확한 종목명 또는 티커를 입력해주세요.`)) {
      await ctx.reply(chunk)
    }
    return null
  }

  // 미매칭
  return undefined
}

/**
 * yahoo-finance2 실시간 조회 후 응답.
 * 보유 종목이면 PriceCache도 갱신된다 (fetchQuote 내부).
 */
async function fetchAndReply(ctx: Context, ticker: string): Promise<void> {
  try {
    const quote = await fetchQuote(ticker)
    await replyQuote(ctx, quote)
  } catch {
    await ctx.reply(`⚠️ 종목을 찾을 수 없습니다: ${ticker}\n\n티커를 정확히 입력해주세요.\n예: AAPL, 005930.KS, TSLA`)
  }
}

function replyQuote(ctx: Context, quote: QuoteResult): Promise<void> {
  const changeStr = quote.change != null ? formatChange(quote.change, quote.currency) : ''
  const changePctStr = quote.changePercent != null ? formatChangePercent(quote.changePercent) : ''
  const emoji = quote.changePercent != null ? (quote.changePercent >= 0 ? '🟢' : '🔴') : ''

  const priceStr =
    quote.currency === 'USD'
      ? formatUSD(quote.price)
      : `₩${Math.round(quote.price).toLocaleString('ko-KR')}`

  return ctx.reply(
    `📈 ${quote.displayName} (${quote.ticker})\n\n` +
      `현재가: ${priceStr} ${emoji}\n` +
      `변동: ${changeStr}${changePctStr}`
  ).then(() => {})
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

  bot.hears(/^환율\s*$/, async (ctx) => {
    try {
      await handleFxRate(ctx)
    } catch (error) {
      console.error('[bot] 환율 조회 실패:', error)
      await ctx.reply('⚠️ 환율 조회에 실패했습니다.')
    }
  })
}
