/**
 * market 코드 정규화 마이그레이션 스크립트 (Phase 25-A, #281)
 *
 * 기존 DB의 PriceCache, Watchlist, Holding, Trade의 market 필드를
 * normalizeMarket()으로 일괄 변환한다.
 *
 * 사용법:
 *   tsx prisma/scripts/normalize-market-codes.ts --dry-run   # 변경 row 수만 출력
 *   tsx prisma/scripts/normalize-market-codes.ts             # 실제 적용
 */

import { PrismaClient } from '@prisma/client'
import { normalizeMarket } from '../../src/lib/market-hours'

const prisma = new PrismaClient()

interface TableStats {
  scanned: number
  changed: number
  unchanged: number
  other: number // normalize 결과가 OTHER인 row (수동 확인 대상)
  otherSamples: { key: string; raw: string }[]
}

function emptyStats(): TableStats {
  return { scanned: 0, changed: 0, unchanged: 0, other: 0, otherSamples: [] }
}

async function processTable(
  tableName: string,
  rows: { pk: string; ticker: string; market: string }[],
  applyUpdate: (pk: string, market: string) => Promise<void>,
  dryRun: boolean
): Promise<TableStats> {
  const stats = emptyStats()
  for (const row of rows) {
    stats.scanned++
    const normalized = normalizeMarket(row.market, row.ticker)
    if (normalized === 'OTHER') {
      stats.other++
      if (stats.otherSamples.length < 5) {
        stats.otherSamples.push({ key: row.ticker, raw: row.market })
      }
      continue
    }
    if (normalized === row.market) {
      stats.unchanged++
      continue
    }
    stats.changed++
    if (!dryRun) {
      await applyUpdate(row.pk, normalized)
    }
  }
  console.log(
    `[${tableName}] scanned=${stats.scanned} changed=${stats.changed} unchanged=${stats.unchanged} OTHER=${stats.other}`
  )
  if (stats.other > 0) {
    console.log(
      `  OTHER 샘플: ${stats.otherSamples.map((s) => `${s.key}(${s.raw})`).join(', ')}`
    )
  }
  return stats
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[migrate] market 코드 정규화 시작 (dry-run=${dryRun})`)

  const priceCaches = await prisma.priceCache.findMany({ select: { ticker: true, market: true } })
  const watchlists = await prisma.watchlist.findMany({ select: { id: true, ticker: true, market: true } })
  const holdings = await prisma.holding.findMany({ select: { id: true, ticker: true, market: true } })
  const trades = await prisma.trade.findMany({ select: { id: true, ticker: true, market: true } })

  await prisma.$transaction(async (tx) => {
    // PriceCache는 ticker가 PK
    await processTable(
      'PriceCache',
      priceCaches.map((p) => ({ pk: p.ticker, ticker: p.ticker, market: p.market })),
      async (ticker, market) => {
        await tx.priceCache.update({ where: { ticker }, data: { market } })
      },
      dryRun
    )
    await processTable(
      'Watchlist',
      watchlists.map((w) => ({ pk: w.id, ticker: w.ticker, market: w.market })),
      async (id, market) => {
        await tx.watchlist.update({ where: { id }, data: { market } })
      },
      dryRun
    )
    await processTable(
      'Holding',
      holdings.map((h) => ({ pk: h.id, ticker: h.ticker, market: h.market })),
      async (id, market) => {
        await tx.holding.update({ where: { id }, data: { market } })
      },
      dryRun
    )
    await processTable(
      'Trade',
      trades.map((t) => ({ pk: t.id, ticker: t.ticker, market: t.market })),
      async (id, market) => {
        await tx.trade.update({ where: { id }, data: { market } })
      },
      dryRun
    )
  })

  console.log(`[migrate] 완료${dryRun ? ' (dry-run, DB 미반영)' : ''}`)
}

main()
  .catch((err) => {
    console.error('[migrate] 실패:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
