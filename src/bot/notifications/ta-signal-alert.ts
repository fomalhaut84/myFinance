/**
 * 전략 기반 TA 시그널 알림
 *
 * 스윙/모멘텀/단타 전략 종목에 대해 TA 조건 충족 시 텔레그램 알림.
 * 시세 갱신(refreshPrices) 후 호출.
 */

import { prisma } from '@/lib/prisma'
import { generateTAReport } from '@/lib/ta/engine'
import { getBot } from '@/bot/index'
import { sendHtml, escapeHtml } from '@/bot/utils/telegram'
import type { TAReport } from '@/lib/ta/types'

/** 당일 시그널 발송 기록 (키 → date string) */
const sentToday = new Map<string, string>()

function getTodayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function resetIfNewDay(): void {
  const today = getTodayKST()
  if (sentToday.size > 0) {
    const firstDate = sentToday.values().next().value
    if (firstDate !== today) sentToday.clear()
  }
}

interface SignalResult {
  ticker: string
  displayName: string
  strategy: string
  signals: string[]
}

/** 전략별 시그널 조건 매칭 */
function checkSignals(report: TAReport, strategy: string): string[] {
  const signals: string[] = []
  const { rsi14, macd, bollingerBands, volume, sma } = report.indicators

  switch (strategy) {
    case 'swing':
      if (rsi14.signal === 'OVERSOLD') signals.push(`📉 RSI 과매도 (${rsi14.value.toFixed(1)}) — 매수 기회`)
      if (rsi14.signal === 'OVERBOUGHT') signals.push(`📈 RSI 과매수 (${rsi14.value.toFixed(1)}) — 매도 검토`)
      if (macd.crossover === 'GOLDEN') signals.push('🔄 MACD 골든크로스 — 매수 시그널')
      if (macd.crossover === 'DEAD') signals.push('🔄 MACD 데드크로스 — 매도 시그널')
      break

    case 'momentum':
      if (volume.surge && report.price.change1d > 0) signals.push(`🚀 거래량 급증 (${volume.ratio.toFixed(1)}배) + 상승`)
      if (sma.goldenCross) signals.push('🔄 SMA 골든크로스 — 상승 추세 전환')
      if (sma.deathCross) signals.push('🔄 SMA 데드크로스 — 하락 추세 전환')
      break

    case 'scalp':
      if (bollingerBands.position === 'BELOW_LOWER') signals.push('📉 BB 하단 이탈 — 매수 구간')
      if (bollingerBands.position === 'ABOVE_UPPER') signals.push('📈 BB 상단 이탈 — 매도 구간')
      if (rsi14.value < 25) signals.push(`📉 RSI 극단 과매도 (${rsi14.value.toFixed(1)})`)
      if (rsi14.value > 75) signals.push(`📈 RSI 극단 과매수 (${rsi14.value.toFixed(1)})`)
      break

    case 'long_hold':
      if (report.signalSummary.overall === 'STRONG_SELL') {
        signals.push(`⚠️ 종합 STRONG_SELL — ${report.signalSummary.reasons.slice(0, 2).join(', ')}`)
      }
      break
  }

  return signals
}

/**
 * 전략 기반 TA 시그널 체크 + 알림 발송
 */
export async function checkTASignals(chatIds: number[]): Promise<void> {
  if (chatIds.length === 0) return

  resetIfNewDay()
  const today = getTodayKST()

  // 전략이 설정된 보유 종목 조회 (long_hold 제외 — 별도 하루 1회)
  const activeStrategies = ['swing', 'momentum', 'scalp']
  const holdings = await prisma.holdingStrategy.findMany({
    where: { strategy: { in: activeStrategies } },
    include: { holding: { select: { ticker: true, displayName: true } } },
  })

  // 관심종목 중 액티브 전략
  const watchlist = await prisma.watchlist.findMany({
    where: { strategy: { in: activeStrategies } },
  })

  // 티커 중복 제거
  const tickerMap = new Map<string, { displayName: string; strategy: string }>()
  for (const h of holdings) {
    tickerMap.set(h.holding.ticker, { displayName: h.holding.displayName, strategy: h.strategy })
  }
  for (const w of watchlist) {
    if (!tickerMap.has(w.ticker)) {
      tickerMap.set(w.ticker, { displayName: w.displayName, strategy: w.strategy })
    }
  }

  if (tickerMap.size === 0) return

  const results: SignalResult[] = []

  for (const [ticker, meta] of Array.from(tickerMap)) {
    try {
      const report = await generateTAReport(ticker)
      const signals = checkSignals(report, meta.strategy)

      if (signals.length === 0) continue

      // 중복 방지: 각 시그널별 체크
      const newSignals = signals.filter((sig) => {
        const key = `ta:${ticker}:${sig.slice(0, 20)}`
        if (sentToday.get(key) === today) return false
        sentToday.set(key, today)
        return true
      })

      if (newSignals.length > 0) {
        results.push({ ticker, displayName: meta.displayName, strategy: meta.strategy, signals: newSignals })
      }
    } catch (error) {
      console.error(`[ta-signal] ${ticker} TA 분석 실패:`, error)
    }
  }

  if (results.length === 0) return

  const STRATEGY_LABELS: Record<string, string> = {
    swing: '스윙', momentum: '모멘텀', scalp: '단타', long_hold: '장기',
  }

  const lines = ['📊 <b>TA 시그널 알림</b>\n']
  for (const r of results) {
    const stratLabel = STRATEGY_LABELS[r.strategy] ?? r.strategy
    lines.push(`<b>${escapeHtml(r.displayName)}</b> (${escapeHtml(r.ticker)}) — ${stratLabel}`)
    for (const sig of r.signals) {
      lines.push(`  ${sig}`)
    }
    lines.push('')
  }

  const bot = getBot()
  const message = lines.join('\n')

  for (const chatId of chatIds) {
    try {
      await sendHtml(bot, chatId, message)
    } catch (error) {
      console.error(`[ta-signal] 알림 발송 실패 (chatId: ${chatId}):`, error)
    }
  }

  console.log(`[ta-signal] TA 시그널 알림: ${results.length}종목`)
}
