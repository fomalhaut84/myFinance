import { prisma } from '@/lib/prisma'
import { CATEGORY_TYPES, generateSlug } from '@/lib/category-utils'
import { toolResult, toolError } from '../utils'

const TYPE_LABELS: Record<string, string> = {
  expense: '소비',
  income: '수입',
  transfer: '이체',
}

/**
 * create_category: 카테고리 생성
 */
export async function createCategory(args: {
  name: string
  type: string
  icon?: string
  keywords?: string[]
}) {
  try {
    const name = args.name?.trim()
    if (!name) return toolError('카테고리 이름을 입력해주세요.')
    if (name.length > 50) return toolError('이름은 50자 이내로 입력해주세요.')
    if (!(CATEGORY_TYPES as readonly string[]).includes(args.type)) {
      return toolError(`유효한 유형: ${CATEGORY_TYPES.join(', ')}`)
    }

    const slug = generateSlug(name)
    if (!slug) return toolError('유효한 이름을 입력해주세요.')

    const category = await prisma.category.create({
      data: {
        slug,
        name,
        type: args.type,
        icon: args.icon?.trim() || null,
        keywords: args.keywords?.map((k) => k.trim()).filter(Boolean) ?? [],
      },
    })

    const typeLabel = TYPE_LABELS[category.type] ?? category.type
    return toolResult(
      `✅ 카테고리 생성: ${category.icon ? category.icon + ' ' : ''}${category.name} (${typeLabel})\n` +
      `- slug: ${category.slug}` +
      (category.keywords.length > 0 ? `\n- 키워드: ${category.keywords.join(', ')}` : '')
    )
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      return toolError('이미 존재하는 카테고리 이름입니다.')
    }
    return toolError(error)
  }
}

/**
 * update_category: 카테고리 부분 수정 (name으로 식별)
 */
export async function updateCategory(args: {
  name: string
  newName?: string
  type?: string
  icon?: string | null
  keywords?: string[]
}) {
  try {
    const name = args.name?.trim()
    if (!name) return toolError('대상 카테고리 이름이 필요합니다.')

    const existing = await prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      include: { _count: { select: { transactions: true, budgets: true } } },
    })
    if (!existing) return toolError(`카테고리를 찾을 수 없습니다: ${name}`)

    if (args.type !== undefined) {
      if (!(CATEGORY_TYPES as readonly string[]).includes(args.type)) {
        return toolError(`유효한 유형: ${CATEGORY_TYPES.join(', ')}`)
      }
      if (args.type !== existing.type && (existing._count.transactions > 0 || existing._count.budgets > 0)) {
        return toolError('거래 또는 예산이 연결된 카테고리의 유형은 변경할 수 없습니다.')
      }
    }

    const data: Record<string, unknown> = {}
    if (args.newName !== undefined) {
      const trimmed = args.newName.trim()
      if (!trimmed || trimmed.length > 50) return toolError('이름은 1~50자여야 합니다.')
      data.name = trimmed
    }
    if (args.type !== undefined) data.type = args.type
    if (args.icon !== undefined) data.icon = args.icon === null ? null : args.icon.trim() || null
    if (args.keywords !== undefined) data.keywords = args.keywords.map((k) => k.trim()).filter(Boolean)

    if (Object.keys(data).length === 0) return toolError('변경할 필드가 없습니다.')

    const updated = await prisma.category.update({
      where: { id: existing.id },
      data,
    })

    const typeLabel = TYPE_LABELS[updated.type] ?? updated.type
    return toolResult(
      `✅ 카테고리 수정: ${updated.icon ? updated.icon + ' ' : ''}${updated.name} (${typeLabel})`
    )
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      return toolError('이미 존재하는 카테고리 이름입니다.')
    }
    return toolError(error)
  }
}

/**
 * delete_category: 카테고리 삭제 (name으로 식별, 연결 데이터 있으면 거부)
 */
export async function deleteCategory(args: { name: string }) {
  try {
    const name = args.name?.trim()
    if (!name) return toolError('카테고리 이름이 필요합니다.')

    const existing = await prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      include: { _count: { select: { transactions: true, budgets: true } } },
    })
    if (!existing) return toolError(`카테고리를 찾을 수 없습니다: ${name}`)

    if (existing._count.transactions > 0) {
      return toolError(`${existing._count.transactions}건의 거래가 연결되어 삭제할 수 없습니다.`)
    }
    if (existing._count.budgets > 0) {
      return toolError(`${existing._count.budgets}건의 예산이 연결되어 삭제할 수 없습니다.`)
    }

    await prisma.category.delete({ where: { id: existing.id } })
    return toolResult(`🗑️ 카테고리 삭제: ${existing.icon ? existing.icon + ' ' : ''}${existing.name}`)
  } catch (error) {
    return toolError(error)
  }
}
