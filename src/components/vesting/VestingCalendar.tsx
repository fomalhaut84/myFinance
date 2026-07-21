'use client'

import { useMemo, useState } from 'react'
import {
  buildMonthGrid,
  diffDaysKST,
  groupEventsByDate,
  toKSTDateString,
  upcomingEvents,
  type VestingEvent,
} from '@/lib/vesting-events'
import VestingEventBar from './VestingEventBar'

interface Props {
  events: VestingEvent[]
  todayMs: number
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MAX_BARS_PER_CELL = 3

function kstYearMonth(todayMs: number): { year: number; month: number } {
  const todayKey = toKSTDateString(new Date(todayMs))
  const [y, m] = todayKey.split('-').map(Number)
  return { year: y, month: m - 1 }
}

export default function VestingCalendar({ events, todayMs }: Props) {
  const todayKey = useMemo(() => toKSTDateString(new Date(todayMs)), [todayMs])
  const todayYM = useMemo(() => kstYearMonth(todayMs), [todayMs])
  const [cursor, setCursor] = useState(todayYM)

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const byDate = useMemo(() => groupEventsByDate(events), [events])

  const go = (delta: number) => {
    setCursor((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  const jumpToToday = () => {
    setCursor(todayYM)
  }

  const monthLabel = `${cursor.year}년 ${cursor.month + 1}월`

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Phase 41-A (#470): 캘린더 헤더 (월 이동) 는 데스크톱 전용. mobile 리스트 뷰는
          자체 헤더 (다가오는 90일) 를 MobileVestingList 안에 둠. */}
      <div className="hidden lg:flex px-5 py-4 items-center justify-between border-b border-border">
        <div className="flex items-center gap-4">
          <h2 className="text-[18px] font-bold text-bright tracking-tight tabular-nums">
            {monthLabel}
          </h2>
          <span className="hidden sm:inline text-[11px] text-dim">KST 기준</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => go(-1)}
            className="px-2.5 py-1.5 rounded-md text-[12px] font-semibold text-sub border border-border hover:bg-surface hover:text-bright transition-colors"
          >
            ← 이전
          </button>
          <button
            type="button"
            onClick={jumpToToday}
            className="px-2.5 py-1.5 rounded-md text-[12px] font-bold text-bright bg-surface border border-border hover:bg-surface-hover transition-colors"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="px-2.5 py-1.5 rounded-md text-[12px] font-semibold text-sub border border-border hover:bg-surface hover:text-bright transition-colors"
          >
            다음 →
          </button>
        </div>
      </div>

      {/* Phase 41-A (#470, 39-A audit L1): mobile 은 리스트 뷰. 7-col grid 는
          375px viewport 에서 셀당 ~50px → 날짜/뱃지 겹칠 여지. lg 이하는 다가오는
          이벤트 (90일) 카드 스택으로 대체. lg+ 는 기존 캘린더 유지. */}
      <MobileVestingList events={events} todayMs={todayMs} todayKey={todayKey} />

      <div className="hidden lg:grid grid-cols-7 px-2 pt-3 pb-2 text-[10px] font-bold text-dim tracking-[1.2px] uppercase">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`px-3 ${i === 0 ? 'text-red-500/80 dark:text-red-400/80' : ''}`}>
            {d}
          </div>
        ))}
      </div>

      <div className="hidden lg:grid grid-cols-7 gap-px px-2 pb-3">
        {grid.map((d) => {
          const key = toKSTDateString(d)
          const otherMonth = d.getMonth() !== cursor.month
          const isToday = key === todayKey
          const dayEvents = byDate.get(key) ?? []
          const dow = d.getDay()

          const dayColor = dow === 0
            ? 'text-red-500 dark:text-red-400'
            : otherMonth ? 'text-dim' : 'text-sub'
          const cellClass = [
            'rounded-lg px-2.5 py-2 min-h-[88px] sm:min-h-[104px] flex flex-col gap-1.5 transition-colors',
            otherMonth ? 'opacity-40' : 'hover:bg-surface',
            isToday ? 'bg-amber-500/10 dark:bg-amber-500/15 ring-1 ring-inset ring-amber-500/50 dark:ring-amber-500/40' : '',
          ].filter(Boolean).join(' ')

          return (
            <div key={key} className={cellClass}>
              <div className="flex items-center justify-between">
                <span className={`text-[12px] font-bold tabular-nums ${dayColor}`}>
                  {d.getDate()}
                </span>
                {dayEvents.length > 1 && (
                  <span className="text-[9px] text-dim tabular-nums">{dayEvents.length}</span>
                )}
              </div>
              <div className="flex flex-col gap-1 items-start">
                {dayEvents.slice(0, MAX_BARS_PER_CELL).map((ev) => (
                  <VestingEventBar key={ev.id} event={ev} />
                ))}
                {dayEvents.length > MAX_BARS_PER_CELL && (
                  <span className="text-[10px] text-dim">
                    +{dayEvents.length - MAX_BARS_PER_CELL}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-t border-border text-[11px] text-sub">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-sejin" /> RSU
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-sodam" /> 스톡옵션
        </span>
        <span className="ml-auto text-dim text-[10px]">
          미베스팅(점) · 베스팅 완료(✓) · 행사 완료(엷음) · 만료(회색 ✗)
        </span>
      </div>
    </div>
  )
}

/**
 * Phase 41-A (#470) — 모바일 (`<lg`) 전용 vesting 리스트 뷰.
 * 다가오는 90일 이벤트만 카드 스택으로 표시. 데스크톱은 캘린더 그리드 유지.
 */
// Codex #477 P2: `exercisable` 은 OPTION 전용 actionable 상태 (행사 가능) — RSU 의
// `vested` (완료 상태) 와 구분해야 사용자가 행사 액션을 놓치지 않음.
// StockOptionDashboard 와 동일 라벨 (`행사 가능`) 사용.
const STATUS_LABEL: Record<VestingEvent['status'], string> = {
  pending: '미베스팅',
  exercisable: '행사 가능',
  vested: '베스팅 완료',
  exercised: '행사 완료',
  expired: '만료',
}
const STATUS_CLASS: Record<VestingEvent['status'], string> = {
  pending: 'text-dim',
  // actionable → amber 강조 + bold (사용자 시선 유도)
  exercisable: 'text-amber-500 dark:text-amber-400 font-bold',
  vested: 'text-sejin',
  exercised: 'text-sub opacity-60',
  expired: 'text-sub opacity-60',
}
const TYPE_DOT: Record<VestingEvent['type'], string> = {
  RSU: 'bg-sejin',
  OPTION: 'bg-sodam',
}

function MobileVestingList({
  events, todayMs, todayKey,
}: { events: VestingEvent[]; todayMs: number; todayKey: string }) {
  const upcoming = useMemo(() => upcomingEvents(events, 90, todayMs), [events, todayMs])

  return (
    <div className="lg:hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between">
        <h2 className="text-[14px] font-bold text-bright">다가오는 90일</h2>
        <span className="text-[11px] text-dim">{upcoming.length}건 · KST</span>
      </div>
      {upcoming.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-dim">
          다가오는 vesting 이 없습니다.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {upcoming.map((ev) => {
            const days = diffDaysKST(ev.date, todayMs)
            const isToday = ev.date === todayKey
            const daysLabel = isToday ? '오늘' : days === 1 ? '내일' : `${days}일 후`
            return (
              <li
                key={ev.id}
                className={`px-4 py-3 flex items-center gap-3 ${isToday ? 'bg-amber-500/10 dark:bg-amber-500/15' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_DOT[ev.type]}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-bright tabular-nums">{ev.date.slice(5)}</span>
                    <span className={`text-[11px] ${isToday ? 'text-amber-500 dark:text-amber-400 font-semibold' : 'text-sub'}`}>
                      {daysLabel}
                    </span>
                  </div>
                  <div className="text-[12px] text-sub truncate mt-0.5">
                    <span className="font-semibold text-bright">{ev.displayName}</span>
                    {ev.shares > 0 && (
                      <span className="text-dim tabular-nums"> · {ev.shares.toLocaleString('ko-KR')}주</span>
                    )}
                  </div>
                </div>
                <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${STATUS_CLASS[ev.status]}`}>
                  {STATUS_LABEL[ev.status]}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
