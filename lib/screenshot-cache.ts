import { createHash } from 'crypto'

export function normalizeUrl(urlString: string): string {
  try {
    const url = new URL(urlString)

    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')

    if (url.port === '80' && url.protocol === 'http:') {
      url.port = ''
    }
    if (url.port === '443' && url.protocol === 'https:') {
      url.port = ''
    }

    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }

    url.hash = ''

    if (url.search) {
      const params = new URLSearchParams(url.search)
      const sortedParams = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
      url.search = sortedParams.length > 0
        ? '?' + new URLSearchParams(sortedParams).toString()
        : ''
    }

    return url.toString()
  } catch {
    return urlString
  }
}

export function hashUrl(url: string): string {
  const normalized = normalizeUrl(url)
  return createHash('sha256').update(normalized).digest('hex')
}

// In-memory cache for offline/API-free operations
const inMemoryCache = new Map<string, { screenshot: string; timestamp: number }>()

export async function getCachedScreenshot(
  url: string,
  maxAgeMs: number = 2 * 24 * 60 * 60 * 1000
): Promise<string | null> {
  const hash = hashUrl(url)
  const cached = inMemoryCache.get(hash)

  if (!cached) return null

  if (Date.now() - cached.timestamp > maxAgeMs) {
    inMemoryCache.delete(hash)
    return null
  }

  return cached.screenshot
}

export async function cacheScreenshot(url: string, screenshotBase64: string): Promise<void> {
  const hash = hashUrl(url)
  inMemoryCache.set(hash, {
    screenshot: screenshotBase64,
    timestamp: Date.now(),
  })
}

export async function invalidateCache(url: string): Promise<void> {
  const hash = hashUrl(url)
  inMemoryCache.delete(hash)
}

export async function invalidateCacheBatch(urls: string[]): Promise<void> {
  for (const url of urls) {
    await invalidateCache(url)
  }
}

export async function clearOldCache(maxAgeMs: number = 2 * 24 * 60 * 60 * 1000): Promise<void> {
  const now = Date.now()
  for (const [key, value] of inMemoryCache.entries()) {
    if (now - value.timestamp > maxAgeMs) {
      inMemoryCache.delete(key)
    }
  }
}

