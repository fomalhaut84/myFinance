import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  validateIncomeProfileInput,
  calcTaxableFromGross,
} from '@/lib/tax/income-profile-utils'

/** PUT /api/income-profiles/[id] — 수정 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { id } = params
    const body = await request.json()

    const existing = await prisma.incomeProfile.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 })
    }

    const errors = validateIncomeProfileInput(body)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0].message, errors }, { status: 400 })
    }

    const { year, inputType, prepaidTax, note } = body

    // 연도 변경 시 중복 확인
    if (year !== existing.year) {
      const duplicate = await prisma.incomeProfile.findUnique({ where: { year } })
      if (duplicate) {
        return NextResponse.json(
          { error: `${year}년 프로필이 이미 존재합니다.` },
          { status: 409 },
        )
      }
    }

    let grossSalary: number | null = null
    let earnedDeduction: number | null = null
    let taxableIncome: number

    if (inputType === 'gross') {
      grossSalary = body.grossSalary
      const calc = calcTaxableFromGross(grossSalary!)
      earnedDeduction = calc.earnedDeduction
      taxableIncome = calc.taxableIncome
    } else {
      taxableIncome = body.taxableIncome
    }

    const profile = await prisma.incomeProfile.update({
      where: { id },
      data: {
        year,
        inputType,
        grossSalary,
        earnedDeduction,
        taxableIncome,
        prepaidTax: prepaidTax ?? 0,
        note: note ?? null,
      },
    })

    return NextResponse.json(profile)
  } catch (error) {
    console.error('PUT /api/income-profiles error:', error)
    return NextResponse.json(
      { error: '근로소득 프로필 수정에 실패했습니다.' },
      { status: 500 },
    )
  }
}

/** DELETE /api/income-profiles/[id] — 삭제 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { id } = params

    const existing = await prisma.incomeProfile.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 })
    }

    await prisma.incomeProfile.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/income-profiles error:', error)
    return NextResponse.json(
      { error: '근로소득 프로필 삭제에 실패했습니다.' },
      { status: 500 },
    )
  }
}
