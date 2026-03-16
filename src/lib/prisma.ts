import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? ''
  const separator = url.includes('?') ? '&' : '?'
  const poolParams = 'connection_limit=10&pool_timeout=5&connect_timeout=5'
  const datasourceUrl = url ? `${url}${separator}${poolParams}` : undefined

  return new PrismaClient({
    datasourceUrl,
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
