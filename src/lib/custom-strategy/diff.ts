/**
 * Phase 35-B (#434) — 전략 편집 diff 계산 (pure).
 * 미리보기 UI 가 변경 사항을 하이라이트하기 위한 순수 함수.
 */

import type { Condition, LogicOp, Frequency, ParsedStrategy, WeekdayCode } from './types'
import { conditionToString } from './types'

export interface StrategyDiff {
  nameChanged?: { from: string; to: string }
  logicChanged?: { from: LogicOp; to: LogicOp }
  frequencyChanged?: { from: Frequency; to: Frequency }
  tickerChanged?: { from: string; to: string }
  conditionsAdded: Condition[]
  conditionsRemoved: Condition[]
}

/**
 * Condition 등가 판정용 canonical key (Codex #440 재재리뷰 P2 반영).
 * 대부분은 `conditionToString` 그대로 사용. 예외:
 *   - `weekday` value 는 evaluator 가 `includes` 로 unordered set 취급 →
 *     ['MON','TUE'] 와 ['TUE','MON'] 는 의미 동일. 순서 유지 시 오검출.
 *     정렬한 배열로 별도 canonical key 생성.
 */
function condKey(c: Condition): string {
  if (c.type === 'weekday' && Array.isArray(c.value)) {
    const sorted = [...(c.value as WeekdayCode[])].sort()
    return `weekday ${c.operator} [${sorted.join(',')}]`
  }
  return conditionToString(c)
}

export function computeStrategyDiff(before: ParsedStrategy, after: ParsedStrategy): StrategyDiff {
  const diff: StrategyDiff = { conditionsAdded: [], conditionsRemoved: [] }

  if (before.name !== after.name) {
    diff.nameChanged = { from: before.name, to: after.name }
  }
  if (before.ticker !== after.ticker) {
    diff.tickerChanged = { from: before.ticker, to: after.ticker }
  }
  if (before.logic !== after.logic) {
    diff.logicChanged = { from: before.logic, to: after.logic }
  }
  if (before.frequency !== after.frequency) {
    diff.frequencyChanged = { from: before.frequency, to: after.frequency }
  }

  const beforeKeys = new Map(before.conditions.map((c) => [condKey(c), c]))
  const afterKeys = new Map(after.conditions.map((c) => [condKey(c), c]))

  for (const [k, c] of afterKeys) {
    if (!beforeKeys.has(k)) diff.conditionsAdded.push(c)
  }
  for (const [k, c] of beforeKeys) {
    if (!afterKeys.has(k)) diff.conditionsRemoved.push(c)
  }

  return diff
}

/** diff 가 실제 변경을 포함하는지 (미리보기 UI 에서 "변경 없음" 표시용) */
export function hasDiff(d: StrategyDiff): boolean {
  return !!(
    d.nameChanged || d.logicChanged || d.frequencyChanged || d.tickerChanged ||
    d.conditionsAdded.length > 0 || d.conditionsRemoved.length > 0
  )
}

/**
 * Pure — 두 조건 배열이 의미적으로 동일한지 (순서·필드순 무관) 비교.
 * `conditionToString` 은 fixed key order (`type / operator / value / timeframe`) 로
 * 렌더링하므로 원본 오브젝트의 필드 순서에 관계없이 같은 문자열을 생성.
 *
 * PUT 흐름에서 conditions 무변경 판정에 사용 (Codex #440 재리뷰 P2 — 이전 구현은
 * `JSON.stringify` 로 field-order-sensitive 비교 → 동일 의미인데 필드 순서만 다른
 * 요청도 변경으로 오판 → lastTriggeredAt 오리셋 → `once` 재무장).
 */
export function conditionsEqual(a: Condition[], b: Condition[]): boolean {
  if (a.length !== b.length) return false
  const sa = a.map(condKey).sort()
  const sb = b.map(condKey).sort()
  return sa.every((s, i) => s === sb[i])
}
