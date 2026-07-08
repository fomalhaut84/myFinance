/**
 * Phase 33-B (#417) — /api/alerts/history 및 stats 라우트 공용.
 */

export const KNOWN_KINDS = new Set([
  'surge', 'drop', 'fx',
  'target_hit', 'stop_loss',
  'watch_buy', 'watch_zone',
  'ta_signal', 'custom_strategy',
])

export function parseISOOrNull(s: string | undefined | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** UTC Date → KST YYYY-MM-DD (버킷 키) */
export function kstDateKey(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/**
 * KST 기준 [from, to] 범위의 모든 날짜 버킷을 반환 (라인 차트 X 축용).
 *
 * 이전 구현 (self-review P1, #417): effectiveFrom 의 UTC time-of-day 를 고정한 채
 * `+24h` 씩 순회 → from/to 의 UTC 시각이 KST 자정을 사이에 두고 어긋나면 마지막
 * KST 날짜 버킷이 loop 조건에서 누락되어 byDayMap 은 count 있지만 결과에서 사라짐.
 *
 * 대신 KST 달력 일을 직접 순회 — `${key}T00:00:00Z` 를 baseline 으로 하고 +24h UTC
 * (=+1일 KST) 씩 진행하며 kstDateKey 를 다시 계산.
 */
export function buildKstDayBuckets(
  countsByKey: Map<string, number>,
  from: Date,
  to: Date,
): Array<{ date: string; count: number }> {
  const startKey = kstDateKey(from)
  const endKey = kstDateKey(to)
  if (startKey > endKey) return []
  const out: Array<{ date: string; count: number }> = []
  let cursor = new Date(`${startKey}T00:00:00Z`)
  while (kstDateKey(cursor) <= endKey) {
    const key = kstDateKey(cursor)
    out.push({ date: key, count: countsByKey.get(key) ?? 0 })
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  }
  return out
}
