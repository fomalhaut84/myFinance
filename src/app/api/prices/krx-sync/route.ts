import { NextResponse } from 'next/server'
import { syncKrxStocks } from '@/lib/krx-stocks'

/** 최소 동기화 간격 (ms) — 10분 */
const MIN_SYNC_INTERVAL_MS = 600_000

let lastSyncAt = 0

/**
 * POST /api/prices/krx-sync
 * KRX 종목 리스트를 수동으로 동기화한다.
 */
export async function POST() {
  try {
    const now = Date.now()
    if (now - lastSyncAt < MIN_SYNC_INTERVAL_MS) {
      return NextResponse.json(
        { error: 'KRX 동기화 간격이 너무 짧습니다. 10분 후 다시 시도해주세요.' },
        { status: 429 }
      )
    }

    lastSyncAt = now
    const result = await syncKrxStocks()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[api] KRX 종목 동기화 실패:', error)
    return NextResponse.json({ error: 'KRX 종목 동기화에 실패했습니다.' }, { status: 500 })
  }
}
