-- Issue #289: transfer 카테고리 idempotent 데이터 마이그레이션
--
-- prisma/seed.ts에만 등록되어 있던 4개 transfer 카테고리를 운영 업그레이드 경로
-- (prisma migrate deploy)에도 보장. ON CONFLICT로 기존 DB에는 영향 없음.
--
-- transaction API는 type = 'transfer'인 카테고리만 자산 이체 거래를 허용하므로
-- 누락 시 transfer 흐름이 차단된다.
--
-- id는 결정적 문자열(slug 기반)을 사용 — gen_random_uuid()는 PostgreSQL 13+ 또는
-- pgcrypto 확장 필요. 결정적 ID로 의존성 제거 + 두 번째 실행 시에도 안전.

INSERT INTO "Category" (id, slug, name, type, icon, keywords, "sortOrder", "groupId", "createdAt")
VALUES
  ('cat_transfer_savings',      'savings',      '적금',     'transfer', '🏦', ARRAY['적금','저축']::text[],             1,  NULL, NOW()),
  ('cat_transfer_deposit',      'deposit',      '예금',     'transfer', '💳', ARRAY['예금','정기예금']::text[],         2,  NULL, NOW()),
  ('cat_transfer_investment',   'investment',   '투자계좌', 'transfer', '📈', ARRAY['투자','증권','주식계좌']::text[],   3,  NULL, NOW()),
  ('cat_transfer_etc',          'etc-transfer', '기타이체', 'transfer', '🔄', ARRAY['이체','송금']::text[],             99, NULL, NOW())
ON CONFLICT ("slug") DO NOTHING;
