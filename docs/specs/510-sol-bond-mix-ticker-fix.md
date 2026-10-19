# [Fix] SOL 미국배당미국채혼합50 티커 오류 (472150.KS → 490490.KS)

- **이슈**: #510
- **작성일**: 2026-10-19
- **타입**: 버그 (데이터 정정 + 재발 방지)
- **노력 예상**: S
- **우선순위**: P1

## 1. 원인 (확정)

이슈는 "자연어 거래 입력의 이름 유사도 오매칭"을 추정했지만 실제 경로는 다르다.

1. **최초 유입 — 시드 데이터.** `prisma/seed.ts` 의 소담 보유 `SOL 미국배당미국채혼합50` (2024-08-01, 72주) 이
   처음부터 `472150.KS` (TIGER 배당커버드콜액티브) 로 들어가 있었다. `docs/data-model.md` 티커 매핑표,
   `docs/architecture.md`, `docs/seed-data.md` 도 같은 값이었다.
2. **전파 — PriceCache 라벨을 이름 사전으로 사용.** 주가 갱신(`refreshPrices`)은 PriceCache.displayName 을 보유 종목의
   라벨로 덮어쓴다. 그래서 `472150.KS` 행이 'SOL 미국배당미국채혼합50' 이라는 이름을 갖게 됐고, 봇의 두 거래 입력 경로
   (`/매수`·`/매도` 명령 `trade.ts`, AI 자연어 `ai.ts`) 가 종목명 → `priceCache.displayName` 정확 일치로 티커를 찾으면서
   이후 매수(소담 10/15, 다솜 10/16 신규 보유) 가 모두 같은 잘못된 티커를 받았다. 이름 매칭 자체는 정확 일치라 "유사도"
   문제가 아니라, **사용자 라벨이 시세 소스의 실제 종목과 대조되지 않는 구조**가 원인이다.
3. **탐지 실패 — 확인 단계에 대조 정보 없음.** 미리보기에 라벨과 티커만 보여 오매칭을 알아챌 단서가 없었다
   (체결가 10,640원 vs 매칭 티커 현재가 16,200원 — 34% 괴리).

## 2. 수정

### A. 데이터 정정 마이그레이션 (`20261019090100_fix_sol_bond_mix_ticker`)

- [x] Holding · Trade · Dividend · HoldingSnapshot · Watchlist 의 `472150.KS` + 해당 라벨 행을 `490490.KS` 로 치환
- [x] 멱등 — 서버 DB 일부 수동 정정 상태에서도 안전 (모든 문장이 잘못된 티커 + 라벨 조합에만 매칭)
- [x] 유니크 충돌 (같은 계좌에 490490.KS 보유 / 관심종목 이미 존재) 시 건너뜀 — 자동 병합 금지
- [x] PriceCache 의 잘못된 라벨 행: 참조 없으면 삭제, 남아 있으면 라벨을 실제 종목명으로 교정

### B. 실제 종목명 보존 (`20261019090000_add_price_cache_quote_name`)

- [x] `PriceCache.quoteName` (nullable) — Yahoo shortName/longName. 라벨(displayName)과 분리 저장
- [x] `fetchQuote` / `refreshPrices` upsert 양쪽에서 채움 (`extractQuoteName`)

### C. 확인 단계 대조 (`src/bot/utils/trade-price-check.ts`)

- [x] 미리보기에 `Yahoo 종목명: …` 라인 — 라벨이 틀린 티커에 붙어 있으면 다른 이름이 보인다
- [x] 입력 단가가 매칭 티커 현재가와 20% 이상 다르면 ⚠️ 경고 (차단하지 않음 — 과거 거래 소급 입력 고려)
- [x] `/매수`·`/매도` 와 AI 자연어 입력 양쪽 적용

### D. 시드 / 문서

- [x] `prisma/seed.ts`, `docs/data-model.md`, `docs/architecture.md`, `docs/seed-data.md` → `490490.KS`

## 3. 테스트

- `src/bot/utils/__tests__/trade-price-check.test.ts` — 실제 오매칭 수치 재현 (10,640 vs 16,200 → 경고), 임계 경계, 캐시 없음
- `src/lib/__tests__/migration-fix-sol-bond-mix-ticker.test.ts` — 멱등 조건, 테이블 범위, 유니크 충돌 가드, 캐시 삭제 조건
- `src/lib/__tests__/price-fetcher-utils.test.ts` — `extractQuoteName`

## 4. 배포 후 확인

```sql
-- 잔여 오류 0건이어야 함
SELECT 'Holding' t, count(*) FROM "Holding" WHERE "ticker"='472150.KS' AND "displayName"='SOL 미국배당미국채혼합50'
UNION ALL SELECT 'Trade', count(*) FROM "Trade" WHERE "ticker"='472150.KS' AND "displayName"='SOL 미국배당미국채혼합50';
-- 계좌별 보유 중복 없음 (충돌 skip 발생 여부)
SELECT a."name", h."ticker", h."shares" FROM "Holding" h JOIN "Account" a ON a."id"=h."accountId"
WHERE h."ticker" IN ('472150.KS','490490.KS');
```

## 5. 제외

- 과거 HoldingSnapshot 의 `price`/`valueKRW` 재계산 — 당시 잘못된 시세로 계산됐지만 날짜별 490490.KS 과거 시세 백필이
  필요해 별도 판단
- 웹 거래 폼 (`TradeForm`) — 계좌 보유 종목 선택 또는 티커 직접 입력이라 이름 → 티커 매칭 경로가 없음
- KRX ETF 마스터 대조 — `KrxStock` 은 상장법인 목록만 수집해 ETF 가 없음
