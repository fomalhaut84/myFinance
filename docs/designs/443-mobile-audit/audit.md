# Phase 39-A: 모바일 반응형 감사 리포트 (Discovery)

**대상**: 17차 마일스톤 (#443) 서브이슈 #450
**작성일**: 2026-07-14
**방식**: 정적 코드 감사 (grep 기반 anti-pattern 스캔). 브라우저 시각 검증은 39-B 수정 시 spot-check 로 병행.
**뷰포트 기준**: iPhone SE 375 · iPhone Pro Max 430 · iPad 768

---

## Executive Summary

**총평:** 모바일 기반 인프라는 대체로 잘 갖춰짐. 골격 (responsive padding, 테이블 overflow wrapper, Sidebar↔BottomTab 분기, `ResponsiveContainer` 차트, **모든 모달 overlay `px-4`**) 은 모두 정상 동작. 실제 UX pain 은 **밀집한 데이터 테이블의 수평 스크롤 pain** 이 유일한 상위 이슈.

**H(High) 1개 / M(Medium) 4개 / L(Low) 3개** 로 분류. H 는 39-B 필수, M 은 39-B/C 병행, L 은 follow-up 이슈 후보.

**[Codex #459 P2 반영]** 초기 audit 은 `w-full max-w-lg` 모달 두 개 (Strategy Edit, Alert Detail) 를 H1 로 flag 했으나 오탐이었다. 두 모달 모두 overlay 에 `px-4` (`fixed ... justify-center px-4`) 가 있어 375 viewport 에서 `w-full` 이 padded content (343px) 로 resolve → `max-w-lg` (512px) 는 wider screen 만 cap. 실제 clipping 없음. 전체 모달 overlay 12개 조사 결과 모두 `px-4` 있음.

---

## 감사 통과 항목 (✓ 문제 없음)

| 검사 항목 | 결과 |
|---|---|
| 모든 페이지 responsive padding (`px-4 sm:px-6 lg:px-8`) | ✓ 13개 페이지 모두 통과 |
| 모든 `<table>` 상단 wrapper 에 `overflow-x-auto` | ✓ 15개 테이블 모두 통과 |
| `Sidebar` (hidden lg:flex) ↔ `BottomTab` (lg:hidden) 분기 | ✓ 정상 |
| 차트 `ResponsiveContainer` 사용 | ✓ dashboard/expense/performance 모두 통과 |
| Toast: `w-[calc(100vw-2rem)] max-w-[360px]` | ✓ viewport 좁을 때 auto-fit |
| Side panel form modals: `max-w-[420px]` | ✓ 430 viewport 까지 여유, 375 도 clipping 없음 (`h-full` + slide-in) |
| Delete confirm modals: `max-w-[380px]` | ✓ 375 viewport 여유 |
| **Center-align modals (Strategy Edit, Alert Detail, 그 외 12개)**: overlay `px-4` 안에 `w-full max-w-lg` | ✓ 375 viewport 에서 `w-full` → 343px (padded), `max-w-lg` (512px) 는 wider screen 만 cap → clipping 없음 |

---

## H (High) — 39-B 반드시 수정

### ~~H1. 대형 모달이 375px 뷰포트 초과 → clipping~~ (오탐, Codex #459 P2)

**철회 사유**: overlay 가 `fixed ... justify-center px-4` 로 padding → `w-full` 이 padded content (343px @ 375 viewport) 로 resolve. `max-w-lg` (512px) 는 wider screen 만 cap → 실제 clipping 없음. 전체 12개 center-align modal 조사 결과 모두 동일 패턴. **39-B 스코프에서 제거.**

---

### H1. 데이터 테이블 8+ 컬럼 → 수평 스크롤 pain (기존 H2)

**증상**: `overflow-x-auto` 는 있어서 body horizontal overflow 는 방지되지만, 사용자가 좌우 반복 스크롤 필요. 375 viewport 에서 8컬럼 = 셀당 ~50px → 종목명·수치가 잘려서 보임 (`truncate` 도 어색).

**대상**:
- `src/components/dashboard/HoldingsTable.tsx` — 8 컬럼 (종목/평단/현재가/평가금액/손익률/전략 등)
- `src/components/watchlist/WatchlistTable.tsx` — 8 컬럼
- `src/components/expense/TransactionTable.tsx` — 6 컬럼 (그중 카테고리·설명 긴 문자열)

**Fix 방향 (선택지):**
- (a) 카드 UI 전환 — mobile 에서 `lg:table` 스타일 유지, `<lg` 은 카드 스택 (한 row = 한 카드).
- (b) 컬럼 우선순위화 — mobile 은 top-3 컬럼만 (종목·손익률·평가금액), 나머지는 접힘/detail modal.
- (c) 그대로 두고 hint 표시 ("← 좌우로 스크롤") — 최소 개입, UX 는 여전히 나쁨.

**권장:** (a) or (b). 대시보드 HoldingsTable / WatchlistTable 은 접근 빈도 최상위.

**심각도 근거:** 사용자가 매일 여러 번 대시보드 확인. 손익 한눈에 파악이 목표인데 좌우 스크롤이 강요됨 → 방문 만족도 저하.

---

## M (Medium) — 39-B/C 병행 가능

### M1. 아이콘-only 닫기 버튼이 44px 미만

**증상**: `p-1.5` (총 padding 12px) + 아이콘 24px ≈ **36px** 실효 터치 영역. Apple HIG 권장 44×44 미달. 손가락 큰 사용자 mis-tap.

**대상** (10+ 파일):
- `src/components/expense/TransactionForm.tsx:218`
- `src/components/expense/RecurringForm.tsx:114`
- `src/components/asset/AssetForm.tsx:120`
- `src/components/rsu/RSUForm.tsx:105`
- `src/components/deposit/DepositEditPanel.tsx:100`
- `src/components/category/CategoryForm.tsx:86` / `CategoryEditPanel.tsx:102`
- `src/components/category/CategoryTable.tsx:100,103` (edit/delete 아이콘)
- `src/components/settings/IncomeProfileManager.tsx:162`

**Fix 방향**: 공통 `IconButton` 컴포넌트 도입 → `p-2.5` (총 20px) 로 통일, 총 실효 영역 ~44px. 또는 개별 `p-1.5` → `p-2 sm:p-1.5` 로 mobile 만 확장.

---

### M2. `BudgetManager` / `RecurringForm` 하드코드 fixed width

**증상**: 320px viewport 안에서 `w-[120px]` + `w-[140px]` 조합이 layout 을 강제 → 나머지 필드 압축.

**대상**:
- `src/components/expense/BudgetManager.tsx:160` (w-[120px]), `:257` (w-[140px])
- `src/components/expense/RecurringForm.tsx:160` (w-[120px]), `:186` (w-[100px])

**Fix 방향**: `w-[120px] sm:w-[140px]` 같은 responsive, 또는 flex 기반 (`flex-1` + `min-w-0`).

---

### M3. 3-column form grids on 375px

**증상**: `grid grid-cols-3 gap-2` — 375 viewport 에서 셀당 ~110px 이하 → 숫자 input 은 OK, 텍스트 label + select 는 답답.

**대상**:
- `src/components/deposit/DepositForm.tsx:86`
- `src/components/dividend/DividendForm.tsx:166`
- `src/components/trade/TradeForm.tsx:199`
- `src/components/trade/import/StepUpload.tsx:86` / `StepValidation.tsx:113` / `StepResult.tsx:37`
- `src/components/tax/DividendTaxCard.tsx:30`

**Fix 방향**: `grid-cols-1 sm:grid-cols-3` 또는 `grid-cols-2 sm:grid-cols-3`. 특히 form 은 `grid-cols-1` 이 가장 안전.

---

### M4. Filter bar 밀도 — `/admin/mcp-logs`

**증상**: `flex flex-wrap gap-2` 로 대응은 됐지만, 필터 6~10개 (Level x 6 + Msg x 15+) 가 nav bar 스크롤로 이어져 감사 UI 가 세로로 길어짐. `LiveTailPanel` toggle 도 같은 라인.

**대상**:
- `src/app/admin/mcp-logs/McpLogsClient.tsx:231, 250` (level/msg 필터 그리드)

**Fix 방향**: 필터를 `<details>` 로 접기 (mobile), 활성 필터 chip 만 상단 노출. 데스크톱은 그대로.

---

## L (Low) — Follow-up 이슈 후보

### L1. Vesting Calendar `grid-cols-7`

**증상**: 375 viewport 에서 셀당 ~53px, 날짜 라벨 + 뱃지 겹칠 여지. 사용자가 vesting 캘린더를 자주 보지 않으니 우선순위 낮음.

**대상**: `src/components/vesting/VestingCalendar.tsx:81, 89`

**Fix 방향**: 상세 페이지에서만 열리므로 유지 가능. 심각하면 mobile 은 리스트 뷰로 전환.

---

### L2. AI chat 페이지 message max-width

`max-w-[85%] sm:max-w-[75%]` — 375 viewport 에서 85% = 320px, 코드블록·리스트 있으면 좌우 스크롤 유발. 하지만 이미 responsive → sm 이상만 조정. Low.

---

### L3. FamilyTotalCard 3열 고정

3인 가족 카드가 375 viewport 에서 셀당 ~110px → 카드 이름 (세진/소담/다솜) + 총액이 겹치지 않고 표시 확인 완료. 이슈 없음. 필요 시 세로 스택 옵션.

---

## 우선순위 매트릭스 (사용 빈도 × 심각도)

| 항목 | 빈도 | 심각도 | 액션 |
|---|---|---|---|
| ~~H1 모달 clipping~~ | — | — | **철회 (Codex #459 P2 오탐)** |
| H1 HoldingsTable / WatchlistTable 수평 스크롤 | **최상** | H | **39-B 필수** |
| M1 아이콘 닫기 버튼 <44px | 상 | M | 39-B (공용 IconButton 도입) |
| M2 BudgetManager fixed w-[120/140] | 중 | M | 39-B |
| M3 3-col form grids | 중 | M | 39-B 또는 39-C |
| M4 mcp-logs 필터 밀도 | 하 | M | **39-C** (admin/mcp-logs 는 v2 페이지 재감사 대상) |
| L1 Vesting calendar | 하 | L | Follow-up |
| L2 AI chat max-w | 하 | L | Follow-up |
| L3 FamilyTotalCard | 하 | L | 이슈 없음 |

---

## 39-B / 39-C 스코프 제안

### 39-B (모바일 상위 페이지 개선 — #451)
**포함:**
- H1 HoldingsTable, WatchlistTable 카드 뷰 or 컬럼 우선순위화 (2 파일)
- M1 아이콘 버튼 공용 컴포넌트 → 일괄 교체 (10+ 파일)
- M2 BudgetManager / RecurringForm fixed width fix (2 파일)
- M3 form 3-col grids (7 파일) — 시간 남으면

**노력**: M (1.5~2일 — 이전 H1 철회로 소폭 단축)

### 39-C (모바일 v2 신규 페이지 재감사 — #452)
**포함:**
- **AlertHistoryClient (33-B), LiveTailPanel (37-C), McpLogsClient (33-C/37-C/37-D)** — 실기기 뷰포트 3종 spot-check
- M4 mcp-logs 필터 밀도 fix
- 39-B fix 후 재확인 (regression 감지)

**노력**: S (1일)

### Follow-up 이슈 (17차 밖)
- L1 Vesting calendar 리스트 뷰 옵션
- L2 AI chat 코드블록 mobile 처리
- IconButton 도입 시 발견될 accessibility 개선 (`aria-label` 통일)

---

## Screenshots

이번 discovery 는 정적 코드 감사로 진행 — 시각 검증은 39-B 구현 후 spot-check 로 병행. 실기기 캡처가 필요한 이슈는 M4 (McpLogs 필터 밀도 체감) 정도로 39-C 에서 별도 수행.

`screenshots/` 폴더는 39-B 구현 시 before/after 시각 증거로 활용.
