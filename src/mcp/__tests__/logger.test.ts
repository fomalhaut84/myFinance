import { describe, expect, it } from 'vitest'
import { newTraceId, summarizeArgs } from '../logger'

describe('newTraceId', () => {
  it('8자 hex 문자열 반환', () => {
    const id = newTraceId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('호출마다 유일 값 (충돌 확률 낮음)', () => {
    const ids = new Set()
    for (let i = 0; i < 1000; i++) ids.add(newTraceId())
    expect(ids.size).toBe(1000)
  })
})

describe('summarizeArgs', () => {
  it('null/undefined 그대로 반환', () => {
    expect(summarizeArgs(null)).toBe(null)
    expect(summarizeArgs(undefined)).toBe(undefined)
  })

  it('짧은 값은 그대로 반환', () => {
    const args = { ticker: 'AAPL', account: '세진' }
    expect(summarizeArgs(args)).toEqual(args)
  })

  it('긴 값은 truncate (200자 default)', () => {
    const longStr = 'x'.repeat(500)
    const args = { data: longStr }
    const result = summarizeArgs(args) as { _truncated: boolean; preview: string }
    expect(result._truncated).toBe(true)
    expect(result.preview.length).toBeLessThanOrEqual(200)
  })

  it('사용자 지정 maxLen 존중', () => {
    const args = { a: 'x'.repeat(100) }
    const result = summarizeArgs(args, 20) as { _truncated: boolean; preview: string }
    expect(result._truncated).toBe(true)
    expect(result.preview.length).toBeLessThanOrEqual(20)
  })

  it('serialize 불가한 값은 fallback', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = summarizeArgs(circular) as { _unserializable: boolean; type: string }
    expect(result._unserializable).toBe(true)
    expect(result.type).toBe('object')
  })
})
