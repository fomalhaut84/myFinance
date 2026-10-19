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

function loadStatements(): string[] {
  const raw = readFileSync(SQL_PATH, 'utf8')
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
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
      expect(statements.some((s) => s.startsWith(`UPDATE "${table}"`) && s.includes(`'490490.KS'`))).toBe(true)
    }
  })

  it('유니크 제약 테이블은 정답 티커가 이미 있으면 건너뛴다', () => {
    const holding = statements.find((s) => s.startsWith('UPDATE "Holding"'))!
    expect(holding).toMatch(/NOT EXISTS \([\s\S]*"accountId" = h\."accountId"[\s\S]*'490490\.KS'/)
    const watchlist = statements.find((s) => s.startsWith('UPDATE "Watchlist"'))!
    expect(watchlist).toMatch(/NOT EXISTS \([\s\S]*'490490\.KS'/)
  })

  it('잘못된 라벨의 PriceCache 행은 참조가 없을 때만 삭제한다', () => {
    const del = statements.find((s) => s.startsWith('DELETE FROM "PriceCache"'))!
    expect(del).toMatch(/NOT EXISTS \(SELECT 1 FROM "Holding"/)
    expect(del).toMatch(/NOT EXISTS \(SELECT 1 FROM "Watchlist"/)
    expect(del).toMatch(/NOT EXISTS \(SELECT 1 FROM "CustomStrategy" cs WHERE cs\."isActive"/)
  })
})
