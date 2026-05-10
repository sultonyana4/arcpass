import { PrismaClient } from '@prisma/client'

export function validateDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL environment variable is not set. ' +
      'Expected format: postgresql://<user>:<password>@<host>:<port>/<database>?schema=public'
    )
  }

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error(
      'DATABASE_URL has an invalid scheme. ' +
      'Expected scheme: postgresql:// or postgres://'
    )
  }

  // Non-local host warning in non-production environments
  try {
    const urlObj = new URL(url)
    const host = urlObj.hostname
    if (process.env.NODE_ENV !== 'production' && host !== 'localhost' && host !== '127.0.0.1') {
      console.warn(
        `Warning: Non-local database host "${host}" detected in a non-production environment. ` +
        'Ensure this is intentional.'
      )
    }
  } catch {
    // If URL parsing fails, skip the host check — scheme is already validated
  }

  return url
}

function createPrismaClient(): PrismaClient {
  const url = validateDatabaseUrl()
  return new PrismaClient({
    datasources: {
      db: { url },
    },
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export async function validateConnection(): Promise<void> {
  const url = validateDatabaseUrl()

  let host = 'unknown'
  let port = 'unknown'
  try {
    const parsed = new URL(url)
    host = parsed.hostname
    port = parsed.port || '5432'
  } catch {
    // URL parsing failed — proceed with 'unknown' host/port
  }

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Connection to ${host}:${port} timed out after 5000ms`)),
      5000
    )
  )

  try {
    await Promise.race([prisma.$connect(), timeout])
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to connect to database at ${host}:${port} — ${message}`
    )
  }
}
