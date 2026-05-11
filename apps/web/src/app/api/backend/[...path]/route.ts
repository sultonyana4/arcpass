import { NextRequest, NextResponse } from 'next/server'

/**
 * Catch-all proxy route: /api/backend/* → Fastify API service.
 *
 * This replaces Next.js rewrites (which are unreliable in standalone Docker builds)
 * with an explicit server-side proxy. All browser API calls hit this route on the
 * same origin, then get forwarded to the internal backend service.
 *
 * In Docker: API_URL_INTERNAL=http://api:4000
 * In local dev: defaults to http://localhost:4000
 */

function getBackendUrl(): string {
  return process.env.API_URL_INTERNAL || 'http://localhost:4000'
}

async function proxyRequest(request: NextRequest, params: { path: string[] }) {
  const backendUrl = getBackendUrl()
  const path = params.path.join('/')
  const url = new URL(`/${path}`, backendUrl)

  // Forward query parameters
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  // Build headers to forward (skip hop-by-hop headers)
  const headers = new Headers()
  const skipHeaders = new Set([
    'host',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
  ])

  request.headers.forEach((value, key) => {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })

  // Forward the client IP for rate limiting
  const clientIp =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  headers.set('x-forwarded-for', clientIp)

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.text()
        : undefined,
    })

    // Forward response headers (skip hop-by-hop)
    const responseHeaders = new Headers()
    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        responseHeaders.set(key, value)
      }
    })

    const body = await response.arrayBuffer()
    return new NextResponse(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('[api/backend proxy] Failed to reach backend:', error)
    return NextResponse.json(
      { error: 'Backend service unavailable' },
      { status: 502 },
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await params)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await params)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await params)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await params)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await params)
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await params)
}
