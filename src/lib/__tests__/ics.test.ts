import { describe, expect, it } from 'vitest'
import { buildICS, escapeICSText, type ICSEvent } from '../ics'

const FIXED_DTSTAMP = '2026-06-18T00:00:00Z'

describe('escapeICSText', () => {
  it('백슬래시 이스케이프', () => {
    expect(escapeICSText('a\\b')).toBe('a\\\\b')
  })
  it('쉼표 이스케이프', () => {
    expect(escapeICSText('a,b')).toBe('a\\,b')
  })
  it('세미콜론 이스케이프', () => {
    expect(escapeICSText('a;b')).toBe('a\\;b')
  })
  it('개행 이스케이프', () => {
    expect(escapeICSText('a\nb')).toBe('a\\nb')
  })
  it('일반 한국어 유지', () => {
    expect(escapeICSText('RSU 베스팅')).toBe('RSU 베스팅')
  })
})

describe('buildICS — 빈 events', () => {
  it('유효한 VCALENDAR 구조 반환', () => {
    const ics = buildICS([], { dtstamp: FIXED_DTSTAMP })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0\r\n')
    expect(ics).toContain('PRODID:-//myFinance//Vesting Calendar//KO\r\n')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})

describe('buildICS — CRLF 라인 종결', () => {
  it('모든 라인이 \\r\\n 으로 구분', () => {
    const ics = buildICS([
      { uid: 'a@x', summary: 'Test', date: '2026-06-15' },
    ], { dtstamp: FIXED_DTSTAMP })
    // LF only 라인 없음 (\r\n 외부의 단독 \n 0건)
    const lfOnly = ics.split('').filter((c, i) => c === '\n' && ics[i - 1] !== '\r').length
    expect(lfOnly).toBe(0)
    // 마지막 라인 종결 포함
    expect(ics.endsWith('\r\n')).toBe(true)
  })
})

describe('buildICS — 단일 종일 이벤트', () => {
  it('VEVENT 블록 생성 + DATE 형식', () => {
    const ev: ICSEvent = {
      uid: 'rsu-abc@myfinance.starryjeju.net',
      summary: '[RSU] 300주 베스팅',
      date: '2026-06-15',
    }
    const ics = buildICS([ev], { dtstamp: FIXED_DTSTAMP })
    expect(ics).toContain('BEGIN:VEVENT\r\n')
    expect(ics).toContain('UID:rsu-abc@myfinance.starryjeju.net\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260615\r\n')
    expect(ics).toContain('SUMMARY:[RSU] 300주 베스팅\r\n')
    expect(ics).toContain('DTSTAMP:20260618T000000Z\r\n')
    expect(ics).toContain('END:VEVENT\r\n')
  })
})

describe('buildICS — 다중 이벤트', () => {
  it('events 순서 유지', () => {
    const ics = buildICS([
      { uid: 'a@x', summary: 'First', date: '2026-06-15' },
      { uid: 'b@x', summary: 'Second', date: '2026-07-20' },
    ], { dtstamp: FIXED_DTSTAMP })
    const firstIdx = ics.indexOf('First')
    const secondIdx = ics.indexOf('Second')
    expect(firstIdx).toBeGreaterThan(0)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2)
    expect(ics.match(/END:VEVENT/g)?.length).toBe(2)
  })
})

describe('buildICS — DESCRIPTION 옵션', () => {
  it('description 있으면 DESCRIPTION 라인 포함', () => {
    const ics = buildICS([
      { uid: 'a@x', summary: 'Test', date: '2026-06-15', description: 'extra info' },
    ], { dtstamp: FIXED_DTSTAMP })
    expect(ics).toContain('DESCRIPTION:extra info\r\n')
  })
  it('description 없으면 DESCRIPTION 라인 생략', () => {
    const ics = buildICS([
      { uid: 'a@x', summary: 'Test', date: '2026-06-15' },
    ], { dtstamp: FIXED_DTSTAMP })
    expect(ics).not.toContain('DESCRIPTION:')
  })
})

describe('buildICS — 텍스트 이스케이프', () => {
  it('SUMMARY 의 콤마/세미콜론/백슬래시/개행 이스케이프', () => {
    const ics = buildICS([
      { uid: 'a@x', summary: 'a,b;c\\d\ne', date: '2026-06-15' },
    ], { dtstamp: FIXED_DTSTAMP })
    expect(ics).toContain('SUMMARY:a\\,b\\;c\\\\d\\ne\r\n')
  })
})

describe('buildICS — UID 안정성 (재호출 동일 결과)', () => {
  it('동일 입력 + 동일 dtstamp → 동일 출력', () => {
    const ev: ICSEvent = { uid: 'stable@x', summary: 'Test', date: '2026-06-15' }
    const a = buildICS([ev], { dtstamp: FIXED_DTSTAMP })
    const b = buildICS([ev], { dtstamp: FIXED_DTSTAMP })
    expect(a).toBe(b)
  })
})

describe('buildICS — 옵션 prodId / calName', () => {
  it('사용자 지정 prodId 적용', () => {
    const ics = buildICS([], {
      prodId: '-//Custom//Test//EN',
      calName: 'CustomCal',
      dtstamp: FIXED_DTSTAMP,
    })
    expect(ics).toContain('PRODID:-//Custom//Test//EN\r\n')
    expect(ics).toContain('X-WR-CALNAME:CustomCal\r\n')
  })
})
