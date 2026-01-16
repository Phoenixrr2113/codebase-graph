/**
 * Next.js Proxy - API Request Forwarding
 * 
 * Intercepts /api/* requests and rewrites them to the backend at localhost:3001.
 * This runs BEFORE filesystem routes are checked, ensuring proper proxy behavior.
 * 
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */

import { NextRequest, NextResponse } from 'next/server';

const API_BACKEND = process.env.API_URL || 'http://localhost:3001';

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  
  // Build backend URL
  const apiPath = url.pathname; // e.g., /api/graph/full
  const backendUrl = new URL(apiPath, API_BACKEND);
  
  // Preserve query parameters
  backendUrl.search = url.search;
  
  return NextResponse.rewrite(backendUrl);
}

export const config = {
  matcher: '/api/:path*',
};
