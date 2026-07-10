import { describe, expect, it } from 'vitest'
import { computeStrategyDiff, hasDiff } from '../diff'
import type { ParsedStrategy } from '../types'

const base: ParsedStrategy = {
  name: 'AAPL 저점',
  ticker: 'AAPL',
  conditions: [
    { type: 'price', operator: '<=', value: 150 },
    { type: 'rsi', operator: '<=', value: 30 },
  ],
  logic: 'AND',
  frequency: 'daily',
}

describe('computeStrategyDiff (Phase 35-B / #434)', () => {
  it('동일 전략 → 변경 없음', () => {
    const d = computeStrategyDiff(base, base)
    expect(hasDiff(d)).toBe(false)
    expect(d.conditionsAdded).toEqual([])
    expect(d.conditionsRemoved).toEqual([])
  })

  it('name 변경 감지', () => {
    const after = { ...base, name: 'AAPL 매수' }
    const d = computeStrategyDiff(base, after)
    expect(d.nameChanged).toEqual({ from: 'AAPL 저점', to: 'AAPL 매수' })
    expect(hasDiff(d)).toBe(true)
  })

  it('logic 변경 감지', () => {
    const after = { ...base, logic: 'OR' as const }
    const d = computeStrategyDiff(base, after)
    expect(d.logicChanged).toEqual({ from: 'AND', to: 'OR' })
  })

  it('frequency 변경 감지', () => {
    const after = { ...base, frequency: 'always' as const }
    const d = computeStrategyDiff(base, after)
    expect(d.frequencyChanged).toEqual({ from: 'daily', to: 'always' })
  })

  it('조건 제거 감지', () => {
    const after = { ...base, conditions: [base.conditions[0]] }
    const d = computeStrategyDiff(base, after)
    expect(d.conditionsRemoved).toHaveLength(1)
    expect(d.conditionsRemoved[0].type).toBe('rsi')
    expect(d.conditionsAdded).toEqual([])
  })

  it('조건 추가 감지', () => {
    const after: ParsedStrategy = {
      ...base,
      conditions: [
        ...base.conditions,
        { type: 'earnings_within_days', operator: '>=', value: 7 },
      ],
    }
    const d = computeStrategyDiff(base, after)
    expect(d.conditionsAdded).toHaveLength(1)
    expect(d.conditionsAdded[0].type).toBe('earnings_within_days')
    expect(d.conditionsRemoved).toEqual([])
  })

  it('조건 값 변경 → 제거 1 + 추가 1 (문자열 비교 기반 대체)', () => {
    const after: ParsedStrategy = {
      ...base,
      conditions: [
        { type: 'price', operator: '<=', value: 140 },  // 150 → 140
        base.conditions[1],
      ],
    }
    const d = computeStrategyDiff(base, after)
    expect(d.conditionsRemoved).toHaveLength(1)
    expect(d.conditionsAdded).toHaveLength(1)
  })

  it('조건 순서 바뀌어도 변경 없음 (문자열 기반, 순서 무관)', () => {
    const after: ParsedStrategy = {
      ...base,
      conditions: [base.conditions[1], base.conditions[0]],
    }
    const d = computeStrategyDiff(base, after)
    expect(d.conditionsAdded).toEqual([])
    expect(d.conditionsRemoved).toEqual([])
    expect(hasDiff(d)).toBe(false)
  })

  it('복합 변경 (logic + 조건 추가 + 조건 제거)', () => {
    const after: ParsedStrategy = {
      name: base.name,
      ticker: base.ticker,
      conditions: [
        { type: 'price', operator: '<=', value: 150 },
        { type: 'earnings_within_days', operator: '>=', value: 7 },
      ],
      logic: 'OR',
      frequency: 'daily',
    }
    const d = computeStrategyDiff(base, after)
    expect(d.logicChanged).toEqual({ from: 'AND', to: 'OR' })
    expect(d.conditionsAdded).toHaveLength(1)
    expect(d.conditionsRemoved).toHaveLength(1)
    expect(hasDiff(d)).toBe(true)
  })
})
