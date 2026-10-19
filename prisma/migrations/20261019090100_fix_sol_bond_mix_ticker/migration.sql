-- #510: 'SOL 미국배당미국채혼합50' 이 시드 데이터부터 잘못된 티커 472150.KS (TIGER 배당커버드콜액티브)
-- 로 저장돼 있었다. 정답은 490490.KS. 이후 거래가 PriceCache 라벨 → 티커 이름 매칭으로 같은 오류를 전파.
--
-- 멱등: 서버 DB 일부가 수동 정정된 상태에서도 안전하도록 모든 문장이 (잘못된 티커 + 해당 라벨)
-- 조합만 대상으로 한다. 이미 고쳐진 행은 매칭되지 않는다. 라벨 조건 덕분에 472150.KS 를 정상적으로
-- (TIGER 로) 보유/관심 등록한 행은 건드리지 않는다.
--
-- 범위: 보유(Holding) · 거래(Trade) · 배당(Dividend) · 자산 스냅샷(HoldingSnapshot) · 관심종목(Watchlist)
-- 의 티커를 함께 맞춘다 (보유만 고치면 거래 기반 재계산·세금 집계에서 종목이 둘로 갈라진다).
-- 제외: AlertHistory (발송 당시 기록), 과거 스냅샷의 price/valueKRW (당시 잘못된 시세로 계산된 값 — 별도 판단).

-- 1. 거래 / 배당 / 스냅샷: 유니크 제약 없음 → 그대로 치환
UPDATE "Trade" SET "ticker" = '490490.KS'
WHERE "ticker" = '472150.KS' AND "displayName" = 'SOL 미국배당미국채혼합50';

UPDATE "Dividend" SET "ticker" = '490490.KS'
WHERE "ticker" = '472150.KS' AND "displayName" = 'SOL 미국배당미국채혼합50';

UPDATE "HoldingSnapshot" SET "ticker" = '490490.KS'
WHERE "ticker" = '472150.KS' AND "displayName" = 'SOL 미국배당미국채혼합50';

-- 2. 보유: (accountId, ticker) 유니크. 같은 계좌에 490490.KS 보유가 이미 있으면(수동 정정 중 신규 생성 등)
--    자동 병합하지 않고 건너뛴다 — 평균단가는 거래 이력 재계산이 필요하므로 SQL 로 합치지 않는다.
UPDATE "Holding" h SET "ticker" = '490490.KS'
WHERE h."ticker" = '472150.KS' AND h."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT EXISTS (
    SELECT 1 FROM "Holding" x WHERE x."accountId" = h."accountId" AND x."ticker" = '490490.KS'
  );

-- 3. 관심종목: ticker 유니크
UPDATE "Watchlist" w SET "ticker" = '490490.KS'
WHERE w."ticker" = '472150.KS' AND w."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT EXISTS (SELECT 1 FROM "Watchlist" x WHERE x."ticker" = '490490.KS');

-- 4. 시세 캐시: 잘못된 라벨이 붙은 472150.KS 행은 이름 매칭의 전파 경로였다.
--    더 이상 참조하는 보유/관심종목/활성 전략이 없으면 삭제 (490490.KS 는 다음 주가 갱신에서 생성),
--    아직 참조가 남아 있으면 라벨만 실제 종목명으로 교정해 이름 매칭에서 빠지게 한다.
DELETE FROM "PriceCache" pc
WHERE pc."ticker" = '472150.KS' AND pc."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT EXISTS (SELECT 1 FROM "Holding" h WHERE h."ticker" = pc."ticker")
  AND NOT EXISTS (SELECT 1 FROM "Watchlist" w WHERE w."ticker" = pc."ticker")
  AND NOT EXISTS (SELECT 1 FROM "CustomStrategy" cs WHERE cs."isActive" AND cs."ticker" = pc."ticker");

UPDATE "PriceCache" SET "displayName" = 'TIGER 배당커버드콜액티브'
WHERE "ticker" = '472150.KS' AND "displayName" = 'SOL 미국배당미국채혼합50';
