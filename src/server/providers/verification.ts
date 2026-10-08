import { demoMode } from '../environment';
export class VerificationDeliveryError extends Error {
  readonly status = 503;
  constructor(message = 'We could not send a verification code. Please try again shortly.') {
    super(message);
  }
}
export async function deliverVerification(phone: string, code: string, development: boolean) {
  if (development && demoMode()) return;
  const {
    TWILIO_ACCOUNT_SID: sid,
    TWILIO_AUTH_TOKEN: secret,
    TWILIO_FROM_NUMBER: from,
    TWILIO_MESSAGING_SERVICE_SID: messagingService,
    SMS_PROVIDER: provider,
  } = process.env;
  if (provider !== 'twilio' || !sid || !secret || (!from && !messagingService))
    throw new VerificationDeliveryError(
      'SMS verification is not configured. Please contact this shop.',
    );
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: phone,
          ...(messagingService ? { MessagingServiceSid: messagingService } : { From: from! }),
          Body: `Your Nqta sign-in code is ${code}. It expires in 5 minutes. Do not share it.`,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new VerificationDeliveryError();
    const result = (await response.json()) as { sid?: string; status?: string };
    if (
      !result.sid ||
      !['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(result.status || '')
    )
      throw new VerificationDeliveryError();
  } catch {
    throw new VerificationDeliveryError();
  }
}
