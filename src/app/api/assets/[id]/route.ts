import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    const existing = await prisma.asset.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '자산을 찾을 수 없습니다.' }, { status: 404 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
    }

    const { name, value, note, interestRate, maturityDate } = body as Record<string, unknown>

    const data: Record<string, unknown> = {}
    if (typeof name === 'string' && name.trim()) data.name = name.trim()
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: '유효한 금액을 입력해주세요.' }, { status: 400 })
      }
      data.value = Math.round(value)
    }
    if (note !== undefined) data.note = typeof note === 'string' ? note.trim() || null : null
    if (typeof interestRate === 'number') {
      if (!Number.isFinite(interestRate)) {
        return NextResponse.json({ error: '유효한 이율을 입력해주세요.' }, { status: 400 })
      }
      data.interestRate = interestRate
    }
    if (typeof maturityDate === 'string') {
      const d = new Date(maturityDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: '유효한 만기일을 입력해주세요.' }, { status: 400 })
      }
      data.maturityDate = d
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 })
    }

    const updated = await prisma.asset.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('PUT /api/assets/[id] error:', error)
    return NextResponse.json({ error: '자산 수정에 실패했습니다.' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    const existing = await prisma.asset.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '자산을 찾을 수 없습니다.' }, { status: 404 })
    }

    await prisma.asset.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/assets/[id] error:', error)
    return NextResponse.json({ error: '자산 삭제에 실패했습니다.' }, { status: 500 })
  }
}
