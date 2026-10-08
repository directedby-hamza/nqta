import { applicationOrigin } from '../auth/origin';
import { demoMode } from '../environment';

export class DeliveryError extends Error {
  readonly status = 503;

  constructor() {
    super('Email delivery is unavailable. Please try again later.');
    this.name = 'DeliveryError';
  }
}

export async function deliverStaffEmail(
  email: string,
  url: string,
  kind: 'verify' | 'reset',
): Promise<void> {
  try {
    if (demoMode()) return;

    const { EMAIL_PROVIDER: provider, RESEND_API_KEY: key, EMAIL_FROM: from } = process.env;
    const sender = from?.trim();
    if (
      provider !== 'resend' ||
      !key ||
      !/^\S+$/.test(key) ||
      !sender ||
      !/^(?:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+|[^<>\r\n]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>)$/.test(
        sender,
      )
    )
      throw new DeliveryError();

    const canonical = new URL(process.env.APP_URL || '');
    if (
      !['http:', 'https:'].includes(canonical.protocol) ||
      (process.env.NODE_ENV === 'production' && canonical.protocol !== 'https:') ||
      canonical.username ||
      canonical.password ||
      canonical.pathname !== '/' ||
      canonical.search ||
      canonical.hash
    )
      throw new DeliveryError();

    const link = new URL(url);
    if (
      link.origin !== applicationOrigin() ||
      link.username ||
      link.password ||
      link.pathname !== (kind === 'verify' ? '/verify-email' : '/reset-password') ||
      !link.searchParams.get('token')?.trim() ||
      link.hash
    )
      throw new DeliveryError();

    const action = kind === 'verify' ? 'Verify your Nqta email' : 'Reset your Nqta password';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [email],
        subject: action,
        text: `${action} by opening this link:\n${url}\n\nIf you did not request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new DeliveryError();
    const accepted: unknown = await response.json();
    if (
      !accepted ||
      typeof accepted !== 'object' ||
      !('id' in accepted) ||
      typeof accepted.id !== 'string' ||
      !accepted.id.trim()
    )
      throw new DeliveryError();
  } catch {
    throw new DeliveryError();
  }
}
