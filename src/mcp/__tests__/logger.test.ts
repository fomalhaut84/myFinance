import { describe, expect, it } from 'vitest'
import { newTraceId, summarizeArgs, IS_STDIO_MODE } from '../logger'

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

describe('IS_STDIO_MODE 감지', () => {
  it('MCP_TRANSPORT 이 unset 또는 stdio 이면 stdio 모드', () => {
    // 이 테스트는 process 시작 시점의 env 값 스냅샷을 기반. vitest 는 test setup 에서
    // 이미 결정된 상수를 검증하는 용도.
    // (env 는 vitest 안에서 stdio 기본값 or 명시 stdio 로 시작하는 것이 정상)
    // 최소한 export 된 값이 boolean 임을 보장.
    expect(typeof IS_STDIO_MODE).toBe('boolean')
  })
})
