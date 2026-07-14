/**
 * Phase 37-C (#446) — MCP 로그 실시간 tail 유틸.
 * `route.ts` 는 이 pure util 위에서 SSE stream 을 조립한다.
 *
 * 접근: `fs.watch` 는 Linux append 이벤트 신뢰성이 낮아 (드롭·중복) 폴링 기반으로 파일
 * 사이즈 성장을 감지한다. 신규 바이트만 UTF-8 로 디코드해 라인 분리, 마지막 불완전
 * 라인은 다음 poll 까지 `carry` 로 유지한다.
 */

import fs from 'node:fs'

/** poll 간격 (ms). 실서비스 UX 와 CPU 부하 사이 균형. */
export const POLL_INTERVAL_MS = 1500

/** SSE keepalive (프록시 idle timeout 방어). */
export const KEEPALIVE_INTERVAL_MS = 25_000

/**
 * 한 poll 당 읽어들일 최대 바이트. 로그 폭주(스트레스/부트 로그 대량 flush) 시
 * 이벤트 루프가 오래 블록되지 않도록 컷.
 */
export const MAX_CHUNK_BYTES = 512 * 1024

/**
 * 신규 라인만 방출하기 위한 라인 분리기.
 * - chunk 는 이번 poll 에서 새로 읽은 텍스트 (UTF-8 조각일 수 있음).
 * - carry 는 지난 poll 에서 남긴 불완전 라인 (뒤에 `\n` 이 없던 부분).
 *
 * 반환: `lines` 는 완결된 라인 배열 (`\n` 제거 후, 공백만 있는 라인은 제외).
 *      `carry` 는 마지막 `\n` 이후의 나머지 (다음 poll 로 넘김).
 *
 * 마지막 문자가 `\n` 이면 carry 는 빈 문자열.
 */
export function splitLinesWithCarryover(
  chunk: string,
  carry: string,
): { lines: string[]; carry: string } {
  if (!chunk) return { lines: [], carry }
  const combined = carry + chunk
  const parts = combined.split('\n')
  // 마지막 원소는 항상 "마지막 \n 이후" 이므로 carry 로 유지.
  const nextCarry = parts.pop() ?? ''
  const lines = parts.filter((l) => l.length > 0)
  return { lines, carry: nextCarry }
}

/**
 * 파일 descriptor 에서 `[from, to)` 구간을 UTF-8 로 읽는다.
 * `to - from` 이 0 이하이면 빈 문자열.
 * 실제 읽은 바이트 수가 요청보다 작을 수 있으므로 `bytesRead` 만큼만 반환.
 *
 * ⚠️ UTF-8 멀티바이트 문자가 chunk 경계에 걸리면 마지막 문자가 깨질 수 있으나
 * pino 로그는 대부분 ASCII 이고, 다음 poll 에서 나머지 바이트를 읽어 이어진다.
 * splitLinesWithCarryover 가 `\n` 기준으로만 라인을 확정하므로 파싱 실패 시
 * `parseLines` 가 raw 로 표시해 UX 상 큰 문제는 없다 (완결된 라인은 정상).
 */
export function readNewBytes(fd: number, from: number, to: number): string {
  const size = to - from
  if (size <= 0) return ''
  const buf = Buffer.alloc(size)
  const bytesRead = fs.readSync(fd, buf, 0, size, from)
  if (bytesRead <= 0) return ''
  return buf.subarray(0, bytesRead).toString('utf-8')
}
