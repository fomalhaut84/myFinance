import cron from 'node-cron'
import { refreshPrices } from './price-fetcher'

/** 현재 시각을 KST 기준으로 반환 (시, 분, 요일) */
function getKSTTime(): { h: number; m: number; day: number } {
  const now = new Date()
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  return {
    h: kst.getHours(),
    m: kst.getMinutes(),
    day: kst.getDay(), // 0=Sun, 6=Sat
  }
}

/** 한국 주식시장 개장 여부 (09:00~15:30 KST, 평일) */
function isKRMarketOpen(): boolean {
  const { h, m, day } = getKSTTime()
  if (day === 0 || day === 6) return false
  const minutes = h * 60 + m
  return minutes >= 540 && minutes <= 930 // 09:00 ~ 15:30
}

/** 미국 주식시장 개장 여부 (23:30~06:00 KST, 평일→익일). 서머타임 시 22:30~05:00. */
function isUSMarketOpen(): boolean {
  const { h, m, day } = getKSTTime()
  const minutes = h * 60 + m

  // 22:30~23:59 (월~금)
  if (day >= 1 && day <= 5 && minutes >= 1350) return true
  // 00:00~06:00 (화~토 = 월~금 야간)
  if (day >= 2 && day <= 6 && minutes <= 360) return true
  // 일→월 야간: day=1(월) 00:00~06:00 — 일요일 밤 장 없으므로 제외 OK

  return false
}

let isRunning = false

/**
 * 주가 갱신 스케줄러 등록.
 * 매 10분마다 실행, 장중이면 갱신, 장외에는 정각(매시 0분)에만 갱신.
 */
export function schedulePriceUpdates(): void {
  cron.schedule(
    '*/10 * * * *',
    async () => {
      // 중복 실행 방지 (이전 호출이 아직 진행 중이면 스킵)
      if (isRunning) {
        console.log('[cron] 이전 갱신이 진행 중, 스킵')
        return
      }

      const { m } = getKSTTime()
      const isMarketHours = isKRMarketOpen() || isUSMarketOpen()
      const isTopOfHour = m < 10 // 매시 0~9분 구간

      if (isMarketHours || isTopOfHour) {
        isRunning = true
        try {
          await refreshPrices()
        } catch (error) {
          console.error('[cron] Price refresh failed:', error)
        } finally {
          isRunning = false
        }
      }
    },
    { timezone: 'Asia/Seoul' }
  )

  console.log('[cron] 주가 스케줄러 등록 (장중 10분 / 장외 1시간)')
}
