-- #499: 지수 티커(^KS11 등)의 잔존 PriceCache 행 정리.
--
-- 지수는 주가 갱신 cron 의 refresh 대상이 아니라서, 구버전 fetchQuote 가 upsert 한 행이
-- 영구 stale 로 남는다. get_prices 가 실시간 조회에 실패하면 그 오래된 값을 '[캐시]' 로
-- 조용히 반환하므로 (읽기 지점 가드와 함께) 기존 행을 제거한다.
--
-- 스키마 변경 없음 (데이터 정리 전용). '^' 는 LIKE 의 와일드카드가 아니므로 prefix 매칭.
DELETE FROM "PriceCache" WHERE "ticker" LIKE '^%';
