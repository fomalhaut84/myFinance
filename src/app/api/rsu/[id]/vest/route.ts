import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api-response'
import { processRsuVest, RsuVestError } from '@/lib/rsu-vest-service'

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { id } = params

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return fail('유효한 JSON 요청을 보내주세요.', 400)
    }

    const { vestPrice, autoSell } = body as {
      vestPrice: number
      autoSell: boolean
    }

    if (typeof vestPrice !== 'number' || !Number.isFinite(vestPrice) || vestPrice <= 0) {
      return fail('베스팅일 종가는 0보다 큰 숫자여야 합니다.', 400)
    }
    if (typeof autoSell !== 'boolean') {
      return fail('autoSell은 boolean이어야 합니다.', 400)
    }

    const result = await processRsuVest(id, vestPrice, autoSell)
    return ok(result)
  } catch (error) {
    if (error instanceof RsuVestError) {
      if (error.code === 'NOT_FOUND') return fail('RSU 스케줄을 찾을 수 없습니다.', 404)
      if (error.code === 'ALREADY_VESTED') return fail('이미 베스팅 처리된 스케줄입니다.', 400)
      if (error.code === 'INVALID_SELL_SHARES') return fail('매도 수량이 베스팅 수량을 초과합니다.', 400)
      if (error.code === 'INVALID_PRICE') return fail('베스팅일 종가는 0보다 큰 숫자여야 합니다.', 400)
    }
    if (
      error != null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2034'
    ) {
      return fail('동시 요청이 충돌했습니다. 잠시 후 다시 시도해주세요.', 409)
    }
    console.error('POST /api/rsu/[id]/vest error:', error)
    return fail('베스팅 처리에 실패했습니다.', 500)
  }
}
