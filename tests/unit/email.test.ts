import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeliveryError, deliverStaffEmail } from '../../src/server/providers/email';

const verifyUrl = 'https://nqta.example/verify-email?token=private-verification-token';
const resetUrl = 'https://nqta.example/reset-password?token=private-reset-token';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('HOSTED_TEST_MODE', 'false');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('APP_URL', 'https://nqta.example');
  vi.stubEnv('EMAIL_PROVIDER', 'resend');
  vi.stubEnv('RESEND_API_KEY', 'private-provider-key');
  vi.stubEnv('EMAIL_FROM', 'Nqta <accounts@nqta.example>');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  ['verify', verifyUrl, /verify/i],
  ['reset', resetUrl, /reset/i],
] as const)(
  'delivers a %s identity link as plain text with a bounded provider request',
  async (kind, url, subject) => {
    let request: Request | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
      request = new Request(input, options);
      return new Response(JSON.stringify({ id: 'provider-message-id' }), { status: 200 });
    });
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await expect(deliverStaffEmail('owner@example.com', url, kind)).resolves.toBeUndefined();

    expect(request).toBeInstanceOf(Request);
    expect(request!.url).toBe('https://api.resend.com/emails');
    expect(request!.method).toBe('POST');
    expect(request!.headers.get('authorization')).toBe('Bearer private-provider-key');
    expect(request!.headers.get('content-type')).toBe('application/json');
    const body = await request!.json();
    expect(body.from).toBe('Nqta <accounts@nqta.example>');
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.subject).toMatch(subject);
    expect(body.text).toContain(url);
    expect(body.text).toMatch(/ignore/i);
    expect(body).not.toHaveProperty('html');
    expect(timeout).toHaveBeenCalledWith(10000);
    expect(request!.signal.aborted).toBe(false);
  },
);

it('bypasses email delivery in local demo mode without requiring provider configuration', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DEMO_MODE', 'true');
  vi.stubEnv('EMAIL_PROVIDER', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('EMAIL_FROM', '');
  vi.stubEnv('APP_URL', '');
  const fetch = vi.fn(() => {
    throw new Error('Demo mode must not deliver mail');
  });
  vi.stubGlobal('fetch', fetch);

  await expect(
    deliverStaffEmail('owner@example.com', verifyUrl, 'verify'),
  ).resolves.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('bypasses email delivery in explicitly configured hosted demo mode', async () => {
  vi.stubEnv('HOSTED_TEST_MODE', 'true');
  vi.stubEnv('DATABASE_URL', 'postgresql://test:unused@example.com/test');
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('TEST_ACCESS_PASSWORD', 'test-site-password-longer-than-16');
  vi.stubEnv('EMAIL_PROVIDER', '');
  const fetch = vi.fn(() => {
    throw new Error('Hosted demo mode must not deliver mail');
  });
  vi.stubGlobal('fetch', fetch);

  await expect(
    deliverStaffEmail('owner@example.com', verifyUrl, 'verify'),
  ).resolves.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ['EMAIL_PROVIDER', ''],
  ['EMAIL_PROVIDER', 'other-provider'],
  ['RESEND_API_KEY', ''],
  ['RESEND_API_KEY', '   '],
  ['RESEND_API_KEY', 'private-provider-key\nextra-header'],
  ['EMAIL_FROM', ''],
  ['EMAIL_FROM', 'invalid-sender'],
  ['EMAIL_FROM', 'Nqta <accounts@nqta.example>\nextra-header'],
  ['APP_URL', ''],
  ['APP_URL', 'invalid-origin'],
  ['APP_URL', 'http://nqta.example'],
  ['APP_URL', 'https://nqta.example/admin'],
  ['APP_URL', 'https://nqta.example?extra=1'],
  ['APP_URL', 'https://nqta.example/#section'],
  ['APP_URL', 'https://private-provider-key@nqta.example'],
])('fails safely before delivery for malformed configuration %s', async (name, value) => {
  vi.stubEnv(name, value);
  const fetch = vi.fn(() => {
    throw new Error('Invalid configuration must fail before delivery');
  });
  vi.stubGlobal('fetch', fetch);

  await expect(deliverStaffEmail('owner@example.com', verifyUrl, 'verify')).rejects.toMatchObject({
    status: 503,
    message: expect.stringMatching(/delivery.*try again/i),
  });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  'https://foreign.example/verify-email?token=private-verification-token',
  'http://nqta.example/verify-email?token=private-verification-token',
  'https://private-provider-key@nqta.example/verify-email?token=private-verification-token',
  'https://nqta.example/other?token=private-verification-token',
  resetUrl,
  'https://nqta.example/verify-email',
  'https://nqta.example/verify-email?token=',
  'https://nqta.example/verify-email?token=%20',
  'https://nqta.example/verify-email?token=private-verification-token#foreign-fragment',
  'invalid-url',
])('refuses an untrusted identity link %s before delivery', async (url) => {
  const fetch = vi.fn(() => {
    throw new Error('Untrusted links must fail before delivery');
  });
  vi.stubGlobal('fetch', fetch);

  await expect(deliverStaffEmail('owner@example.com', url, 'verify')).rejects.toBeInstanceOf(
    DeliveryError,
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('returns a safe retryable error for provider rejection without reading its response', async () => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('private-provider-key private-verification-token', { status: 429 }),
  );

  const error = await deliverStaffEmail('owner@example.com', verifyUrl, 'verify').catch(
    (cause) => cause,
  );
  expect(error).toBeInstanceOf(DeliveryError);
  expect(error.status).toBe(503);
  expect(error.message).toMatch(/delivery.*try again/i);
  expect(String(error)).not.toMatch(/private-provider-key|private-verification-token/);
});

it.each([
  ['missing message ID', '{}'],
  ['empty message ID', '{"id":""}'],
  ['blank message ID', '{"id":"   "}'],
  ['non-string message ID', '{"id":123}'],
  ['null response', 'null'],
  ['malformed JSON', 'private-provider-key private-verification-token'],
])('refuses a successful HTTP response with %s', async (_description, body) => {
  vi.stubGlobal('fetch', async () => new Response(body, { status: 200 }));

  const error = await deliverStaffEmail('owner@example.com', verifyUrl, 'verify').catch(
    (cause) => cause,
  );

  expect(error).toBeInstanceOf(DeliveryError);
  expect(error.status).toBe(503);
  expect(error.message).toMatch(/delivery.*try again/i);
  expect(String(error)).not.toMatch(/private-provider-key|private-verification-token/);
});

it('returns a safe retryable error for network failure without exposing its cause', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('private-provider-key private-reset-token network failed');
  });

  const error = await deliverStaffEmail('owner@example.com', resetUrl, 'reset').catch(
    (cause) => cause,
  );
  expect(error).toBeInstanceOf(DeliveryError);
  expect(error.status).toBe(503);
  expect(error.message).toMatch(/delivery.*try again/i);
  expect(String(error)).not.toMatch(/private-provider-key|private-reset-token|network failed/);
  expect(error.cause).toBeUndefined();
});

it('returns a safe retryable error when the bounded request times out', async () => {
  const abort = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
  vi.stubGlobal(
    'fetch',
    async (_input: RequestInfo | URL, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
          once: true,
        });
      }),
  );

  const pending = deliverStaffEmail('owner@example.com', verifyUrl, 'verify');
  abort.abort(new DOMException('private-provider-key private-verification-token', 'TimeoutError'));
  const error = await pending.catch((cause) => cause);

  expect(error).toBeInstanceOf(DeliveryError);
  expect(error.status).toBe(503);
  expect(error.message).toMatch(/delivery.*try again/i);
  expect(String(error)).not.toMatch(/private-provider-key|private-verification-token|TimeoutError/);
});
