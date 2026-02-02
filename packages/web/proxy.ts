/**
 * Next.js Proxy - API Request Forwarding
 * 
 * Intercepts /api/* requests and forwards them to the backend at localhost:3001.
 * Uses direct fetch with no timeout to support long-running operations like parsing.
 * 
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */

import { NextRequest, NextResponse } from 'next/server';

const API_BACKEND = process.env.API_URL || 'http://localhost:3001';

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  
  // Build backend URL
  const apiPath = url.pathname; // e.g., /api/graph/full
  const backendUrl = new URL(apiPath, API_BACKEND);
  
  // Preserve query parameters
  backendUrl.search = url.search;
  
  try {
    // Use fetch directly with no timeout for long-running requests
    const body = request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : null;

    const response = await fetch(backendUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body,
      // No signal = no timeout
    });

    // Create response with same status and headers
    const responseHeaders = new Headers(response.headers);

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy request to backend' },
      { status: 502 }
    );
  }
}

export const config = {
  matcher: '/api/:path*',
};
