import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  validateIncomeProfileInput,
  calcTaxableFromGross,
} from '@/lib/tax/income-profile-utils'

export const dynamic = 'force-dynamic'

/** GET /api/income-profiles — 목록 조회 */
export async function GET() {
  try {
    const profiles = await prisma.incomeProfile.findMany({
      orderBy: { year: 'desc' },
    })
    return NextResponse.json(profiles)
  } catch (error) {
    console.error('GET /api/income-profiles error:', error)
    return NextResponse.json(
      { error: '근로소득 프로필 조회에 실패했습니다.' },
      { status: 500 },
    )
  }
}

/** POST /api/income-profiles — 생성 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const errors = validateIncomeProfileInput(body)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0].message, errors }, { status: 400 })
    }

    const { year, inputType, prepaidTax, note } = body

    // 중복 연도 확인
    const existing = await prisma.incomeProfile.findUnique({ where: { year } })
    if (existing) {
      return NextResponse.json(
        { error: `${year}년 프로필이 이미 존재합니다. 수정을 이용해주세요.` },
        { status: 409 },
      )
    }

    // 서버 측 파생값 계산
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

    const profile = await prisma.incomeProfile.create({
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

    return NextResponse.json(profile, { status: 201 })
  } catch (error) {
    console.error('POST /api/income-profiles error:', error)
    return NextResponse.json(
      { error: '근로소득 프로필 생성에 실패했습니다.' },
      { status: 500 },
    )
  }
}
