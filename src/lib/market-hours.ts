/**
 * 시장별 거래시간 판별 유틸
 *
 * KST 기준으로 한국장/미국장 개장 여부 판단.
 * cron 스케줄러와 알림 필터에서 공용 사용.
 */

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
export function isKRMarketOpen(): boolean {
  const { h, m, day } = getKSTTime()
  if (day === 0 || day === 6) return false
  const minutes = h * 60 + m
  return minutes >= 540 && minutes <= 930 // 09:00 ~ 15:30
}

/** 현재 미국 서머타임(EDT) 여부를 America/New_York 시간대로 판별 */
function isUSDST(): boolean {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const diffHours = (utc.getTime() - et.getTime()) / (1000 * 60 * 60)
  return Math.round(diffHours) === 4 // EDT=UTC-4, EST=UTC-5
}

/**
 * 미국 주식시장 개장 여부 (평일→익일, KST 기준)
 * - 서머타임(EDT): 22:30~05:00 KST
 * - 비서머타임(EST): 23:30~06:00 KST
 */
export function isUSMarketOpen(): boolean {
  const { h, m, day } = getKSTTime()
  const minutes = h * 60 + m
  const dst = isUSDST()
  const openMin = dst ? 1350 : 1410   // 22:30 or 23:30
  const closeMin = dst ? 300 : 360    // 05:00 or 06:00

  // 저녁 세션: openMin~23:59 (월~금)
  if (day >= 1 && day <= 5 && minutes >= openMin) return true
  // 새벽 세션: 00:00~closeMin (화~토 = 월~금 야간)
  if (day >= 2 && day <= 6 && minutes <= closeMin) return true

  return false
}

/**
 * 종목 market 값 기준으로 거래시간 여부 판단
 * - 'KR', 'KS', 'KQ' → 한국장
 * - 'US' → 미국장
 * - 그 외(FX 등) → 항상 true
 */
export function isMarketOpenFor(market: string): boolean {
  const upper = market.toUpperCase()
  if (upper === 'KR' || upper === 'KS' || upper === 'KQ' || upper === 'KOSPI' || upper === 'KOSDAQ') {
    return isKRMarketOpen()
  }
  if (upper === 'US' || upper === 'NASDAQ' || upper === 'NYSE') {
    return isUSMarketOpen()
  }
  return true
}
