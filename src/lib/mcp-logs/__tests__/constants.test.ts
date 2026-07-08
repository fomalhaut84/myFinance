import { describe, expect, it } from 'vitest'
import { KNOWN_MSGS, MSG_LABELS, LEVEL_ORDER, recentLogDates } from '../constants'

describe('KNOWN_MSGS', () => {
  it('스키마 문서에 명시된 17개 msg 를 모두 포함', () => {
    expect(KNOWN_MSGS.length).toBe(17)
  })

  it('MSG_LABELS 가 KNOWN_MSGS 모두를 커버', () => {
    for (const m of KNOWN_MSGS) {
      expect(MSG_LABELS[m]).toBeDefined()
    }
  })

  it('LEVEL_ORDER 는 fatal → trace 내림차순 (심각도)', () => {
    expect(LEVEL_ORDER).toEqual(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  })
})

describe('recentLogDates', () => {
  it('N=7 → 오늘부터 6일 전까지 7개 (KST 기준)', () => {
    // now = 2026-07-08 UTC 00:00 → KST 09:00 → 2026-07-08 for day 0
    const now = Date.parse('2026-07-08T00:00:00Z')
    const dates = recentLogDates(7, now)
    expect(dates).toEqual([
      '2026-07-08', '2026-07-07', '2026-07-06', '2026-07-05',
      '2026-07-04', '2026-07-03', '2026-07-02',
    ])
  })

  it('N=1 → 오늘만', () => {
    const now = Date.parse('2026-07-08T00:00:00Z')
    expect(recentLogDates(1, now)).toEqual(['2026-07-08'])
  })

  it('N=0 → 빈 배열', () => {
    expect(recentLogDates(0)).toEqual([])
  })
})
