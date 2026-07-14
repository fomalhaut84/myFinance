/**
 * Phase 37-D (#447) — MCP 로그 원본 다운로드.
 *
 * `GET /api/admin/mcp-logs/download?date=YYYY-MM-DD[&kind=main|crash]`
 *
 * - `date` 는 엄격한 정규식 (`^\d{4}-\d{2}-\d{2}$`) + 캘린더 유효성 검증.
 *   경로 traversal (`../../etc/passwd` 등) 은 정규식에서 거부.
 * - `kind` 는 화이트리스트 (`main` | `crash`). 기본 `main`.
 * - 파일 없으면 404. 존재하면 `Content-Disposition: attachment` 로 스트림.
 * - 응답 자체는 파일 (envelope 예외). 400/404 는 envelope 유지.
 */

import { NextRequest } from 'next/server'
import fs from 'node:fs'
import { fail } from '@/lib/api-response'
import { isValidDateStr, logFilePath } from '../shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** kind 화이트리스트 — 값 이외는 400. `crash` 만 crash 파일, 그 외/미지정은 main. */
const ALLOWED_KINDS = new Set(['main', 'crash'])

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl
    const date = url.searchParams.get('date')?.trim() ?? ''
    const kindRaw = url.searchParams.get('kind')?.trim() ?? 'main'

    if (!isValidDateStr(date)) {
      return fail('date 는 YYYY-MM-DD 형식이어야 합니다.', 400)
    }
    if (!ALLOWED_KINDS.has(kindRaw)) {
      return fail(`알 수 없는 kind: ${kindRaw}`, 400)
    }
    const crash = kindRaw === 'crash'

    const filePath = logFilePath(date, crash)
    if (!fs.existsSync(filePath)) {
      return fail('해당 일자 로그 파일이 없습니다.', 404)
    }

    // 파일 크기 확인 — 스트림 대신 buffer 반환 (일반 로그 사이즈 감안: 최대 수십 MB).
    // 대용량 스트림은 Next.js Edge/Node 환경에서 ReadableStream 구성이 필요하지만
    // MCP 로그는 하루 최대 수백 MB 상한 → 실무상 buffer 로 충분.
    const buf = fs.readFileSync(filePath)

    const basename = crash ? `mcp-crash-${date}.log` : `mcp-${date}.log`
    // Codex 사전 리뷰 P1: Content-Length 는 반드시 실제 body 바이트 (buf.length) 여야
    // 한다. 이전에는 read 이전에 캡처한 `stat.size` 를 사용해 오늘자 로그처럼
    // 파일이 pino sync append 로 계속 늘어나는 경우 `readFileSync` 는 read 시점
    // EOF 까지 반환 → `stat.size < buf.length` → 클라이언트가 헤더 값만큼만 소비
    // 하고 tail 을 잘라버렸음 (관리자가 주로 찾던 최신 라인).
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="${basename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('GET /api/admin/mcp-logs/download error:', error)
    return fail('로그 다운로드에 실패했습니다.', 500)
  }
}
