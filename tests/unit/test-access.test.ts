import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { testAccessResponse } from '../../src/server/test-access';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'true');
  vi.stubEnv('APP_URL', 'https://nqta-test.onrender.com');
  vi.stubEnv('DATABASE_URL', 'postgresql://test:unused@example.com/test');
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('TEST_ACCESS_PASSWORD', 'test-site-password-longer-than-16');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
function request(path = '/', credentials?: string, method = 'GET') {
  return new NextRequest(`https://nqta-test.onrender.com${path}`, {
    method,
    headers: credentials
      ? { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` }
      : {},
  });
}
it.each(['/', '/sign-in', '/join/morrow', '/api/auth/customer/request', '/_next/static/app.js'])(
  'protects hosted test route %s before page/data access',
  (path) => {
    const denied = testAccessResponse(request(path));
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get('www-authenticate')).toContain('Basic');
    expect(denied?.headers.get('cache-control')).toBe('no-store');
  },
);
it.each(['nqta:wrong-password', 'other:test-site-password-longer-than-16', 'nqta:'])(
  'refuses invalid site credentials %s',
  (credentials) => {
    expect(testAccessResponse(request('/api/workspace', credentials))?.status).toBe(401);
  },
);
it('accepts site credentials while leaving merchant/customer sessions to the existing API', () => {
  expect(
    testAccessResponse(request('/api/workspace', 'nqta:test-site-password-longer-than-16')),
  ).toBeUndefined();
});
it('permits only liveness GET/HEAD outside the site password', () => {
  expect(testAccessResponse(request('/api/health'))).toBeUndefined();
  expect(testAccessResponse(request('/api/health', undefined, 'HEAD'))).toBeUndefined();
  expect(testAccessResponse(request('/api/health', undefined, 'POST'))?.status).toBe(401);
  expect(testAccessResponse(request('/api/health/other'))?.status).toBe(401);
});
it.each([
  ['TEST_ACCESS_PASSWORD', 'short'],
  ['SESSION_SECRET', 'short'],
  ['DATABASE_URL', ''],
  ['APP_URL', 'http://nqta-test.onrender.com'],
  ['APP_URL', 'https://nqta-test.onrender.com/some-path'],
])('fails closed for invalid hosted configuration %s', (name, value) => {
  vi.stubEnv(name, value);
  expect(testAccessResponse(request('/', 'nqta:test-site-password-longer-than-16'))?.status).toBe(
    503,
  );
});
it('keeps normal production independent of the hosted-test password', () => {
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('DEMO_MODE', 'true');
  vi.stubEnv('TEST_ACCESS_PASSWORD', '');
  expect(testAccessResponse(request('/sign-in'))).toBeUndefined();
});
