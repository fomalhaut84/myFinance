import { describe, expect, it } from 'vitest'
import { todayKst, isValidDateStr, logFilePath, stripLeadingPartialLine } from '../shared'

describe('todayKst', () => {
  it('UTC 00:00 → KST 09:00 → 같은 날짜', () => {
    const now = Date.parse('2026-07-08T00:00:00Z')
    expect(todayKst(now)).toBe('2026-07-08')
  })

  it('UTC 14:59 → KST 23:59 (같은 날)', () => {
    const now = Date.parse('2026-07-08T14:59:00Z')
    expect(todayKst(now)).toBe('2026-07-08')
  })

  it('UTC 15:00 → KST 00:00 (다음날)', () => {
    const now = Date.parse('2026-07-08T15:00:00Z')
    expect(todayKst(now)).toBe('2026-07-09')
  })
})

describe('isValidDateStr', () => {
  it('YYYY-MM-DD 형식 통과', () => {
    expect(isValidDateStr('2026-07-08')).toBe(true)
  })

  it('잘못된 형식 → false', () => {
    expect(isValidDateStr('2026/07/08')).toBe(false)
    expect(isValidDateStr('26-7-8')).toBe(false)
    expect(isValidDateStr('bogus')).toBe(false)
    expect(isValidDateStr('')).toBe(false)
  })

  it('잘못된 날짜 값 → false', () => {
    expect(isValidDateStr('2026-13-40')).toBe(false)
  })
})

describe('logFilePath', () => {
  it('기본 (일반 로그) → mcp-<date>.log', () => {
    expect(logFilePath('2026-07-08')).toMatch(/mcp-2026-07-08\.log$/)
  })

  it('crash=true → mcp-crash-<date>.log', () => {
    expect(logFilePath('2026-07-08', true)).toMatch(/mcp-crash-2026-07-08\.log$/)
  })
})

describe('stripLeadingPartialLine (Codex #425 P2 회귀 방지)', () => {
  it('첫 `\\n` 이전 partial 을 잘라내고 이후 라인만 반환', () => {
    expect(stripLeadingPartialLine('partial-fragment\nfull1\nfull2\n')).toBe('full1\nfull2\n')
  })

  it('newline 이 하나도 없으면 빈 문자열 (전부 partial 로 간주 → 무시)', () => {
    expect(stripLeadingPartialLine('no newline in here')).toBe('')
  })

  it('첫 문자가 newline 이면 그 뒤 전체 반환', () => {
    expect(stripLeadingPartialLine('\nabc')).toBe('abc')
  })

  it('빈 입력 → 빈', () => {
    expect(stripLeadingPartialLine('')).toBe('')
  })
})
