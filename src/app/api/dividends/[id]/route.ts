import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: { id: string }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const existing = await prisma.dividend.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: '배당 기록을 찾을 수 없습니다.' }, { status: 404 })
    }

    const body = await request.json()
    const { exDate, payDate, amountGross, amountNet, taxAmount, fxRate, amountKRW, reinvested } = body

    if (amountGross !== undefined && (typeof amountGross !== 'number' || !Number.isFinite(amountGross) || amountGross <= 0)) {
      return NextResponse.json({ error: '세전 금액은 0보다 커야 합니다.' }, { status: 400 })
    }
    if (amountNet !== undefined && (typeof amountNet !== 'number' || !Number.isFinite(amountNet) || amountNet < 0)) {
      return NextResponse.json({ error: '세후 금액은 0 이상이어야 합니다.' }, { status: 400 })
    }
    if (payDate !== undefined && (typeof payDate !== 'string' || isNaN(Date.parse(payDate)))) {
      return NextResponse.json({ error: '유효한 지급일을 입력해주세요.' }, { status: 400 })
    }

    const updated = await prisma.dividend.update({
      where: { id: params.id },
      data: {
        exDate: exDate !== undefined ? (exDate ? new Date(exDate) : null) : undefined,
        payDate: payDate ? new Date(payDate) : undefined,
        amountGross: amountGross ?? undefined,
        amountNet: amountNet ?? undefined,
        taxAmount: taxAmount !== undefined ? taxAmount : undefined,
        fxRate: fxRate !== undefined ? fxRate : undefined,
        amountKRW: amountKRW ?? undefined,
        reinvested: reinvested !== undefined ? reinvested : undefined,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('PUT /api/dividends/[id] error:', error)
    return NextResponse.json({ error: '배당 수정에 실패했습니다.' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const existing = await prisma.dividend.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: '배당 기록을 찾을 수 없습니다.' }, { status: 404 })
    }

    await prisma.dividend.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/dividends/[id] error:', error)
    return NextResponse.json({ error: '배당 삭제에 실패했습니다.' }, { status: 500 })
  }
}
