import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertRuntimeConfiguration } from '../../src/server/environment';

beforeEach(() => {
  for (const [name, value] of Object.entries({
    NODE_ENV: 'production',
    HOSTED_TEST_MODE: 'false',
    DEMO_MODE: 'false',
    AUTH_MODE: 'recovery-key',
    DATABASE_URL: 'postgresql://unused:unused@db.example.org/live?sslmode=require',
    APP_URL: 'https://loyalty.example.org',
    SESSION_SECRET: 'a'.repeat(48),
    SMS_PROVIDER: '',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    EMAIL_PROVIDER: '',
    RESEND_API_KEY: '',
    EMAIL_FROM: '',
  }))
    vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

it('allows message-free production only with the explicit recovery-key mode', () => {
  expect(() => assertRuntimeConfiguration()).not.toThrow();
});
it.each([
  ['APP_URL', 'http://loyalty.example.org'],
  ['DATABASE_URL', 'postgresql://unused:unused@db.example.org/live?sslmode=disable'],
  ['SESSION_SECRET', 'short'],
  ['DEMO_MODE', 'true'],
])('retains production security requirements for %s in recovery-key mode', (name, value) => {
  vi.stubEnv(name, value);
  expect(() => assertRuntimeConfiguration()).toThrow();
});
it('keeps provider requirements when no authentication mode is selected', () => {
  vi.stubEnv('AUTH_MODE', '');
  expect(() => assertRuntimeConfiguration()).toThrow(/Twilio/);
});
it.each(['password', 'RECOVERY-KEY', 'demo', 'false'])(
  'rejects unknown mode %s even locally',
  (mode) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_MODE', mode);
    expect(() => assertRuntimeConfiguration()).toThrow(/AUTH_MODE/);
  },
);
