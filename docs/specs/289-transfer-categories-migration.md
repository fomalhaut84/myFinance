# 289: transfer 카테고리 idempotent 데이터 마이그레이션

## 목적

`prisma/seed.ts:309-312`의 4개 transfer 카테고리(`savings`, `deposit`, `investment`, `etc-transfer`)를 idempotent SQL 마이그레이션으로 분리해, 기존 DB에 `prisma migrate deploy`만 실행해도 자동 등록되도록 한다.

## 배경

- v0.5.0 릴리즈 PR #288의 Codex 리뷰에서 식별된 P1
- 시드 스크립트는 신규 설치에만 실행됨. 운영 업그레이드 경로(`prisma migrate deploy`)에는 미적용
- transaction API는 `type === 'transfer'`인 카테고리만 transfer 거래 허용 → 누락 시 자산 이체 흐름 차단

## 요구사항

- [ ] `prisma/migrations/<timestamp>_add_transfer_categories/migration.sql` 신규 생성
- [ ] 4개 카테고리 INSERT (ON CONFLICT DO NOTHING으로 idempotent 보장)
- [ ] 기존 운영 DB에 이미 있으면 충돌 없이 통과
- [ ] 신규 DB에는 정상 생성

## 기술 설계

### Schema 제약
- `slug` UNIQUE → `ON CONFLICT ("slug") DO NOTHING`
- `name` UNIQUE → 보조 충돌 방지에 도움
- `id`는 Prisma 측 `cuid()` 기본값, raw SQL에서는 직접 지정 필요 → `gen_random_uuid()::text` 사용
- `keywords`는 PostgreSQL `text[]` 배열
- `createdAt`은 default(now()) 적용

### Migration SQL

```sql
INSERT INTO "Category" (id, slug, name, type, icon, keywords, "sortOrder", "groupId", "createdAt")
VALUES
  (gen_random_uuid()::text, 'savings', '적금', 'transfer', '🏦', ARRAY['적금','저축'], 1, NULL, NOW()),
  (gen_random_uuid()::text, 'deposit', '예금', 'transfer', '💳', ARRAY['예금','정기예금'], 2, NULL, NOW()),
  (gen_random_uuid()::text, 'investment', '투자계좌', 'transfer', '📈', ARRAY['투자','증권','주식계좌'], 3, NULL, NOW()),
  (gen_random_uuid()::text, 'etc-transfer', '기타이체', 'transfer', '🔄', ARRAY['이체','송금'], 99, NULL, NOW())
ON CONFLICT ("slug") DO NOTHING;
```

### Seed와의 일관성

`prisma/seed.ts:309-312`는 그대로 유지. 신규 설치 시 시드가 createMany로 생성하지만, 시드를 거치지 않은 환경(production)에서도 마이그레이션이 보장.

## 테스트 계획

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] 마이그레이션 SQL 구문 검증
- [ ] 운영 DB에 적용 후 4개 카테고리 존재 확인 (이미 있다면 ON CONFLICT 통과)

## 배포

`prisma migrate deploy` 시 자동 적용. 별도 수동 작업 불필요.

## 라벨

- `fix`, `P1`
