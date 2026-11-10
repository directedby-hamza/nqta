import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '@/server/db/client';
import {
  createPlatformAuth,
  PlatformAuthError,
  requirePlatformAdmin,
} from '@/server/platform/auth';
import { createPlatformBilling } from '@/server/platform/billing';
import { trustedOrigin } from '@/server/auth/origin';
import { reserveLimit, RateLimitError } from '@/server/auth/rate-limit';
import { testAccessResponse } from '@/server/test-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
function session(response: NextResponse, value: string) {
  response.cookies.set('nqta_admin', value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: value ? 43200 : 0,
  });
  return response;
}
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const denied = testAccessResponse(request);
  if (denied) return denied;
  try {
    const segments = (await context.params).path;
    const route = segments.join('/');
    let body: unknown = {};
    if (request.method !== 'GET') {
      if (!trustedOrigin(request.headers.get('origin')))
        return json({ error: 'This request must come from this application.' }, 403);
      const raw = await request.text();
      if (raw.length > 8000) return json({ error: 'This request is too large.' }, 413);
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return json({ error: 'Send a valid request.' }, 400);
      }
    }
    const db = await getDatabase();
    const auth = createPlatformAuth(db);
    const value = request.cookies.get('nqta_admin')?.value || '';
    if (route === 'auth/sign-in' && request.method === 'POST') {
      const input = z
        .object({ email: z.email().max(200), password: z.string().min(1).max(200) })
        .parse(body);
      await reserveLimit(db, {
        scope: 'platform-sign-in-global',
        key: 'all',
        limit: 100,
        windowSeconds: 900,
      });
      const signed = await auth.signIn(input.email, input.password);
      return session(json(await auth.getIdentity(signed)), signed);
    }
    if (route === 'auth/sign-out' && request.method === 'POST') {
      await auth.signOut(value);
      return session(json({ ok: true }), '');
    }
    const admin = await auth.getIdentity(value);
    if (route === 'me' && request.method === 'GET') return json(admin);
    if (route === 'auth/password' && request.method === 'POST') {
      const input = z
        .object({
          currentPassword: z.string().min(1).max(200),
          password: z.string().min(14).max(200),
        })
        .parse(body);
      return session(
        json({ ok: true }),
        await auth.changePassword(value, input.currentPassword, input.password),
      );
    }
    await requirePlatformAdmin(db, admin.id);
    if (request.method !== 'GET')
      await reserveLimit(db, {
        scope: 'platform-write',
        key: admin.id,
        limit: 200,
        windowSeconds: 3600,
      });
    const billing = createPlatformBilling(db);
    if (route === 'shops' && request.method === 'GET')
      return json(
        await billing.list(admin.id, {
          query: request.nextUrl.searchParams.get('query') || '',
          status: request.nextUrl.searchParams.get('status') || 'all',
          page: Number(request.nextUrl.searchParams.get('page') || 1),
        }),
      );
    if (segments[0] === 'shops' && segments[1]) {
      const shopId = z.string().min(1).max(200).parse(segments[1]);
      if (segments.length === 2 && request.method === 'GET')
        return json(await billing.detail(admin.id, shopId));
      if (segments.length === 3 && segments[2] === 'access' && request.method === 'PATCH') {
        const { accessInput } = await import('@/server/platform/billing');
        return json(await billing.setAccess(admin.id, shopId, accessInput.parse(body)));
      }
      if (segments.length === 3 && segments[2] === 'payments' && request.method === 'POST') {
        const { paymentInput } = await import('@/server/platform/billing');
        return json(await billing.recordPayment(admin.id, shopId, paymentInput.parse(body)));
      }
      if (
        segments.length === 5 &&
        segments[2] === 'payments' &&
        segments[4] === 'void' &&
        request.method === 'POST'
      ) {
        const input = z.object({ reason: z.string().trim().min(3).max(500) }).parse(body);
        await billing.voidPayment(admin.id, shopId, segments[3], input.reason);
        return json({ ok: true });
      }
    }
    return json({ error: 'This administration action was not found.' }, 404);
  } catch (error) {
    if (error instanceof PlatformAuthError) return json({ error: error.message }, error.status);
    if (error instanceof RateLimitError) {
      const response = json({ error: error.message }, 429);
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
      return response;
    }
    if (error instanceof z.ZodError)
      return json({ error: error.issues[0]?.message || 'Check the form fields.' }, 400);
    if (error instanceof Error && !('code' in error)) return json({ error: error.message }, 400);
    return json({ error: 'Administration is temporarily unavailable. Please try again.' }, 503);
  }
}
export { handle as GET, handle as POST, handle as PATCH };
