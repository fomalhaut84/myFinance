import { NextRequest, NextResponse } from 'next/server'
import { createWebhookHandler } from '@/bot/index'

// 모듈 로드 시점에 즉시 초기화 (콜드 스타트 제거)
// 토큰 미설정 시에도 크래시 방지 — POST에서 검증 후 사용
let handler: ReturnType<typeof createWebhookHandler> | null = null
try {
  handler = createWebhookHandler()
} catch {
  console.warn('[webhook] 봇 초기화 실패 (토큰 미설정 가능성)')
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!handler) {
      console.error('[webhook] 봇 핸들러 미초기화')
      return NextResponse.json({ error: 'Not configured' }, { status: 500 })
    }

    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secretToken) {
      console.error('[webhook] TELEGRAM_WEBHOOK_SECRET 미설정')
      return NextResponse.json({ error: 'Not configured' }, { status: 500 })
    }

    const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token')
    if (receivedSecret !== secretToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await handler(request)
  } catch (error) {
    console.error('[webhook] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
