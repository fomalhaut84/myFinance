/**
 * Phase 33-C (#418) — MCP 로그 대시보드 API 공용.
 */

import path from 'node:path'
import fs from 'node:fs'
import { LEVEL_ORDER, KNOWN_MSGS } from '@/lib/mcp-logs/constants'
import { parseLines, applyFilter, tailN, type Filter, type LogEntry } from '@/lib/mcp-logs/parser'

/** KST 오늘 (YYYY-MM-DD) */
export function todayKst(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

export const KNOWN_LEVELS = new Set<string>(LEVEL_ORDER)
export const KNOWN_MSG_SET = new Set<string>(KNOWN_MSGS)

const LOG_DIR = process.env.MCP_LOG_DIR ?? path.join(process.cwd(), 'logs')

/** 대시보드가 한 요청당 파싱할 최대 라인 (대용량 파일 방어). */
export const MAX_SCAN_LINES = 50_000

/**
 * `crash` true 이면 `logs/mcp-crash-YYYY-MM-DD.log`, 아니면 `logs/mcp-YYYY-MM-DD.log`.
 */
export function logFilePath(date: string, crash = false): string {
  const name = crash ? `mcp-crash-${date}.log` : `mcp-${date}.log`
  return path.join(LOG_DIR, name)
}

/** YYYY-MM-DD 형식 검증 */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime())
}

export interface LoadOptions {
  date: string
  crash?: boolean
  filter: Filter
}

export interface LoadResult {
  entries: LogEntry[]
  fileExists: boolean
  totalLines: number
  scanned: number
  /** tail 이 적용됐다면 원본 대비 시작 라인 번호 (1-indexed) */
  startLineNo: number
}

/**
 * 파일 로드 → tail-N → 파싱 → 필터. Entries 는 최신순 (파일 맨 뒷줄이 최신)이므로
 * reverse 없이 오히려 tail 로 최근 N 라인만 → 파싱 후 시간 순 (오래된 → 최신).
 * UI 는 결과를 reverse 해 최신순 노출.
 */
export function loadEntries(opts: LoadOptions): LoadResult {
  const filePath = logFilePath(opts.date, opts.crash)
  if (!fs.existsSync(filePath)) {
    return { entries: [], fileExists: false, totalLines: 0, scanned: 0, startLineNo: 1 }
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  const totalLines = raw.split('\n').filter((l) => l.trim()).length
  const { text, startLineNo } = tailN(raw, MAX_SCAN_LINES)
  const parsed = parseLines(text)
  // startLineNo 를 오프셋으로 반영
  for (const e of parsed) e.lineNo = (e.lineNo ?? 1) + startLineNo - 1
  const filtered = applyFilter(parsed, opts.filter)
  return {
    entries: filtered,
    fileExists: true,
    totalLines,
    scanned: parsed.length,
    startLineNo,
  }
}
