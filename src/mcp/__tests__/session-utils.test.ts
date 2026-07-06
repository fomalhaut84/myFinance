import { describe, expect, it } from 'vitest'
import { pickStaleSessions } from '../session-utils'

interface Entry { lastActivityAt: number }

describe('pickStaleSessions', () => {
  const NOW = 1_000_000
  const TTL = 60_000 // 1 minute

  it('빈 map → 빈 배열', () => {
    expect(pickStaleSessions(new Map<string, Entry>(), NOW, TTL)).toEqual([])
  })

  it('모든 세션이 TTL 이내 → 빈 배열', () => {
    const map = new Map<string, Entry>([
      ['a', { lastActivityAt: NOW }],
      ['b', { lastActivityAt: NOW - 30_000 }], // 30s ago
    ])
    expect(pickStaleSessions(map, NOW, TTL)).toEqual([])
  })

  it('TTL 초과 세션만 반환', () => {
    const map = new Map<string, Entry>([
      ['fresh', { lastActivityAt: NOW - 10_000 }], // 10s ago
      ['stale1', { lastActivityAt: NOW - 120_000 }], // 2min ago
      ['stale2', { lastActivityAt: NOW - 300_000 }], // 5min ago
    ])
    expect(pickStaleSessions(map, NOW, TTL).sort()).toEqual(['stale1', 'stale2'])
  })

  it('경계 — 정확히 TTL 만큼 idle 이면 유지, 1ms 초과부터 stale', () => {
    const map = new Map<string, Entry>([
      ['on-boundary', { lastActivityAt: NOW - TTL }], // exact TTL → keep
      ['just-past', { lastActivityAt: NOW - TTL - 1 }], // 1ms over → stale
    ])
    expect(pickStaleSessions(map, NOW, TTL)).toEqual(['just-past'])
  })

  it('과거 lastActivityAt (음수 시간 차) → stale 판정 안 함', () => {
    // 시계 skew 등 예외 상황 방어
    const map = new Map<string, Entry>([['future', { lastActivityAt: NOW + 5_000 }]])
    expect(pickStaleSessions(map, NOW, TTL)).toEqual([])
  })

  it('임의의 이터러블 (Map#entries 외 Array) 도 처리', () => {
    const arr: Array<[string, Entry]> = [
      ['a', { lastActivityAt: NOW - 90_000 }],
      ['b', { lastActivityAt: NOW - 30_000 }],
    ]
    expect(pickStaleSessions(arr, NOW, TTL)).toEqual(['a'])
  })
})
