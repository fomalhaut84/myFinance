/**
 * MCP HTTP transport 세션 관리용 순수 헬퍼.
 *
 * server.ts 는 module-load 시점에 main() 을 실행하므로 서버 로직에서 pure 헬퍼를
 * 뽑아 별도 파일로 관리 → 테스트 시 서버 부팅 없이 유닛 테스트 가능.
 */

/**
 * idle TTL 초과 세션 sid 만 골라 반환. sweeper 가 이 결과로 close/delete 수행.
 * `entries` 는 Map#entries() 또는 임의의 [sid, entry] 이터러블.
 */
export function pickStaleSessions<T extends { lastActivityAt: number }>(
  entries: Iterable<[string, T]>,
  now: number,
  ttlMs: number,
): string[] {
  const stale: string[] = []
  for (const [sid, entry] of entries) {
    if (now - entry.lastActivityAt > ttlMs) stale.push(sid)
  }
  return stale
}
