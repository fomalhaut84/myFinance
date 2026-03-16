/**
 * KRX 상장 종목 크롤러: 한글 종목명 → yahoo ticker 매핑
 *
 * kind.krx.co.kr에서 전체 상장법인 목록 HTML을 파싱하여
 * KrxStock 테이블에 upsert한다.
 */

import { prisma } from './prisma'

const KRX_URL = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download'

interface KrxStockEntry {
  code: string
  name: string
  market: string
  yahooTicker: string
}

/**
 * KRX HTML을 파싱하여 종목 리스트를 반환한다.
 */
async function fetchKrxStockList(): Promise<KrxStockEntry[]> {
  const res = await fetch(KRX_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })

  if (!res.ok) {
    throw new Error(`KRX 종목 리스트 다운로드 실패: ${res.status}`)
  }

  const buffer = await res.arrayBuffer()
  const html = new TextDecoder('euc-kr').decode(buffer)

  const entries: KrxStockEntry[] = []
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g
  let match: RegExpExecArray | null
  let isHeader = true

  while ((match = rowRegex.exec(html)) !== null) {
    if (isHeader) {
      isHeader = false
      continue
    }

    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cellMatch[1].trim())
    }

    if (cells.length < 3) continue

    const name = cells[0].trim()
    const marketRaw = cells[1].trim()
    const code = cells[2].trim()

    // 6자리 숫자 종목코드만 처리 (우선주 등 특수코드 제외)
    if (!/^\d{6}$/.test(code)) continue
    if (!name) continue

    const market = marketRaw === '유가' ? 'KOSPI' : 'KOSDAQ'
    const suffix = market === 'KOSPI' ? '.KS' : '.KQ'
    const yahooTicker = `${code}${suffix}`

    entries.push({ code, name, market, yahooTicker })
  }

  return entries
}

/**
 * KRX 종목 리스트를 DB에 동기화한다.
 * - 신규 종목: 추가
 * - 기존 종목: 이름/시장 업데이트
 * - 상폐 종목: 삭제
 */
export async function syncKrxStocks(): Promise<{ total: number; added: number; updated: number; removed: number }> {
  const entries = await fetchKrxStockList()

  if (entries.length === 0) {
    throw new Error('KRX 종목 리스트가 비어 있습니다. 파싱 오류일 수 있습니다.')
  }

  const result = { total: entries.length, added: 0, updated: 0, removed: 0 }

  // 기존 데이터 조회
  const existing = await prisma.krxStock.findMany({
    select: { id: true, code: true, name: true, market: true },
  })
  const existingMap = new Map(existing.map((e) => [e.code, e]))
  const newCodes = new Set(entries.map((e) => e.code))

  // 상폐 종목 삭제
  const toDelete = existing.filter((e) => !newCodes.has(e.code))
  if (toDelete.length > 0) {
    await prisma.krxStock.deleteMany({
      where: { id: { in: toDelete.map((e) => e.id) } },
    })
    result.removed = toDelete.length
  }

  // upsert (batch)
  for (const entry of entries) {
    const ex = existingMap.get(entry.code)
    if (!ex) {
      result.added++
    } else if (ex.name !== entry.name || ex.market !== entry.market) {
      result.updated++
    }
  }

  // Prisma batch upsert
  const BATCH_SIZE = 100
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    await prisma.$transaction(
      batch.map((entry) =>
        prisma.krxStock.upsert({
          where: { code: entry.code },
          create: entry,
          update: {
            name: entry.name,
            market: entry.market,
            yahooTicker: entry.yahooTicker,
          },
        })
      )
    )
  }

  return result
}

/**
 * 한글 종목명으로 KrxStock을 검색한다.
 * - 정확 일치 우선, 부분 일치 fallback
 */
export async function searchKrxByName(
  query: string
): Promise<{ ticker: string; name: string; market: string }[]> {
  // 정확 일치
  const exact = await prisma.krxStock.findMany({
    where: { name: { equals: query, mode: 'insensitive' } },
    select: { yahooTicker: true, name: true, market: true },
    take: 5,
  })

  if (exact.length > 0) {
    return exact.map((e) => ({ ticker: e.yahooTicker, name: e.name, market: e.market }))
  }

  // 부분 일치
  const partial = await prisma.krxStock.findMany({
    where: { name: { contains: query, mode: 'insensitive' } },
    select: { yahooTicker: true, name: true, market: true },
    orderBy: { name: 'asc' },
    take: 10,
  })

  return partial.map((e) => ({ ticker: e.yahooTicker, name: e.name, market: e.market }))
}
