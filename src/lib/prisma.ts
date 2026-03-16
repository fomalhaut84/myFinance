import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient(): PrismaClient {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) return new PrismaClient()

  try {
    const url = new URL(rawUrl)
    url.searchParams.set('connection_limit', '10')
    url.searchParams.set('pool_timeout', '5')
    url.searchParams.set('connect_timeout', '5')
    return new PrismaClient({ datasourceUrl: url.toString() })
  } catch {
    // URL 파싱 실패 시 원본 그대로 사용
    return new PrismaClient()
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
