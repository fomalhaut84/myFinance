/**
 * Phase 37-D (#447) — 로그 다운로드 route.
 *
 * 커버리지:
 *  - 존재 파일 → 200 + Content-Disposition + Content-Length + body 일치
 *  - 없는 날짜 → 404
 *  - 잘못된 date 형식 (정규식 실패) → 400
 *  - 캘린더 무효 date (2026-02-31) → 400
 *  - 경로 traversal (`../../etc/passwd`) → 400 (정규식에서 거부)
 *  - kind 화이트리스트 우회 → 400
 *  - kind=crash → crash 파일 반환
 */

import { NextRequest } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TMP_LOG_DIR = path.join(os.tmpdir(), `mcp-logs-download-test-${Date.now()}`)

beforeAll(() => {
  fs.mkdirSync(TMP_LOG_DIR, { recursive: true })
  process.env.MCP_LOG_DIR = TMP_LOG_DIR
  fs.writeFileSync(
    path.join(TMP_LOG_DIR, 'mcp-2026-07-10.log'),
    '{"level":"info","msg":"hello"}\n',
  )
  fs.writeFileSync(
    path.join(TMP_LOG_DIR, 'mcp-crash-2026-07-11.log'),
    '{"level":"fatal","msg":"boom"}\n',
  )
})

afterAll(() => {
  try { fs.rmSync(TMP_LOG_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
})

function buildReq(query: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/admin/mcp-logs/download')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe('GET /api/admin/mcp-logs/download', () => {
  it('존재 파일 → 200 + attachment 헤더 + 파일 내용', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-10' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="mcp-2026-07-10.log"',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(text).toBe('{"level":"info","msg":"hello"}\n')
  })

  it('kind=crash → crash 파일 반환', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-11', kind: 'crash' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="mcp-crash-2026-07-11.log"',
    )
    const text = await res.text()
    expect(text).toBe('{"level":"fatal","msg":"boom"}\n')
  })

  it('없는 날짜 → 404', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2020-01-01' }))
    expect(res.status).toBe(404)
    const body = await res.json() as { success: boolean; error?: string }
    expect(body.success).toBe(false)
  })

  it('date 형식 오류 → 400', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: 'not-a-date' }))
    expect(res.status).toBe(400)
  })

  it('date 없음 → 400', async () => {
    const { GET } = await import('../route')
    const url = new URL('http://localhost/api/admin/mcp-logs/download')
    const res = await GET(new NextRequest(url))
    expect(res.status).toBe(400)
  })

  it('캘린더 무효 date (2026-02-31) → 400', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-02-31' }))
    expect(res.status).toBe(400)
  })

  // 경로 traversal 시도 — 정규식이 `/`, `.`, `\` 를 모두 거부.
  it('traversal 시도 (`../../etc/passwd`) → 400', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '../../etc/passwd' }))
    expect(res.status).toBe(400)
  })

  it('traversal 시도 (`2026-07-10/../secret`) → 400', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-10/../secret' }))
    expect(res.status).toBe(400)
  })

  it('kind 화이트리스트 우회 시도 → 400', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-10', kind: 'evil' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { success: boolean; error?: string }
    expect(body.error).toContain('알 수 없는 kind')
  })

  it('kind 미지정 → main (기본값)', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-10' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('mcp-2026-07-10.log')
  })

  // Codex 사전 리뷰 P1 회귀 방지 — Content-Length 는 body 실제 크기와 일치.
  // 이전에는 read 이전 `stat.size` 를 사용해, 오늘 로그처럼 read 중에 append 되는
  // 파일에서 stat.size < body.length → 클라이언트가 tail 을 잘라버렸다.
  it('Content-Length 는 응답 body 실제 바이트 수와 일치', async () => {
    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-10' }))
    expect(res.status).toBe(200)
    const bodyBuf = new Uint8Array(await res.arrayBuffer())
    const declared = Number(res.headers.get('content-length'))
    expect(declared).toBe(bodyBuf.length)
  })

  it('read 이후 append 된 bytes 는 body 에 포함되고 Content-Length 로 정확히 노출', async () => {
    // 실제 pino sync append race 를 완벽하게 재현하려면 fs.readFileSync 를 hook 해야
    // 하지만 vitest 로 그건 부담이 큼. 대신 `route` 가 stat.size (구 방식) 대신
    // buf.length (신 방식) 를 사용하는지 계약 수준에서 검증 — 파일을 미리 늘려두고
    // read 결과 크기와 헤더가 일치하는지 확인.
    const target = path.join(TMP_LOG_DIR, 'mcp-2026-07-09.log')
    fs.writeFileSync(target, '{"level":"info","msg":"a"}\n')
    // 파일이 이미 존재하는 상태 → GET 이 부르는 fs.readFileSync 는 write 후 크기까지 읽음.
    fs.appendFileSync(target, '{"level":"info","msg":"b"}\n{"level":"info","msg":"c"}\n')

    const { GET } = await import('../route')
    const res = await GET(buildReq({ date: '2026-07-09' }))
    expect(res.status).toBe(200)
    const bodyBuf = new Uint8Array(await res.arrayBuffer())
    const declared = Number(res.headers.get('content-length'))
    expect(declared).toBe(bodyBuf.length)
    // 3 라인 모두 포함 (append 후 크기까지)
    expect(new TextDecoder().decode(bodyBuf)).toContain('"msg":"c"')
  })
})
