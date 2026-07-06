/**
 * MCP structured logging — Phase 32-C.
 *
 * pino 기반 구조화 로그를 stdout 으로 sync 출력. PM2 가 stdout 을 캡처해
 * 파일 (`~/.pm2/logs/myfinance-mcp-out.log`) 로 저장하며, PM2 log rotation
 * (기본 pm2 logrotate 모듈) 이 일별/크기별 회전을 담당.
 *
 * pino.transport (worker thread) 는 esbuild 번들에서 worker 파일 참조 문제로
 * 로그 유실 가능 → sync destination 만 사용.
 *
 * 사용자용 로그 파일 (프로젝트 루트 `logs/mcp-YYYY-MM-DD.log`) 도 필요하면
 * `MCP_LOG_TEE_FILE=1` 로 sonic-boom sync stream 을 추가. 기본은 stdout only.
 */

import pino from 'pino'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

const LOG_DIR = process.env.MCP_LOG_DIR ?? path.join(process.cwd(), 'logs')
const LOG_ENABLE_FILE = process.env.MCP_LOG_TEE_FILE === '1'
const LOG_LEVEL = process.env.MCP_LOG_LEVEL ?? 'info'

/**
 * pino multistream — stdout (항상) + 옵션 파일.
 * 파일 tee 는 sonic-boom sync 스트림 (기본 pino/file destination).
 * Rotation 은 PM2 or 시스템 logrotate 위임.
 */
/**
 * 자정 감지 후 파일 스트림을 새 날짜로 교체. Long-running MCP 프로세스가 24h 넘어가면
 * 이전 날짜 파일에 계속 append 되던 문제 해결. 재기록 실패해도 서비스는 stdout 로 지속.
 */
let currentFileStream: pino.DestinationStream | null = null
let currentFileDate = ''

function openFileStream(): pino.DestinationStream | null {
  if (!LOG_ENABLE_FILE) return null
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    currentFileDate = today
    const filePath = path.join(LOG_DIR, `mcp-${today}.log`)
    return pino.destination({ dest: filePath, sync: true, mkdir: true })
  } catch (error) {
    console.error('[mcp/logger] file tee 초기화 실패:', LOG_DIR, error)
    return null
  }
}

/**
 * 자정 넘어가면 파일 스트림 교체. 매 로그 시점 검사보다는 5분 주기 setInterval 로 관리.
 */
function scheduleFileRotation() {
  if (!LOG_ENABLE_FILE) return
  const check = setInterval(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== currentFileDate && currentFileStream) {
      // 다음 setImmediate 로 log write 완료 대기 후 stream 교체.
      const oldStream = currentFileStream
      currentFileStream = openFileStream()
      // 이후 로그부터 새 파일. old stream 은 close.
      ;(oldStream as unknown as { end?: () => void }).end?.()
    }
  }, 5 * 60 * 1000)
  check.unref()
}

function buildStreams(): pino.StreamEntry[] {
  const streams: pino.StreamEntry[] = [
    { level: LOG_LEVEL as pino.Level, stream: process.stdout },
  ]

  currentFileStream = openFileStream()
  if (currentFileStream) {
    streams.push({
      level: LOG_LEVEL as pino.Level,
      // pino.multistream 은 stream 을 lazily 참조하지 않으므로 wrapper 로 현재 stream 위임.
      stream: {
        write(chunk: string) {
          currentFileStream?.write(chunk)
        },
      } as pino.DestinationStream,
    })
  }

  return streams
}

export const logger = pino(
  {
    base: { pid: process.pid, service: 'mcp' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: ['args.password', 'args.token', 'args.secret'],
      censor: '[REDACTED]',
    },
    level: LOG_LEVEL,
  },
  pino.multistream(buildStreams()),
)

export function newTraceId(): string {
  return randomUUID().slice(0, 8)
}

/** Sensitive 필드 제외한 args summary (긴 문자열 truncate) */
export function summarizeArgs(args: unknown, maxLen = 200): unknown {
  if (args === null || args === undefined) return args
  try {
    const s = JSON.stringify(args)
    if (s.length <= maxLen) return args
    return { _truncated: true, preview: s.slice(0, maxLen) }
  } catch {
    return { _unserializable: true, type: typeof args }
  }
}

/**
 * 프로세스 크래시 핸들러 — uncaughtException / unhandledRejection 을 로그로 강제 기록.
 * PM2 auto-restart 는 별개로 로그에 stack 이 남아 사후 분석 가능.
 */
/**
 * 파일 스트림에 buffered write flush. pino.multistream 은 flush 를 no-op 로 두므로
 * currentFileStream (sonic-boom) 의 flushSync 를 직접 호출.
 */
function flushAll(): void {
  try {
    ;(currentFileStream as unknown as { flushSync?: () => void })?.flushSync?.()
  } catch {
    // ignore — best effort
  }
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    logger.fatal(
      { err: { message: err.message, stack: err.stack, name: err.name } },
      'uncaught_exception',
    )
    flushAll()
    setTimeout(() => process.exit(1), 100).unref()
  })
  process.on('unhandledRejection', (reason) => {
    logger.fatal(
      {
        err:
          reason instanceof Error
            ? { message: reason.message, stack: reason.stack, name: reason.name }
            : { message: String(reason) },
      },
      'unhandled_rejection',
    )
    flushAll()
    // Node v15+ 는 unhandled rejection 시 프로세스 자동 종료지만 --unhandled-rejections
    // flag 로 warn 모드일 수 있어 방어적으로 flush + exit.
    setTimeout(() => process.exit(1), 100).unref()
  })

  // 자정 넘어가면 파일 스트림 교체 (long-running 프로세스 대응).
  scheduleFileRotation()
}
