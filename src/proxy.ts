import { NextResponse, type NextRequest } from 'next/server';
import { testAccessResponse } from './server/test-access';

export function proxy(request: NextRequest) {
  const denied = testAccessResponse(request);
  if (denied) return denied;
  const response = NextResponse.next();
  if (process.env.HOSTED_TEST_MODE === 'true') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
}
