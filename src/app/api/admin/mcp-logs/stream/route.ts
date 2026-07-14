/**
 * Phase 37-C (#446) — MCP 로그 실시간 tail (SSE).
 *
 * `GET /api/admin/mcp-logs/stream?level=&msg=&tool=&traceId=`
 *
 * - 오늘 KST 날짜의 일반 로그 파일만 tail (`logs/mcp-YYYY-MM-DD.log`).
 *   크래시 로그는 별도 파일이라 스코프 밖.
 * - 초기 EOF 위치를 기록해 신규 라인만 push (기존 라인 재전송 X).
 * - 폴링 (POLL_INTERVAL_MS) — `fs.watch` 는 Linux append 이벤트 신뢰성이 낮음.
 * - keepalive comment (`: ping\n\n`) 로 프록시 idle 타임아웃 방어.
 * - client abort 시 setInterval / open fd 를 정리한다 (leak 방어).
 */

import { NextRequest } from 'next/server'
import fs from 'node:fs'
import { fail } from '@/lib/api-response'
import {
  KNOWN_LEVELS, KNOWN_MSG_SET, logFilePath, todayKst,
} from '../shared'
import { parseLines, applyFilter, type Filter, type LogEntry } from '@/lib/mcp-logs/parser'
import {
  KEEPALIVE_INTERVAL_MS, MAX_CHUNK_BYTES, POLL_INTERVAL_MS,
  readNewBytes, splitLinesWithCarryover,
} from '@/lib/mcp-logs/tail'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function encodeEvent(entry: LogEntry): string {
  // JSON.stringify 로 안전하게 escape (`\n` → `\\n`) → SSE data 라인 하나로 나감.
  return `data: ${JSON.stringify(entry)}\n\n`
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const level = url.searchParams.get('level')?.trim() || undefined
  const msg = url.searchParams.get('msg')?.trim() || undefined
  const tool = url.searchParams.get('tool')?.trim() || undefined
  const traceId = url.searchParams.get('traceId')?.trim() || undefined

  if (level && !KNOWN_LEVELS.has(level)) {
    return fail(`알 수 없는 level: ${level}`, 400)
  }
  if (msg && !KNOWN_MSG_SET.has(msg)) {
    return fail(`알 수 없는 msg: ${msg}`, 400)
  }

  const filter: Filter = { level, msg, tool, traceId }
  const date = todayKst()
  const filePath = logFilePath(date, false)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let position = 0
      let fd: number | null = null
      let carry = ''
      let closed = false

      const openIfNeeded = () => {
        if (fd !== null) return
        if (!fs.existsSync(filePath)) return
        try {
          const st = fs.statSync(filePath)
          fd = fs.openSync(filePath, 'r')
          // 최초 접속 시점 EOF 부터 시작 — 과거 라인 재전송 방지.
          position = st.size
        } catch {
          fd = null
        }
      }

      const closeFd = () => {
        if (fd !== null) {
          try { fs.closeSync(fd) } catch { /* ignore */ }
          fd = null
        }
      }

      const safeEnqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // controller 가 이미 닫혔거나 클라이언트 disconnect — cleanup 위임.
          cleanup()
        }
      }

      const poll = () => {
        if (closed) return
        try {
          openIfNeeded()
          if (fd === null) return  // 파일이 아직 없음 → 다음 poll 대기

          const st = fs.fstatSync(fd)

          // 로테이션 등으로 파일 크기가 줄었으면 처음부터.
          if (st.size < position) {
            position = 0
            carry = ''
          }

          if (st.size === position) return  // 신규 데이터 없음

          const toRead = Math.min(st.size - position, MAX_CHUNK_BYTES)
          const chunk = readNewBytes(fd, position, position + toRead)
          position += toRead

          const { lines, carry: nextCarry } = splitLinesWithCarryover(chunk, carry)
          carry = nextCarry
          if (lines.length === 0) return

          const parsed = parseLines(lines.join('\n'))
          const filtered = applyFilter(parsed, filter)
          for (const entry of filtered) {
            safeEnqueue(encodeEvent(entry))
          }
        } catch {
          // fs 오류는 다음 poll 에서 재시도. 파일이 rotate/삭제된 경우 openIfNeeded 가
          // 재시도한다. fd 를 닫아 stale descriptor 를 정리.
          closeFd()
        }
      }

      const pollTimer = setInterval(poll, POLL_INTERVAL_MS)
      const keepaliveTimer = setInterval(() => safeEnqueue(': ping\n\n'), KEEPALIVE_INTERVAL_MS)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(pollTimer)
        clearInterval(keepaliveTimer)
        closeFd()
        try { controller.close() } catch { /* already closed */ }
      }

      // 초기 comment — Nginx 등 프록시가 응답 헤더를 즉시 flush 하도록 유도.
      safeEnqueue(`: connected ${date}\n\n`)

      req.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
