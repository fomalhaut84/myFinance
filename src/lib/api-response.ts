/**
 * API 응답 envelope `ApiResponse<T>` 와 헬퍼.
 *
 * 9차 마일스톤 (Phase 27) 의 기반 인프라. 라우트/클라이언트 마이그는 후속 sub-phase
 * (27-B/C/D) 에서 점진 적용. 이 파일 자체는 라우트 변경 0건이라 호환성 100% 보장.
 *
 * 사용 예:
 *   import { ok, fail, paginated } from '@/lib/api-response'
 *
 *   // 단순 성공
 *   return ok({ id: '...', name: '...' })
 *
 *   // 201 Created
 *   return ok(created, { status: 201 })
 *
 *   // 페이지네이션
 *   return paginated(trades, total, limit, offset)
 *
 *   // 실패
 *   return fail('거래를 찾을 수 없습니다.', 404)
 */

import { NextResponse } from 'next/server'

export interface ApiResponseMeta {
  total: number
  limit: number
  offset: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: ApiResponseMeta
}

interface OkOptions {
  status?: number
  meta?: ApiResponseMeta
}

/** 성공 응답. status 미지정 시 200. */
export function ok<T>(data: T, options?: OkOptions): NextResponse {
  const body: ApiResponse<T> = { success: true, data }
  if (options?.meta) body.meta = options.meta
  return NextResponse.json(body, { status: options?.status ?? 200 })
}

/** 실패 응답. status 미지정 시 400. */
export function fail(error: string, status = 400): NextResponse {
  const body: ApiResponse<never> = { success: false, error }
  return NextResponse.json(body, { status })
}

/**
 * 페이지네이션 성공 응답.
 * meta 에 total/limit/offset 포함.
 */
export function paginated<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
  status = 200,
): NextResponse {
  return ok(data, { status, meta: { total, limit, offset } })
}
