import cron from 'node-cron'
import { refreshPrices } from './price-fetcher'

/** 한국 주식시장 개장 여부 (09:00~15:30 KST, 평일) */
function isKRMarketOpen(now: Date): boolean {
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const h = now.getHours()
  const m = now.getMinutes()
  const minutes = h * 60 + m
  return minutes >= 540 && minutes <= 930 // 09:00 ~ 15:30
}

/** 미국 주식시장 개장 여부 (23:30~06:00 KST, 평일→익일) */
function isUSMarketOpen(now: Date): boolean {
  const day = now.getDay()
  const h = now.getHours()
  const m = now.getMinutes()
  const minutes = h * 60 + m

  // 23:30~23:59 (월~금)
  if (day >= 1 && day <= 5 && minutes >= 1410) return true
  // 00:00~06:00 (화~토 = 월~금 야간)
  if (day >= 2 && day <= 6 && minutes <= 360) return true

  return false
}

/**
 * 주가 갱신 스케줄러 등록.
 * 매 10분마다 실행, 장중이면 갱신, 장외에는 정각(매시 0분)에만 갱신.
 */
export function schedulePriceUpdates(): void {
  cron.schedule(
    '*/10 * * * *',
    async () => {
      const now = new Date()
      const isMarketHours = isKRMarketOpen(now) || isUSMarketOpen(now)
      const isTopOfHour = now.getMinutes() < 10 // 0~9분 구간 = 정각 근처

      if (isMarketHours || isTopOfHour) {
        try {
          await refreshPrices()
        } catch (error) {
          console.error('[cron] Price refresh failed:', error)
        }
      }
    },
    { timezone: 'Asia/Seoul' }
  )

  console.log('[cron] 주가 스케줄러 등록 (장중 10분 / 장외 1시간)')
}
