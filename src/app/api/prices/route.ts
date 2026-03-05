import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const prices = await prisma.priceCache.findMany({
      orderBy: { ticker: 'asc' },
    })

    const lastUpdatedAt = prices.length > 0
      ? prices.reduce((latest, p) =>
          p.updatedAt > latest ? p.updatedAt : latest,
          prices[0].updatedAt
        )
      : null

    return NextResponse.json({ prices, lastUpdatedAt })
  } catch (error) {
    console.error('GET /api/prices error:', error)
    return NextResponse.json(
      { error: '주가 정보를 불러오지 못했습니다.' },
      { status: 500 }
    )
  }
}
