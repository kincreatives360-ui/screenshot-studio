import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: any
}

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    // Return a dummy proxy if no database URL is defined
    return new Proxy({}, {
      get() {
        return () => Promise.resolve(null)
      }
    })
  }

  try {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  } catch (error) {
    console.warn('Prisma initialization skipped:', error)
    return new Proxy({}, {
      get() {
        return () => Promise.resolve(null)
      }
    })
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

