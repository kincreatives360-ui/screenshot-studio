import { NextRequest, NextResponse } from 'next/server'
import { getCachedScreenshot, cacheScreenshot, normalizeUrl, invalidateCache } from '@/lib/screenshot-cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { apiError, methodNotAllowed } from '@/lib/api/errors'

export const maxDuration = 60

const MICROLINK_API_URL = process.env.SCREENSHOT_API_URL || 'https://api.microlink.io'
type DeviceType = 'desktop' | 'mobile'
type ColorScheme = 'light' | 'dark'

function generateMockScreenshot(url: string): string {
  const hostname = new URL(url).hostname
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#1e293b" />
      </linearGradient>
      <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#3b82f6" />
        <stop offset="100%" stop-color="#8b5cf6" />
      </linearGradient>
    </defs>
    <rect width="1200" height="800" fill="url(#bg)" />
    <rect x="100" y="80" width="1000" height="640" rx="16" fill="#1e293b" stroke="#334155" stroke-width="2" />
    <rect x="100" y="80" width="1000" height="50" rx="16" fill="#0f172a" />
    <circle cx="130" cy="105" r="7" fill="#ef4444" />
    <circle cx="150" cy="105" r="7" fill="#eab308" />
    <circle cx="170" cy="105" r="7" fill="#22c55e" />
    <rect x="200" y="93" width="600" height="24" rx="6" fill="#1e293b" />
    <text x="215" y="110" font-family="system-ui, sans-serif" font-size="13" fill="#94a3b8">${hostname}</text>
    <rect x="150" y="180" width="400" height="40" rx="8" fill="url(#card)" />
    <rect x="150" y="240" width="600" height="16" rx="4" fill="#334155" />
    <rect x="150" y="270" width="480" height="16" rx="4" fill="#334155" />
    <rect x="150" y="300" width="520" height="16" rx="4" fill="#334155" />
    <rect x="150" y="360" width="280" height="200" rx="12" fill="#0f172a" stroke="#334155" />
    <rect x="460" y="360" width="280" height="200" rx="12" fill="#0f172a" stroke="#334155" />
    <rect x="770" y="360" width="280" height="200" rx="12" fill="#0f172a" stroke="#334155" />
  </svg>`
  return Buffer.from(svg).toString('base64')
}

async function captureViaService(
  url: string,
  deviceType: DeviceType = 'desktop',
  colorScheme: ColorScheme = 'light'
): Promise<{ screenshot: string; strategy: string }> {
  try {
    const viewport = deviceType === 'mobile'
      ? { width: '375', height: '667', isMobile: 'true' }
      : { width: '1920', height: '1080', isMobile: 'false' }

    const params = new URLSearchParams({
      url,
      screenshot: 'true',
      meta: 'false',
      'viewport.width': viewport.width,
      'viewport.height': viewport.height,
      'viewport.isMobile': viewport.isMobile,
      colorScheme,
    })

    const metaResponse = await fetch(`${MICROLINK_API_URL}/?${params.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })

    const metaJson = await metaResponse.json()

    if (metaJson.status === 'success' && metaJson.data?.screenshot?.url) {
      const imageResponse = await fetch(metaJson.data.screenshot.url, {
        signal: AbortSignal.timeout(10000),
      })

      if (imageResponse.ok) {
        const arrayBuffer = await imageResponse.arrayBuffer()
        if (arrayBuffer.byteLength > 0) {
          return {
            screenshot: Buffer.from(arrayBuffer).toString('base64'),
            strategy: 'microlink',
          }
        }
      }
    }
  } catch (error) {
    console.warn('External screenshot API unavailable, using offline fallback:', error)
  }

  return {
    screenshot: generateMockScreenshot(url),
    strategy: 'mock-offline',
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const rateLimit = checkRateLimit(ip)
    
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
      return apiError(
        429,
        'rate_limited',
        'Rate limit exceeded. Please try again later.',
        `Wait ${retryAfter} seconds, then retry. This endpoint allows 20 requests per minute per IP address.`,
        { retryAfter },
        {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': '20',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': rateLimit.resetAt.toString(),
        }
      )
    }

    const body = await request.json()
    const { url, forceRefresh, deviceType = 'desktop', colorScheme = 'light' } = body

    if (!url || typeof url !== 'string') {
      return apiError(
        400,
        'invalid_request',
        'URL is required',
        'Send a JSON body with a "url" string, for example {"url": "https://example.com"}.'
      )
    }

    if (!['desktop', 'mobile'].includes(deviceType)) {
      return apiError(
        400,
        'unsupported_value',
        'deviceType must be either "desktop" or "mobile"',
        'Omit deviceType to use the default "desktop", or set it to "desktop" or "mobile".'
      )
    }

    if (!['light', 'dark'].includes(colorScheme)) {
      return apiError(
        400,
        'unsupported_value',
        'colorScheme must be either "light" or "dark"',
        'Omit colorScheme to use the default "light", or set it to "light" or "dark".'
      )
    }

    let validUrl: URL
    try {
      validUrl = new URL(url)
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        return apiError(
          400,
          'invalid_url',
          'URL must use http or https protocol',
          'Prefix the address with https://, for example https://example.com.'
        )
      }
    } catch {
      return apiError(
        400,
        'invalid_url',
        'Invalid URL format',
        'Send an absolute URL including the scheme, for example https://example.com.'
      )
    }

    const normalizedUrl = normalizeUrl(validUrl.toString())
    const cacheKey = `${normalizedUrl}:${deviceType}:${colorScheme}`

    if (forceRefresh) {
      try {
        await invalidateCache(normalizedUrl)
      } catch (invalidateError) {
        console.warn('Failed to invalidate cache:', invalidateError)
      }
    }

    if (!forceRefresh) {
      try {
        const cachedScreenshot = await getCachedScreenshot(cacheKey)
        if (cachedScreenshot) {
          return NextResponse.json({
            screenshot: cachedScreenshot,
            url: normalizedUrl,
            cached: true,
            deviceType,
            colorScheme,
          })
        }
      } catch (cacheError) {
        console.warn('Cache check failed:', cacheError)
      }
    }

    const { screenshot, strategy } = await captureViaService(normalizedUrl, deviceType, colorScheme)

    try {
      await cacheScreenshot(cacheKey, screenshot)
    } catch (cacheError) {
      console.warn('Failed to cache screenshot:', cacheError)
    }

    return NextResponse.json({
      screenshot,
      url: normalizedUrl,
      cached: false,
      strategy,
      deviceType,
      colorScheme,
    })
  } catch (error) {
    console.error('Screenshot error:', error)

    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        return apiError(
          408,
          'upstream_timeout',
          'Website took too long to load. Please try again or try a different URL.',
          'Retry the request, or capture a lighter page. The capture times out after 30 seconds.'
        )
      }

      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        return apiError(
          503,
          'upstream_unavailable',
          'Screenshot service is unavailable. Please try again later.',
          'This is a transient upstream failure. Retry with exponential backoff.'
        )
      }

      if (error.message.includes('net::ERR_NAME_NOT_RESOLVED') || 
          error.message.includes('net::ERR_CONNECTION_REFUSED') ||
          error.message.includes('net::ERR_CONNECTION_TIMED_OUT') ||
          error.message.includes('NS_ERROR_UNKNOWN_HOST')) {
        return apiError(
          400,
          'invalid_url',
          'Could not connect to the website. Please check the URL and try again.',
          'Verify the host resolves and is publicly reachable, then retry.'
        )
      }

      if (error.message.includes('SSL') || 
          error.message.includes('certificate') ||
          error.message.includes('ERR_CERT')) {
        return apiError(
          400,
          'invalid_url',
          'Website has SSL certificate issues. The screenshot may be incomplete.',
          'Use a host with a valid TLS certificate, or capture the http:// address instead.'
        )
      }
    }

    return apiError(
      500,
      'internal_error',
      'Failed to capture screenshot. Please try again or contact support if the issue persists.',
      'Retry the request. If it keeps failing, report it at https://github.com/opennookorg/screenshot-studio/issues'
    )
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
