import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { assertHostedTestConfiguration, hostedTestMode } from './environment';

export function testAccessResponse(request: NextRequest): NextResponse | undefined {
  if (!hostedTestMode()) return;
  if (request.nextUrl.pathname === '/api/health' && ['GET', 'HEAD'].includes(request.method))
    return;
  try {
    assertHostedTestConfiguration();
  } catch {
    return new NextResponse('The hosted test environment is not configured yet.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  const authorization = request.headers.get('authorization') || '';
  if (authorization.length <= 4096 && /^Basic [A-Za-z0-9+/]+={0,2}$/i.test(authorization)) {
    const provided = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (timingSafeEqual(hash(provided), hash(`nqta:${process.env.TEST_ACCESS_PASSWORD}`))) return;
  }
  return new NextResponse('Enter the Nqta test-site credentials to continue.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Nqta hosted testing", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
