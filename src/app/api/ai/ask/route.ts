import { NextRequest, NextResponse } from 'next/server'
import {
  askAdvisor,
  AdvisorTimeoutError,
  AdvisorError,
} from '@/lib/ai/claude-advisor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel 등 서버리스 환경 대비

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: '질문을 입력해주세요.' },
        { status: 400 }
      )
    }

    const result = await askAdvisor(prompt.trim())

    return NextResponse.json({
      response: result.response,
      model: result.model,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
    })
  } catch (error) {
    if (error instanceof AdvisorTimeoutError) {
      return NextResponse.json(
        { error: 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' },
        { status: 504 }
      )
    }

    if (error instanceof AdvisorError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.error('POST /api/ai/ask error:', error)
    return NextResponse.json(
      { error: 'AI 응답 처리에 실패했습니다.' },
      { status: 500 }
    )
  }
}
