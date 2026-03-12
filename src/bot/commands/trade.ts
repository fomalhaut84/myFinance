import { Bot, Context, InlineKeyboard } from 'grammy'
import { prisma } from '@/lib/prisma'
import { createTrade } from '@/lib/trade-service'
import { formatKRWFull, formatUSD } from '../utils/formatter'

interface PendingTrade {
  accountId: string
  accountName: string
  ticker: string
  displayName: string
  market: string
  type: 'BUY' | 'SELL'
  shares: number
  price: number
  currency: string
  fxRate: number | null
  expiresAt: number
}

// 메시지 ID → 대기 중인 거래 정보
const pendingTrades = new Map<string, PendingTrade>()

// 5분 후 자동 만료
const PENDING_TTL_MS = 5 * 60 * 1000

function cleanExpired(): void {
  const now = Date.now()
  pendingTrades.forEach((pending, key) => {
    if (pending.expiresAt < now) {
      pendingTrades.delete(key)
    }
  })
}

function formatTradePreview(type: string, pending: PendingTrade): string {
  const typeLabel = type === 'BUY' ? '📥 매수' : '📤 매도'
  const priceStr = pending.currency === 'USD'
    ? formatUSD(pending.price)
    : formatKRWFull(pending.price)

  const totalKRW = pending.currency === 'USD'
    ? Math.round(pending.price * pending.shares * (pending.fxRate ?? 0))
    : Math.round(pending.price * pending.shares)

  const lines = [
    `${typeLabel} 확인`,
    '',
    `계좌: ${pending.accountName}`,
    `종목: ${pending.displayName} (${pending.ticker})`,
    `수량: ${pending.shares}주`,
    `단가: ${priceStr}`,
  ]

  if (pending.currency === 'USD' && pending.fxRate) {
    lines.push(`환율: ₩${pending.fxRate.toFixed(2)}`)
  }

  lines.push(`총액: ${formatKRWFull(totalKRW)}`)
  lines.push('')
  lines.push('거래를 기록하시겠습니까?')

  return lines.join('\n')
}

async function handleTrade(ctx: Context, type: 'BUY' | 'SELL'): Promise<void> {
  const typeLabel = type === 'BUY' ? '매수' : '매도'
  const text = ctx.message?.text ?? ''
  const match = text.match(new RegExp(`^${typeLabel}(?:\\s+(.*))?$`))
  const args = match?.[1]?.trim()

  if (!args) {
    await ctx.reply(
      `사용법: ${typeLabel} [계좌] [종목] [수량] [가격]\n` +
      `예: ${typeLabel} 세진 AAPL 10 150\n` +
      `예: ${typeLabel} 소담 TIGER미국S&P500 5 18500`
    )
    return
  }

  // 파싱: 마지막 2개는 수량, 가격. 첫번째는 계좌명. 나머지는 종목명.
  const parts = args.split(/\s+/)
  if (parts.length < 4) {
    await ctx.reply(
      `⚠️ 입력이 부족합니다.\n` +
      `사용법: ${typeLabel} [계좌] [종목] [수량] [가격]\n` +
      `예: ${typeLabel} 세진 AAPL 10 150`
    )
    return
  }

  const priceStr = parts[parts.length - 1]
  const sharesStr = parts[parts.length - 2]
  const accountName = parts[0]
  const tickerOrName = parts.slice(1, parts.length - 2).join(' ')

  // 수량/가격 검증
  const shares = parseInt(sharesStr, 10)
  const price = parseFloat(priceStr)

  if (!Number.isInteger(shares) || shares <= 0) {
    await ctx.reply(`⚠️ 수량은 1 이상의 정수여야 합니다: ${sharesStr}`)
    return
  }
  if (!Number.isFinite(price) || price <= 0) {
    await ctx.reply(`⚠️ 가격은 0보다 큰 숫자여야 합니다: ${priceStr}`)
    return
  }

  // 계좌 조회
  const accounts = await prisma.account.findMany()
  const account = accounts.find((a) => a.name === accountName)
  if (!account) {
    const names = accounts.map((a) => a.name).join(', ')
    await ctx.reply(`⚠️ 계좌를 찾을 수 없습니다: ${accountName}\n사용 가능: ${names}`)
    return
  }

  // 종목 조회 (PriceCache 또는 Holding에서)
  const upperQuery = tickerOrName.toUpperCase()

  // PriceCache에서 검색
  const priceByTicker = await prisma.priceCache.findUnique({
    where: { ticker: upperQuery },
  })

  let ticker: string
  let displayName: string
  let market: string
  let currency: string

  if (priceByTicker) {
    ticker = priceByTicker.ticker
    displayName = priceByTicker.displayName
    market = priceByTicker.market
    currency = priceByTicker.currency
  } else {
    // displayName으로 검색
    const priceByName = await prisma.priceCache.findFirst({
      where: { displayName: { equals: tickerOrName, mode: 'insensitive' } },
    })
    if (priceByName) {
      ticker = priceByName.ticker
      displayName = priceByName.displayName
      market = priceByName.market
      currency = priceByName.currency
    } else {
      // Holding에서 검색 (PriceCache에 없는 종목)
      const holding = await prisma.holding.findFirst({
        where: {
          accountId: account.id,
          OR: [
            { ticker: upperQuery },
            { displayName: { equals: tickerOrName, mode: 'insensitive' } },
          ],
        },
      })
      if (holding) {
        ticker = holding.ticker
        displayName = holding.displayName
        market = holding.market
        currency = holding.currency
      } else {
        await ctx.reply(`⚠️ 종목을 찾을 수 없습니다: ${tickerOrName}`)
        return
      }
    }
  }

  // SELL: 보유 수량 사전 확인
  if (type === 'SELL') {
    const holding = await prisma.holding.findUnique({
      where: { accountId_ticker: { accountId: account.id, ticker } },
    })
    if (!holding || holding.shares < shares) {
      const current = holding?.shares ?? 0
      await ctx.reply(`⚠️ 보유 수량(${current}주)을 초과합니다.`)
      return
    }
  }

  // USD 종목 환율 자동 조회
  let fxRate: number | null = null
  if (currency === 'USD') {
    const fxData = await prisma.priceCache.findUnique({
      where: { ticker: 'USDKRW=X' },
    })
    if (!fxData) {
      await ctx.reply('⚠️ 환율 데이터가 없습니다. 주가 갱신을 확인해주세요.')
      return
    }
    fxRate = fxData.price
  }

  // 확인 키보드 표시
  cleanExpired()

  const pending: PendingTrade = {
    accountId: account.id,
    accountName: account.name,
    ticker,
    displayName,
    market,
    type,
    shares,
    price,
    currency,
    fxRate,
    expiresAt: Date.now() + PENDING_TTL_MS,
  }

  const keyboard = new InlineKeyboard()
    .text('✅ 확인', `trade:confirm`)
    .text('❌ 취소', `trade:cancel`)

  const sent = await ctx.reply(formatTradePreview(type, pending), {
    reply_markup: keyboard,
  })

  // chatId:messageId 키로 저장
  const key = `${sent.chat.id}:${sent.message_id}`
  pendingTrades.set(key, pending)
}

async function handleTradeCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('trade:')) return

  const action = data.split(':')[1]
  const message = ctx.callbackQuery?.message
  if (!message) {
    await ctx.answerCallbackQuery({ text: '⚠️ 메시지를 찾을 수 없습니다.' })
    return
  }

  const key = `${message.chat.id}:${message.message_id}`
  const pending = pendingTrades.get(key)

  if (!pending) {
    await ctx.answerCallbackQuery({ text: '⚠️ 만료된 거래입니다.' })
    await ctx.editMessageReplyMarkup({ reply_markup: undefined })
    return
  }

  if (pending.expiresAt < Date.now()) {
    pendingTrades.delete(key)
    await ctx.answerCallbackQuery({ text: '⚠️ 거래가 만료되었습니다.' })
    await ctx.editMessageReplyMarkup({ reply_markup: undefined })
    return
  }

  if (action === 'cancel') {
    pendingTrades.delete(key)
    await ctx.answerCallbackQuery({ text: '취소되었습니다.' })
    await ctx.editMessageReplyMarkup({ reply_markup: undefined })
    await ctx.editMessageText('❌ 거래가 취소되었습니다.')
    return
  }

  if (action === 'confirm') {
    pendingTrades.delete(key)

    try {
      const result = await createTrade({
        accountId: pending.accountId,
        ticker: pending.ticker,
        displayName: pending.displayName,
        market: pending.market,
        type: pending.type,
        shares: pending.shares,
        price: pending.price,
        currency: pending.currency,
        fxRate: pending.fxRate,
        tradedAt: new Date(),
      })

      const typeLabel = pending.type === 'BUY' ? '📥 매수' : '📤 매도'
      const holdingInfo = result.holding
        ? `보유: ${result.holding.shares}주`
        : '전량 매도 (보유 0주)'

      await ctx.answerCallbackQuery({ text: '거래 기록 완료!' })
      await ctx.editMessageReplyMarkup({ reply_markup: undefined })
      await ctx.editMessageText(
        `✅ ${typeLabel} 완료\n\n` +
        `${pending.displayName} (${pending.ticker})\n` +
        `${pending.shares}주 × ${pending.currency === 'USD' ? formatUSD(pending.price) : formatKRWFull(pending.price)}\n` +
        `총액: ${formatKRWFull(result.trade.totalKRW)}\n` +
        `${holdingInfo}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '거래 기록에 실패했습니다.'
      await ctx.answerCallbackQuery({ text: `⚠️ ${message}` })
      await ctx.editMessageReplyMarkup({ reply_markup: undefined })
      await ctx.editMessageText(`⚠️ 거래 실패: ${message}`)
    }
  }
}

export function registerTradeCommands(bot: Bot): void {
  bot.hears(/^매수(?:\s+.*)?$/, async (ctx) => {
    try {
      await handleTrade(ctx, 'BUY')
    } catch (error) {
      console.error('[bot] 매수 실패:', error)
      await ctx.reply('⚠️ 매수 기록에 실패했습니다.')
    }
  })

  bot.hears(/^매도(?:\s+.*)?$/, async (ctx) => {
    try {
      await handleTrade(ctx, 'SELL')
    } catch (error) {
      console.error('[bot] 매도 실패:', error)
      await ctx.reply('⚠️ 매도 기록에 실패했습니다.')
    }
  })

  bot.on('callback_query:data', async (ctx) => {
    try {
      await handleTradeCallback(ctx)
    } catch (error) {
      console.error('[bot] 콜백 처리 실패:', error)
      await ctx.answerCallbackQuery({ text: '⚠️ 처리 중 오류가 발생했습니다.' })
    }
  })
}
