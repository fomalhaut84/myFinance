/**
 * Phase 37-B (#445) — 알림 이력 CSV export.
 * GET /api/alerts/history/export?kind=&ticker=&from=&to=
 *
 * 응답은 CSV 파일 (`csvResponse` — envelope 예외, `.claude/rules/api-routes.md` 참고).
 * 에러 path 만 envelope (`fail`) 사용.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { toCSV, csvResponse } from '@/lib/csv'
import { fail } from '@/lib/api-response'
import type { Prisma } from '@prisma/client'
import { parseISOOrNull, parseKindsParam, resolveTimeWindow } from '../shared'
import {
  HISTORY_CSV_HEADERS, toCsvRow, buildExportFilename,
} from './csv-format'

const DEFAULT_LOOKBACK_DAYS = 7
/**
 * export 는 페이지네이션 없이 조건 매칭 전부 스트리밍하지만, 실사용 필터가 90일
 * 이내 * 하루 수십건 규모라 상한을 넉넉히 잡고 넘치면 최근순으로 잘라낸다.
 * (10만건 넘어가면 브라우저 다운로드 자체가 부담이고, 그럴 정도면 필터 좁혀 재시도가 정상 UX.)
 */
const MAX_ROWS = 10_000

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl
    const { kinds, invalid } = parseKindsParam(url.searchParams)
    const rawTicker = url.searchParams.get('ticker')?.trim() || undefined
    const fromStr = url.searchParams.get('from')?.trim() || undefined
    const toStr = url.searchParams.get('to')?.trim() || undefined

    if (invalid.length > 0) {
      return fail(`알 수 없는 kind: ${invalid.join(', ')}`, 400)
    }
    const from = parseISOOrNull(fromStr)
    const to = parseISOOrNull(toStr)
    if (fromStr && !from) return fail('from 이 ISO 8601 형식이 아닙니다.', 400)
    if (toStr && !to) return fail('to 가 ISO 8601 형식이 아닙니다.', 400)

    const { effectiveFrom, effectiveTo } = resolveTimeWindow(from, to, DEFAULT_LOOKBACK_DAYS)

    const where: Prisma.AlertHistoryWhereInput = {
      firedAt: { gte: effectiveFrom, lte: effectiveTo },
    }
    if (kinds.length === 1) where.kind = kinds[0]
    else if (kinds.length > 1) where.kind = { in: kinds }
    if (rawTicker) where.ticker = rawTicker.toUpperCase()

    const rows = await prisma.alertHistory.findMany({
      where,
      // 리스트와 동일 정렬 (같은 firedAt 안에서 id desc — tiebreak, #424 P2 회귀 방지).
      orderBy: [{ firedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS,
    })

    const csv = toCSV(
      [...HISTORY_CSV_HEADERS],
      rows.map(toCsvRow),
    )

    return csvResponse(csv, buildExportFilename(effectiveFrom, effectiveTo))
  } catch (error) {
    console.error('GET /api/alerts/history/export error:', error)
    return fail('알림 이력 CSV 생성에 실패했습니다.', 500)
  }
}
