export function hostedTestMode() {
  return process.env.HOSTED_TEST_MODE === 'true';
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
