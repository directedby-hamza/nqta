export function hostedTestMode() {
  return process.env.HOSTED_TEST_MODE === 'true';
}

export function productionMode() {
  return process.env.NODE_ENV === 'production' && !hostedTestMode();
}

export class ConfigurationError extends Error {
  readonly status = 503;
}

export function authMode(): 'verified-contact' | 'recovery-key' {
  const mode = process.env.AUTH_MODE || 'verified-contact';
  if (mode !== 'verified-contact' && mode !== 'recovery-key')
    throw new ConfigurationError('AUTH_MODE must be verified-contact or recovery-key.');
  return mode;
}

export function recoveryKeyMode() {
  return authMode() === 'recovery-key';
}

export function assertRuntimeConfiguration() {
  const mode = authMode();
  if (process.env.HOSTED_TEST_MODE && !['true', 'false'].includes(process.env.HOSTED_TEST_MODE))
    throw new ConfigurationError('HOSTED_TEST_MODE must be true or false.');
  if (hostedTestMode()) return assertHostedTestConfiguration();
  if (!productionMode()) return;
  const requireValue = (condition: unknown, setting: string) => {
    if (!condition) throw new ConfigurationError(`Production requires ${setting}.`);
  };
  requireValue(process.env.DEMO_MODE === 'false', 'DEMO_MODE=false');
  let database: URL;
  let origin: URL;
  try {
    database = new URL(process.env.DATABASE_URL || '');
    origin = new URL(process.env.APP_URL || '');
  } catch {
    throw new ConfigurationError(
      'Production requires a PostgreSQL DATABASE_URL and HTTPS APP_URL.',
    );
  }
  requireValue(
    ['postgres:', 'postgresql:'].includes(database.protocol) &&
      database.hostname &&
      database.pathname.length > 1 &&
      database.searchParams.getAll('sslmode').length === 1 &&
      ['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode') || ''),
    'a PostgreSQL DATABASE_URL with TLS enabled',
  );
  requireValue(
    origin.protocol === 'https:' &&
      !origin.username &&
      !origin.password &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash,
    'an exact HTTPS APP_URL',
  );
  requireValue(
    (process.env.SESSION_SECRET || '').length >= 32,
    'a SESSION_SECRET of at least 32 characters',
  );
  if (mode === 'recovery-key') return;
  requireValue(
    process.env.SMS_PROVIDER === 'twilio' &&
      /^AC[a-f0-9]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID || '') &&
      (process.env.TWILIO_AUTH_TOKEN || '').length >= 16,
    'real Twilio credentials',
  );
  requireValue(
    /^MG[a-f0-9]{32}$/i.test(process.env.TWILIO_MESSAGING_SERVICE_SID || '') ||
      /^(?:\+[1-9]\d{7,14}|[A-Za-z][A-Za-z0-9 ]{0,10})$/.test(process.env.TWILIO_FROM_NUMBER || ''),
    'a Twilio Messaging Service or approved sender',
  );
  requireValue(
    /^[1-9]\d{0,4}$/.test(process.env.SMS_DAILY_LIMIT || ''),
    'a positive SMS_DAILY_LIMIT',
  );
  requireValue(
    /^[1-9]\d{0,2}(?:,[1-9]\d{0,2})*$/.test(process.env.SMS_ALLOWED_PREFIXES || ''),
    'SMS_ALLOWED_PREFIXES',
  );
  requireValue(
    process.env.EMAIL_PROVIDER === 'resend' && (process.env.RESEND_API_KEY || '').startsWith('re_'),
    'real Resend credentials',
  );
  const from = process.env.EMAIL_FROM || '';
  requireValue(
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from.match(/<([^>]+)>$/)?.[1] || from) &&
      !/@resend\.dev>?$/i.test(from),
    'an EMAIL_FROM on your verified sending domain',
  );
}

export function assertHostedTestConfiguration() {
  if (!hostedTestMode()) return;
  const database = process.env.DATABASE_URL || '';
  if (!/^postgres(?:ql)?:\/\//.test(database))
    throw new Error('Hosted testing requires a dedicated PostgreSQL DATABASE_URL.');
  let origin: URL;
  try {
    origin = new URL(process.env.APP_URL || '');
  } catch {
    throw new Error('Hosted testing requires an HTTPS APP_URL.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Hosted testing requires an HTTPS APP_URL containing only the site origin.');
  if ((process.env.SESSION_SECRET || '').length < 32)
    throw new Error('Hosted testing requires a SESSION_SECRET of at least 32 characters.');
  if ((process.env.TEST_ACCESS_PASSWORD || '').length < 16)
    throw new Error('Hosted testing requires a TEST_ACCESS_PASSWORD of at least 16 characters.');
}

export function demoMode() {
  if (hostedTestMode()) {
    assertHostedTestConfiguration();
    return true;
  }
  return process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false';
}
