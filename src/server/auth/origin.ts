export function applicationOrigin(canonical = process.env.APP_URL): string {
  return new URL(canonical || 'http://127.0.0.1:3000').origin;
}
export function trustedOrigin(origin: string | null, canonical = process.env.APP_URL): boolean {
  if (!origin) return false;
  try {
    return origin === applicationOrigin(canonical);
  } catch {
    return false;
  }
}
