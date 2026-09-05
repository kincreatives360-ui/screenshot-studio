const globalForPrisma = globalThis as unknown as {
  prisma: any
}

function createDummyPrismaClient() {
  return new Proxy({}, {
    get() {
      return () => Promise.resolve(null)
    }
  })
}

export const prisma = globalForPrisma.prisma ?? createDummyPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma


