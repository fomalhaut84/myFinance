import { prisma } from '@/lib/prisma'

export type AccountName = '세진' | '소담' | '다솜'

/**
 * 계좌명 → Account ID 변환
 * '전체'인 경우 null 반환 (전 계좌 대상)
 */
export async function resolveAccountId(
  name: string
): Promise<string | null> {
  if (name === '전체') return null

  const account = await prisma.account.findFirst({
    where: { name },
    select: { id: true },
  })

  if (!account) {
    throw new Error(`계좌를 찾을 수 없습니다: ${name}`)
  }

  return account.id
}

/**
 * 전체 계좌 ID 목록 반환
 */
export async function getAllAccountIds(): Promise<
  { id: string; name: string }[]
> {
  return prisma.account.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * MCP 도구 응답용 텍스트 생성 헬퍼
 */
export function toolResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  }
}

/**
 * 에러를 MCP 도구 에러 응답으로 변환
 */
export function toolError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text' as const, text: `오류: ${message}` }],
    isError: true,
  }
}

/**
 * 금액을 읽기 좋은 형태로 포맷
 */
export function formatMoney(amount: number, currency: string): string {
  if (currency === 'USD') {
    return `$${amount.toFixed(2)}`
  }
  return `${Math.round(amount).toLocaleString('ko-KR')}원`
}
