import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateCategoryInput, generateSlug } from '@/lib/category-utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const type = searchParams.get('type')

    const where: Record<string, unknown> = {}
    if (type === 'expense' || type === 'income') {
      where.type = type
    }

    const categories = await prisma.category.findMany({
      where,
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { transactions: true } },
      },
    })

    return NextResponse.json({ categories })
  } catch (error) {
    console.error('GET /api/categories error:', error)
    return NextResponse.json(
      { error: '카테고리를 불러올 수 없습니다.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
    }

    const errors = validateCategoryInput(body as Record<string, unknown>)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0].message, errors }, { status: 400 })
    }

    const { name, type, icon, keywords, sortOrder } = body as Record<string, unknown>
    const trimmedName = (name as string).trim()

    // slug 생성 및 중복 확인
    let slug = generateSlug(trimmedName)
    if (!slug) {
      slug = `cat-${Date.now()}`
    }

    const existingSlug = await prisma.category.findUnique({ where: { slug } })
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`
    }

    // 이름 중복 확인
    const existingName = await prisma.category.findUnique({ where: { name: trimmedName } })
    if (existingName) {
      return NextResponse.json({ error: '이미 존재하는 카테고리 이름입니다.' }, { status: 409 })
    }

    const cleanedKeywords = Array.isArray(keywords)
      ? (keywords as string[]).map((k) => k.trim()).filter(Boolean)
      : []

    const category = await prisma.category.create({
      data: {
        slug,
        name: trimmedName,
        type: type as string,
        icon: typeof icon === 'string' ? (icon.trim() || null) : null,
        keywords: cleanedKeywords,
        sortOrder: typeof sortOrder === 'number' ? Math.round(sortOrder) : 0,
      },
    })

    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    console.error('POST /api/categories error:', error)
    return NextResponse.json(
      { error: '카테고리 생성에 실패했습니다.' },
      { status: 500 }
    )
  }
}
