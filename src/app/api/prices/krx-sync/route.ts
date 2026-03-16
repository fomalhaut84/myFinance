import { NextResponse } from 'next/server'
import { syncKrxStocks } from '@/lib/krx-stocks'

/**
 * POST /api/prices/krx-sync
 * KRX 종목 리스트를 수동으로 동기화한다.
 */
export async function POST() {
  try {
    const result = await syncKrxStocks()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[api] KRX 종목 동기화 실패:', error)
    return NextResponse.json({ error: 'KRX 종목 동기화에 실패했습니다.' }, { status: 500 })
  }
}
