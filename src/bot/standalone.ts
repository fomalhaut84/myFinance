/**
 * 텔레그램 봇 standalone 진입점
 *
 * Next.js와 분리된 별도 프로세스로 실행.
 * - grammY long polling
 * - cron 작업 (주가갱신, 스냅샷, KRX, 반복거래)
 * - 알림 스케줄러 (일일요약, 브리핑, 분기점검 등)
 */

import { getBot } from './index'
import { schedulePriceUpdates, scheduleSnapshots, scheduleKrxSync, scheduleRecurring } from '@/lib/cron'
import { scheduleNotifications } from './notifications/scheduler'

async function main(): Promise<void> {
  console.log('[bot] standalone 프로세스 시작...')

  // cron 작업 등록
  schedulePriceUpdates()
  scheduleSnapshots()
  scheduleKrxSync()
  scheduleRecurring()
  scheduleNotifications()
  console.log('[bot] cron + 알림 스케줄러 등록 완료')

  // 봇 long polling 시작
  const bot = getBot()

  bot.catch((err) => {
    console.error('[bot] 에러:', err)
  })

  // graceful shutdown
  const shutdown = async () => {
    console.log('[bot] 종료 중...')
    await bot.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log('[bot] long polling 시작')
  await bot.start()
}

main().catch((err) => {
  console.error('[bot] 시작 실패:', err)
  process.exit(1)
})
