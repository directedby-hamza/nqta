import { demoMode } from '../environment';
export async function deliverVerification(phone: string, code: string, development: boolean) {
  if (development && demoMode()) return;
  const {
    TWILIO_ACCOUNT_SID: sid,
    TWILIO_AUTH_TOKEN: secret,
    TWILIO_FROM_NUMBER: from,
    SMS_PROVIDER: provider,
  } = process.env;
  if (provider !== 'twilio' || !sid || !secret || !from)
    throw new Error('A real SMS provider must be configured for verification.');
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
        From: from,
        Body: `Your Nqta sign-in code is ${code}. It expires in 5 minutes. Do not share it.`,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error('Verification delivery failed. Please try again later.');
}
