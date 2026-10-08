import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as environment from '../../src/server/environment';

beforeEach(() => {
  for (const [name, value] of Object.entries({
    NODE_ENV: 'production',
    HOSTED_TEST_MODE: 'false',
    DEMO_MODE: 'false',
    DATABASE_URL: 'postgresql://unused:unused@db.example.org/live?sslmode=require',
    APP_URL: 'https://loyalty.example.org',
    SESSION_SECRET: 'a'.repeat(48),
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_AUTH_TOKEN: 'b'.repeat(32),
    TWILIO_FROM_NUMBER: '+15551234567',
    SMS_DAILY_LIMIT: '100',
    SMS_ALLOWED_PREFIXES: '212',
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_unit_test_private_key',
    EMAIL_FROM: 'Nqta <accounts@loyalty.example.org>',
  }))
    vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

it('accepts explicitly configured live PostgreSQL and real delivery without enabling demo', () => {
  expect(environment.assertRuntimeConfiguration()).toBeUndefined();
  expect(environment.productionMode()).toBe(true);
  expect(environment.demoMode()).toBe(false);
});
it.each([
  ['DATABASE_URL', ''],
  ['DATABASE_URL', '.data/nqta'],
  ['DATABASE_URL', 'postgresql://unused:unused@db.example.org/live?sslmode=disable'],
  [
    'DATABASE_URL',
    'postgresql://unused:unused@db.example.org/live?sslmode=require&sslmode=disable',
  ],
  [
    'DATABASE_URL',
    'postgresql://unused:unused@db.example.org/live?sslmode=require&sslmode=require',
  ],
  ['APP_URL', 'http://loyalty.example.org'],
  ['APP_URL', 'https://loyalty.example.org/join'],
  ['SESSION_SECRET', 'short'],
  ['DEMO_MODE', 'true'],
  ['SMS_PROVIDER', ''],
  ['TWILIO_AUTH_TOKEN', ''],
  ['SMS_DAILY_LIMIT', '0'],
  ['SMS_DAILY_LIMIT', 'invalid'],
  ['SMS_ALLOWED_PREFIXES', ''],
  ['EMAIL_PROVIDER', ''],
  ['RESEND_API_KEY', ''],
  ['EMAIL_FROM', 'onboarding@resend.dev'],
  ['HOSTED_TEST_MODE', 'TRUE'],
])('refuses unsafe live configuration %s before database access', (name, value) => {
  vi.stubEnv(name, value);
  expect(() => environment.assertRuntimeConfiguration()).toThrow();
});
it('preserves local PGlite development independently of live providers', () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('SMS_PROVIDER', '');
  expect(environment.assertRuntimeConfiguration()).toBeUndefined();
  expect(environment.productionMode()).toBe(false);
});
