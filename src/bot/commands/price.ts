import { Bot, Context } from 'grammy'
import { prisma } from '@/lib/prisma'
import { formatUSD } from '../utils/formatter'

async function handlePrice(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? ''
  const match = text.match(/^주가\s+(.+)$/)
  const query = match?.[1]?.trim()

  if (!query) {
    await ctx.reply('사용법: 주가 [종목명 또는 티커]\n예: 주가 AAPL, 주가 카카오')
    return
  }

  // PriceCache에서 ticker 또는 displayName으로 검색
  const prices = await prisma.priceCache.findMany()
  const upperQuery = query.toUpperCase()

  const found = prices.find(
    (p) =>
      p.ticker.toUpperCase() === upperQuery ||
      p.displayName.includes(query) ||
      p.ticker.toUpperCase().includes(upperQuery)
  )

  if (!found) {
    // 보유 종목이 아닌 경우 안내
    const tickers = prices
      .filter((p) => p.ticker !== 'USDKRW=X')
      .map((p) => `${p.displayName} (${p.ticker})`)
      .join('\n  ')
    await ctx.reply(
      `종목을 찾을 수 없습니다: ${query}\n\n` +
        `조회 가능한 종목:\n  ${tickers}`
    )
    return
  }

  const changeStr =
    found.change != null
      ? `${found.change >= 0 ? '+' : ''}${found.currency === 'USD' ? formatUSD(found.change) : `₩${Math.round(found.change).toLocaleString('ko-KR')}`}`
      : ''
  const changePctStr =
    found.changePercent != null
      ? ` (${found.changePercent >= 0 ? '+' : ''}${found.changePercent.toFixed(2)}%)`
      : ''
  const emoji = found.changePercent != null ? (found.changePercent >= 0 ? '🟢' : '🔴') : ''

  const priceStr =
    found.currency === 'USD'
      ? formatUSD(found.price)
      : `₩${Math.round(found.price).toLocaleString('ko-KR')}`

  const updatedAt = found.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  await ctx.reply(
    `📈 ${found.displayName} (${found.ticker})\n\n` +
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

  const changeStr =
    fxData.change != null
      ? `${fxData.change >= 0 ? '+' : ''}₩${fxData.change.toFixed(2)}`
      : ''
  const changePctStr =
    fxData.changePercent != null
      ? ` (${fxData.changePercent >= 0 ? '+' : ''}${fxData.changePercent.toFixed(2)}%)`
      : ''

  const updatedAt = fxData.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  await ctx.reply(
    `💱 USD/KRW 환율\n\n` +
      `$1 = ₩${fxData.price.toFixed(2)}\n` +
      `변동: ${changeStr}${changePctStr}\n` +
      `갱신: ${updatedAt}`
  )
}

export function registerPriceCommands(bot: Bot): void {
  bot.hears(/^주가\s+.+$/, async (ctx) => {
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
