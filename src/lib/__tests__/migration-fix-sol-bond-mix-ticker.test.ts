/**
 * #510 회귀 — 'SOL 미국배당미국채혼합50' 티커 정정 마이그레이션이 멱등이고 범위가 맞는지.
 *
 * 서버 DB 일부가 수동 정정된 상태에서 적용되므로 모든 문장이 (잘못된 티커 + 해당 라벨) 조합에만
 * 걸려야 한다. SQL 파일이라 DB 없이 실행할 수 없어 문장 구조를 단언한다.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SQL_PATH = join(
  process.cwd(),
  'prisma/migrations/20261019090100_fix_sol_bond_mix_ticker/migration.sql',
)

const WRONG = `'472150.KS'`
const LABEL = `'SOL 미국배당미국채혼합50'`
const QUARANTINE = `'SOL 미국배당미국채혼합50 [#510 병합 필요]'`

function loadSql(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

/** 경고용 DO 블록을 뺀 DML 문장들 */
function loadStatements(): string[] {
  return loadSql()
    .replace(/DO \$\$[\s\S]*?END \$\$;/, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('fix_sol_bond_mix_ticker migration (#510)', () => {
  const statements = loadStatements()

  it('모든 문장이 잘못된 티커 + 라벨 조합에만 걸린다 (멱등 · 정상 472150.KS 보존)', () => {
    for (const sql of statements) {
      expect(sql).toContain(WRONG)
      expect(sql).toContain(LABEL)
    }
  })

  it('보유 외에 거래·배당·스냅샷·관심종목 티커도 함께 정정한다', () => {
    for (const table of ['Trade', 'Dividend', 'HoldingSnapshot', 'Holding', 'Watchlist']) {
      expect(statements.some((s) => s.startsWith(`UPDATE "${table}"`) && s.includes(`SET "ticker" = '490490.KS'`))).toBe(true)
    }
  })

  it('유니크 제약 테이블은 정답 티커가 이미 있으면 건너뛴다', () => {
    const holding = statements.find((s) => s.startsWith('UPDATE "Holding" h SET "ticker"'))!
    expect(holding).toMatch(/NOT EXISTS \([\s\S]*"accountId" = h\."accountId"[\s\S]*'490490\.KS'/)
    const watchlist = statements.find((s) => s.startsWith('UPDATE "Watchlist"'))!
    expect(watchlist).toMatch(/NOT EXISTS \([\s\S]*'490490\.KS'/)
  })

  it('충돌 계좌(잘못된 보유 + 정답 보유 공존)는 거래·배당·스냅샷도 건너뛴다 — 이중 집계·기여도 왜곡 방지 (Codex #511 P2)', () => {
    for (const [table, account] of [['Trade', 't'], ['Dividend', 'd'], ['HoldingSnapshot', 'ps']]) {
      const sql = statements.find((s) => s.startsWith(`UPDATE "${table}"`))!
      expect(sql).toContain(`AND NOT (\n    EXISTS (SELECT 1 FROM "Holding" x WHERE x."accountId" = ${account}."accountId"`)
      expect(sql).toContain(`y."displayName" IN (${LABEL}, ${QUARANTINE})`)
    }
  })

  it('충돌로 남은 옛 보유는 격리 라벨로 바꿔 캐시 라벨 재오염을 막는다 (Codex #511 P2)', () => {
    const idx = (prefix: string) => statements.findIndex((s) => s.startsWith(prefix))
    const quarantineIdx = statements.findIndex(
      (s) => s.startsWith('UPDATE "Holding" SET "displayName"') && s.includes(QUARANTINE),
    )
    expect(quarantineIdx).toBeGreaterThan(idx('UPDATE "Holding" h SET "ticker"'))
    expect(statements[quarantineIdx]).toContain(`WHERE "ticker" = ${WRONG} AND "displayName" = ${LABEL}`)
  })

  it('정정을 건너뛴 옛 관심종목도 격리 라벨로 바꾼다 — 관심종목 메타 경유 캐시 재오염 차단 (Codex #511 P2)', () => {
    const idx = statements.findIndex(
      (s) => s.startsWith('UPDATE "Watchlist" SET "displayName"') && s.includes(QUARANTINE),
    )
    expect(idx).toBeGreaterThan(statements.findIndex((s) => s.startsWith('UPDATE "Watchlist" w SET "ticker"')))
    expect(statements[idx]).toContain(`WHERE "ticker" = ${WRONG} AND "displayName" = ${LABEL}`)
    expect(statements.some((s) => s.startsWith('DELETE FROM "Watchlist"'))).toBe(false)
  })

  it('충돌 판정·경고는 격리 라벨도 인식한다 (재실행 시 충돌 계좌 거래가 옮겨지지 않게)', () => {
    expect(loadSql()).toMatch(new RegExp(`DO \\$\\$[\\s\\S]*${QUARANTINE.replace(/[[\]#]/g, '\\$&')}[\\s\\S]*END \\$\\$;`))
  })

  it('거래·배당 정정이 보유 정정보다 먼저 실행된다 (보유가 바뀌면 충돌 판정이 사라지므로)', () => {
    const idx = (prefix: string) => statements.findIndex((s) => s.startsWith(prefix))
    for (const table of ['Trade', 'Dividend', 'HoldingSnapshot']) {
      expect(idx(`UPDATE "${table}"`)).toBeLessThan(idx('UPDATE "Holding" h SET "ticker"'))
    }
  })

  it('충돌 계좌는 RAISE WARNING 으로 migrate 로그에 남긴다', () => {
    expect(loadSql()).toMatch(/DO \$\$[\s\S]*RAISE WARNING '#510[\s\S]*END \$\$;/)
  })

  it('잘못된 라벨의 PriceCache 행은 참조가 없을 때만 삭제한다', () => {
    const del = statements.find((s) => s.startsWith('DELETE FROM "PriceCache"'))!
    expect(del).toMatch(/NOT EXISTS \(SELECT 1 FROM "Holding"/)
    expect(del).toMatch(/NOT EXISTS \(SELECT 1 FROM "Watchlist"/)
    expect(del).toMatch(/NOT EXISTS \(SELECT 1 FROM "CustomStrategy" cs WHERE cs\."isActive"/)
  })
})
