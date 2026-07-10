/**
 * Phase 35-B (#434) — 전략 편집 diff 계산 (pure).
 * 미리보기 UI 가 변경 사항을 하이라이트하기 위한 순수 함수.
 */

import type { Condition, LogicOp, Frequency, ParsedStrategy } from './types'
import { conditionToString } from './types'

export interface StrategyDiff {
  nameChanged?: { from: string; to: string }
  logicChanged?: { from: LogicOp; to: LogicOp }
  frequencyChanged?: { from: Frequency; to: Frequency }
  tickerChanged?: { from: string; to: string }
  conditionsAdded: Condition[]
  conditionsRemoved: Condition[]
}

/** Condition 등가 판정 — conditionToString 문자열 표현으로 비교 (조건 순서 무관). */
function condKey(c: Condition): string {
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
