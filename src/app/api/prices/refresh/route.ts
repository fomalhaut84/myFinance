import { NextResponse } from 'next/server'
import { refreshPrices } from '@/lib/price-fetcher'

export async function POST() {
  try {
    const result = await refreshPrices()
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/prices/refresh error:', error)
    return NextResponse.json(
      { error: '주가 갱신에 실패했습니다.' },
      { status: 500 }
    )
  }
}
