/**
 * Phase 37-B (#445) — 실패 알림 재발송.
 * POST /api/alerts/history/[id]/retry
 *
 * - `deliveryStatus === 'failed'` 인 row 만 대상. 그 외는 400 (이미 성공/부분성공).
 * - 원본 row 는 mutate 하지 않고 새 AlertHistory row 를 append (`retriedFrom` 마커).
 * - Rate limit: 동일 id 5분내 재시도 금지 (스팸 방지). 프로세스 in-memory.
 * - Bot import 는 route handler 내부에서 lazy — Bot 초기화 시 요구되는 env 이 없는
 *   테스트 환경에서 모듈 로드 시 crash 하지 않도록 함.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ok, fail } from '@/lib/api-response'
import {
  globalRetryLimiter,
  redispatchAlert,
  persistRetryHistory,
  RETRY_COOLDOWN_MS,
} from '@/bot/notifications/alert-dispatcher'

interface RouteParams {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

function getAllowedChatIds(): number[] {
  return (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    if (!id) return fail('알림 id 가 필요합니다.', 400)

    const row = await prisma.alertHistory.findUnique({ where: { id } })
    if (!row) return fail('해당 알림 이력을 찾을 수 없습니다.', 404)

    if (row.deliveryStatus !== 'failed') {
      return fail('실패한 알림만 재발송할 수 있습니다.', 400)
    }

    // Rate limit — 스팸 방지. Retry-After 헤더는 응답 body 로 대체 (envelope 유지).
    const check = globalRetryLimiter.check(id)
    if (!check.allowed) {
      const remainSec = Math.ceil(check.retryAfterMs / 1000)
      return fail(`재발송은 5분에 한 번만 가능합니다. ${remainSec}초 후에 다시 시도하세요.`, 429)
    }

    const chatIds = getAllowedChatIds()
    if (chatIds.length === 0) {
      // 재발송 대상 chat 이 없으면 실패로 취급 (mark 하지 않아 재시도 여지 유지 —
      // 환경변수 재설정 직후 즉시 눌러도 rate limit 걸리지 않도록).
      return fail('발송 대상 chat 이 설정되지 않았습니다.', 500)
    }

    // 실제 시도 직전에 mark — 성공/실패 무관하게 cooldown 시작.
    globalRetryLimiter.markAttempt(id)

    const result = await redispatchAlert(row, chatIds)
    await persistRetryHistory(row, result)

    return ok(
      {
        originalId: id,
        status: result.status,
        successCount: result.successCount,
        totalChats: result.totalChats,
        lastError: result.lastError ?? null,
        cooldownMs: RETRY_COOLDOWN_MS,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('POST /api/alerts/history/[id]/retry error:', error)
    return fail('알림 재발송에 실패했습니다.', 500)
  }
}
