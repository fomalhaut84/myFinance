-- #510: 'SOL 미국배당미국채혼합50' 이 시드 데이터부터 잘못된 티커 472150.KS (TIGER 배당커버드콜액티브)
-- 로 저장돼 있었다. 정답은 490490.KS. 이후 거래가 PriceCache 라벨 → 티커 이름 매칭으로 같은 오류를 전파.
--
-- 멱등: 서버 DB 일부가 수동 정정된 상태에서도 안전하도록 모든 문장이 (잘못된 티커 + 해당 라벨)
-- 조합만 대상으로 한다. 이미 고쳐진 행은 매칭되지 않는다. 라벨 조건 덕분에 472150.KS 를 정상적으로
-- (TIGER 로) 보유/관심 등록한 행은 건드리지 않는다.
--
-- 범위: 보유(Holding) · 거래(Trade) · 배당(Dividend) · 자산 스냅샷(HoldingSnapshot) · 관심종목(Watchlist)
-- 의 티커를 함께 맞춘다 (보유만 고치면 거래 기반 재계산·세금 집계에서 종목이 둘로 갈라진다).
-- 제외: AlertHistory (발송 당시 기록), CustomStrategy (라벨 컬럼이 없어 오매칭 여부 판별 불가),
-- 과거 스냅샷의 price/valueKRW (당시 잘못된 시세로 계산된 값 — 별도 판단).
--
-- 충돌 계좌: 같은 계좌에 잘못된 보유(472150.KS + 라벨)와 정답 보유(490490.KS)가 둘 다 있으면
-- (수동 정정 중 신규 생성 등) 그 계좌는 보유·거래·배당·스냅샷을 전부 건너뛴다. 일부만 옮기면 옛 보유가
-- 거래 없이 남아 이중 집계되거나, 스냅샷 티커가 엇갈려 종목별 기여도가 왜곡된다 (Codex #511 P2).
-- 평균단가 병합은 거래 이력 재계산이 필요해 SQL 로 하지 않는다 — 경고 로그 후 수동 병합.
-- 대신 남은 옛 보유의 라벨을 격리 라벨로 바꾼다. 그대로 두면 주가 갱신이 그 라벨을 472150.KS 캐시 행에
-- 다시 써서 이름 매칭이 잘못된 티커로 되돌아간다 (Codex #511 P2). 충돌 판정은 두 라벨 모두 인식해
-- 재실행에도 같은 계좌를 계속 충돌로 본다.

DO $$
DECLARE
  conflict_accounts TEXT;
BEGIN
  SELECT string_agg(DISTINCT h."accountId", ', ') INTO conflict_accounts
  FROM "Holding" h
  WHERE h."ticker" = '472150.KS'
    AND h."displayName" IN ('SOL 미국배당미국채혼합50', 'SOL 미국배당미국채혼합50 [#510 병합 필요]')
    AND EXISTS (SELECT 1 FROM "Holding" x WHERE x."accountId" = h."accountId" AND x."ticker" = '490490.KS');
  IF conflict_accounts IS NOT NULL THEN
    RAISE WARNING '#510: 472150.KS/490490.KS 보유 충돌 계좌 건너뜀 (수동 병합 필요): %', conflict_accounts;
  END IF;
END $$;

-- 1. 거래 / 배당: 충돌 계좌 제외 (보유 정정과 같은 집합을 유지)
UPDATE "Trade" t SET "ticker" = '490490.KS'
WHERE t."ticker" = '472150.KS' AND t."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT (
    EXISTS (SELECT 1 FROM "Holding" x WHERE x."accountId" = t."accountId" AND x."ticker" = '490490.KS')
    AND EXISTS (
      SELECT 1 FROM "Holding" y
      WHERE y."accountId" = t."accountId" AND y."ticker" = '472150.KS'
        AND y."displayName" IN ('SOL 미국배당미국채혼합50', 'SOL 미국배당미국채혼합50 [#510 병합 필요]')
    )
  );

UPDATE "Dividend" d SET "ticker" = '490490.KS'
WHERE d."ticker" = '472150.KS' AND d."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT (
    EXISTS (SELECT 1 FROM "Holding" x WHERE x."accountId" = d."accountId" AND x."ticker" = '490490.KS')
    AND EXISTS (
      SELECT 1 FROM "Holding" y
      WHERE y."accountId" = d."accountId" AND y."ticker" = '472150.KS'
        AND y."displayName" IN ('SOL 미국배당미국채혼합50', 'SOL 미국배당미국채혼합50 [#510 병합 필요]')
    )
  );

-- 2. 자산 스냅샷: 계좌는 PortfolioSnapshot 경유. 충돌 계좌 제외 (라이브 보유와 티커가 엇갈리지 않게)
UPDATE "HoldingSnapshot" hs SET "ticker" = '490490.KS'
FROM "PortfolioSnapshot" ps
WHERE ps."id" = hs."portfolioSnapshotId"
  AND hs."ticker" = '472150.KS' AND hs."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT (
    EXISTS (SELECT 1 FROM "Holding" x WHERE x."accountId" = ps."accountId" AND x."ticker" = '490490.KS')
    AND EXISTS (
      SELECT 1 FROM "Holding" y
      WHERE y."accountId" = ps."accountId" AND y."ticker" = '472150.KS'
        AND y."displayName" IN ('SOL 미국배당미국채혼합50', 'SOL 미국배당미국채혼합50 [#510 병합 필요]')
    )
  );

-- 3. 보유: (accountId, ticker) 유니크 — 충돌 계좌는 건너뜀 (위 경고)
UPDATE "Holding" h SET "ticker" = '490490.KS'
WHERE h."ticker" = '472150.KS' AND h."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT EXISTS (
    SELECT 1 FROM "Holding" x WHERE x."accountId" = h."accountId" AND x."ticker" = '490490.KS'
  );

-- 4. 충돌로 남은 옛 보유 격리: 라벨을 바꿔 이름 매칭·캐시 라벨 재오염 경로에서 뺀다 (3 이후라 충돌 행만 남음)
UPDATE "Holding" SET "displayName" = 'SOL 미국배당미국채혼합50 [#510 병합 필요]'
WHERE "ticker" = '472150.KS' AND "displayName" = 'SOL 미국배당미국채혼합50';

-- 5. 관심종목: ticker 유니크
UPDATE "Watchlist" w SET "ticker" = '490490.KS'
WHERE w."ticker" = '472150.KS' AND w."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT EXISTS (SELECT 1 FROM "Watchlist" x WHERE x."ticker" = '490490.KS');

-- 6. 시세 캐시: 잘못된 라벨이 붙은 472150.KS 행은 이름 매칭의 전파 경로였다.
--    더 이상 참조하는 보유/관심종목/활성 전략이 없으면 삭제 (490490.KS 는 다음 주가 갱신에서 생성),
--    아직 참조가 남아 있으면 라벨만 실제 종목명으로 교정해 이름 매칭에서 빠지게 한다.
DELETE FROM "PriceCache" pc
WHERE pc."ticker" = '472150.KS' AND pc."displayName" = 'SOL 미국배당미국채혼합50'
  AND NOT EXISTS (SELECT 1 FROM "Holding" h WHERE h."ticker" = pc."ticker")
  AND NOT EXISTS (SELECT 1 FROM "Watchlist" w WHERE w."ticker" = pc."ticker")
  AND NOT EXISTS (SELECT 1 FROM "CustomStrategy" cs WHERE cs."isActive" AND cs."ticker" = pc."ticker");

UPDATE "PriceCache" SET "displayName" = 'TIGER 배당커버드콜액티브'
WHERE "ticker" = '472150.KS' AND "displayName" = 'SOL 미국배당미국채혼합50';
