import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '@/server/db/client';
import { createAuthService } from '@/server/auth/staff';
import { createCustomerService } from '@/server/auth/customer';
import { createWorkspace } from '@/server/auth/onboarding';
import { applicationOrigin, trustedOrigin } from '@/server/auth/origin';
import { assertActor } from '@/server/auth/permissions';
import { createLoyaltyService } from '@/server/loyalty/service';
import { OperationRejectedError } from '@/server/loyalty/errors';
import { createProgrammeService } from '@/server/loyalty/programme';
import { createReportingService } from '@/server/reporting/metrics';
import { auditEvent } from '@/server/audit';
import { id } from '@/server/auth/crypto';
import { demoMode, hostedTestMode } from '@/server/environment';
import { testAccessResponse } from '@/server/test-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const text = z.string().trim().min(1).max(200);
const key = z.string().min(8).max(128);
const consent = z.object({ sms: z.boolean(), whatsapp: z.boolean() });
class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function session(response: NextResponse, name: string, value: string, days: number) {
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: days * 86400,
  });
  return response;
}
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const denied = testAccessResponse(request);
  if (denied) return denied;
  try {
    const route = (await context.params).path.join('/');
    const method = request.method;
    let body: unknown = {};
    if (method !== 'GET') {
      const origin = request.headers.get('origin');
      if (!trustedOrigin(origin))
        throw new HttpError('This request must come from this application.', 403);
      const raw = await request.text();
      if (raw.length > 16000) throw new HttpError('This request is too large.', 413);
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new HttpError('Send a valid request.', 400);
      }
    }
    const db = await getDatabase();
    const auth = createAuthService(db);
    const isDemo = demoMode();
    const hostedTest = hostedTestMode();
    const customers = createCustomerService(db, { development: isDemo });
    const json = (data: unknown) =>
      NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    async function actor(owner = false) {
      let current;
      try {
        current = await auth.getStaffActor(request.cookies.get('nqta_staff')?.value || '');
      } catch {
        throw new HttpError('Please sign in to your workspace.', 401);
      }
      if (owner && current.role !== 'owner')
        throw new HttpError('This action requires owner access.', 403);
      return current;
    }
    async function customer() {
      try {
        return await customers.getCustomerIdentity(
          request.cookies.get('nqta_customer')?.value || '',
        );
      } catch {
        throw new HttpError('Verify your phone to recover your card.', 401);
      }
    }
    function range() {
      const days = Number(request.nextUrl.searchParams.get('days') || 30);
      if (![7, 30, 90, 365].includes(days))
        throw new HttpError('Choose a supported date range.', 400);
      return {
        from: new Date(Date.now() - days * 86400000).toISOString(),
        to: new Date().toISOString(),
      };
    }
    if (route === 'auth/staff/sign-in' && method === 'POST') {
      const input = z
        .object({ email: z.email().max(200), password: z.string().min(1).max(200) })
        .parse(body);
      return session(
        json({ ok: true }),
        'nqta_staff',
        await auth.signInStaff(input.email, input.password),
        7,
      );
    }
    if (route === 'auth/demo' && method === 'POST') {
      if (!isDemo) throw new HttpError('Demo access is unavailable in production.', 404);
      return session(
        json({ ok: true }),
        'nqta_staff',
        await auth.signInStaff('owner@nqta.demo', 'NqtaDemo2026!'),
        7,
      );
    }
    if (route === 'auth/create-workspace' && method === 'POST') {
      const input = z
        .object({
          name: text.max(100),
          email: z.email().max(200),
          password: z.string().min(10).max(200),
          shopName: text.max(100),
          slug: z
            .string()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .min(3)
            .max(50),
          category: text.max(100),
        })
        .parse(body);
      const result = await createWorkspace(db, input);
      return session(json({ ok: true }), 'nqta_staff', result.token, 7);
    }
    if (route === 'auth/sign-out' && method === 'POST') {
      const which = z.object({ kind: z.enum(['staff', 'customer']) }).parse(body).kind;
      const name = `nqta_${which}`;
      const value = request.cookies.get(name)?.value;
      if (value) await auth.signOut(value);
      return session(json({ ok: true }), name, '', 0);
    }
    if (route === 'auth/customer/request' && method === 'POST')
      return json(await customers.requestVerification(z.object({ phone: text }).parse(body).phone));
    if (route === 'auth/customer/verify' && method === 'POST') {
      const input = z.object({ challengeId: text, code: z.string().regex(/^\d{6}$/) }).parse(body);
      const result = await customers.verifyCode(input.challengeId, input.code);
      return session(json({ ok: true }), 'nqta_customer', result.token, 30);
    }
    if (route === 'join' && method === 'POST') {
      const input = z
        .object({ programmeId: text, name: z.string().max(100), consents: consent })
        .parse(body);
      return json(
        await customers.joinProgramme(
          await customer(),
          input.programmeId,
          input.name,
          input.consents,
        ),
      );
    }
    if (route.startsWith('public/shop/') && method === 'GET') {
      const slug = route.slice('public/shop/'.length);
      const shop = (
        await db.query(
          'SELECT id,slug,name,category,description,location,theme,status FROM shops WHERE slug=$1',
          [slug],
        )
      ).rows[0];
      if (!shop) throw new HttpError('This shop could not be found.', 404);
      const programme =
        (
          await db.query(
            "SELECT id,threshold,reward_description,eligibility,terms FROM programmes WHERE shop_id=$1 AND status='published'",
            [shop.id],
          )
        ).rows[0] || null;
      return json({ shop, programme, isDemo, hostedTest });
    }
    if (route.startsWith('card/') && method === 'GET')
      return json(await customers.getCard(await customer(), route.slice(5)));
    if (route === 'challenge' && method === 'POST')
      return json(
        await customers.createRedemptionChallenge(
          await customer(),
          z.object({ rewardId: text }).parse(body).rewardId,
        ),
      );
    if (route === 'preferences' && method === 'PATCH') {
      const input = z.object({ membershipId: text, consents: consent }).parse(body);
      await customers.updatePreferences(await customer(), input.membershipId, input.consents);
      return json({ ok: true });
    }
    if (route === 'deletion' && method === 'POST') {
      await customers.requestDeletion(
        await customer(),
        z.object({ membershipId: text }).parse(body).membershipId,
      );
      return json({ ok: true });
    }
    if (route === 'workspace' && method === 'GET') {
      const current = await actor();
      const shop = (await db.query('SELECT * FROM shops WHERE id=$1', [current.shopId])).rows[0];
      const programme =
        (
          await db.query(
            "SELECT * FROM programmes WHERE shop_id=$1 ORDER BY CASE WHEN status='published' THEN 0 ELSE 1 END,created_at DESC LIMIT 1",
            [current.shopId],
          )
        ).rows[0] || null;
      return json({
        actor: current,
        shop,
        programme,
        isDemo: isDemo && current.shopId === 'shop-morrow',
        development: isDemo,
        hostedTest,
      });
    }
    const reporting = createReportingService(db);
    const loyalty = createLoyaltyService(db);
    const programmes = createProgrammeService(db);
    if (route === 'overview' && method === 'GET')
      return json(await reporting.getDashboard(await actor(), range()));
    if (route === 'customers' && method === 'GET')
      return json(
        await reporting.listMemberships(
          await actor(),
          request.nextUrl.searchParams.get('query') || '',
        ),
      );
    if (route === 'activity' && method === 'GET')
      return json(
        await reporting.listActivity(
          await actor(),
          request.nextUrl.searchParams.get('membership') || undefined,
        ),
      );
    if (route === 'membership' && method === 'GET') {
      const current = await actor();
      const code = request.nextUrl.searchParams.get('code');
      let membershipId = request.nextUrl.searchParams.get('id');
      if (code)
        membershipId = (
          await db.query<{ id: string }>(
            'SELECT id FROM memberships WHERE member_code=$1 AND shop_id=$2',
            [code.trim().toUpperCase(), current.shopId],
          )
        ).rows[0]?.id;
      if (!membershipId)
        throw new HttpError('No card found in this shop. Check the member code.', 404);
      return json(await loyalty.getMembership(current, membershipId));
    }
    if (route === 'purchases' && method === 'POST')
      return json(
        await loyalty.recordPurchase(
          await actor(),
          z
            .object({
              membershipId: text,
              idempotencyKey: key,
              qualifies: z.boolean(),
              amountMinor: z.number().int().nonnegative().max(100000000).nullable().optional(),
              receiptReference: z.string().max(100).optional(),
            })
            .parse(body),
        ),
      );
    if (route === 'rewards/redeem' && method === 'POST')
      return json(
        await loyalty.redeemReward(
          await actor(),
          z
            .object({
              rewardId: text,
              idempotencyKey: key,
              code: z.string().regex(/^\d{6}$/),
              challengeId: text.optional(),
            })
            .parse(body),
        ),
      );
    if (route === 'reversals' && method === 'POST')
      return json(
        await loyalty.reversePurchase(
          await actor(true),
          z
            .object({
              eventId: text,
              idempotencyKey: key,
              reason: z.string().trim().min(1).max(500),
            })
            .parse(body),
        ),
      );
    if (route === 'export' && method === 'GET')
      return new NextResponse(await reporting.exportActivity(await actor(true), range()), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="nqta-activity.csv"',
          'Cache-Control': 'no-store',
        },
      });
    if (route === 'programme/draft' && method === 'POST')
      return json(
        await programmes.saveProgrammeDraft(
          await actor(true),
          z
            .object({
              id: text.optional(),
              threshold: z.number().int().min(1).max(100),
              rewardDescription: text.max(250),
              eligibility: z.string().trim().min(1).max(1000),
              terms: z.string().trim().min(1).max(2000),
            })
            .parse(body),
        ),
      );
    if (route === 'programme/publish' && method === 'POST') {
      const input = z.object({ id: text, revision: z.number().int().positive() }).parse(body);
      await programmes.publishProgramme(await actor(true), input.id, input.revision);
      return json({ ok: true });
    }
    if (route === 'shop/pause' && method === 'POST') {
      await programmes.pauseShop(
        await actor(true),
        z.object({ paused: z.boolean() }).parse(body).paused,
      );
      return json({ ok: true });
    }
    if (route === 'shop' && method === 'PATCH') {
      const current = await actor(true);
      const input = z
        .object({
          name: text.max(100),
          category: text.max(100),
          description: z.string().max(500),
          location: text.max(200),
          theme: z.enum(['#175c46', '#263d38', '#a34e36', '#3d4870']),
        })
        .parse(body);
      await db.transaction(async (tx) => {
        await assertActor(tx, current, true, true);
        await tx.query(
          'UPDATE shops SET name=$1,category=$2,description=$3,location=$4,theme=$5 WHERE id=$6',
          [
            input.name,
            input.category,
            input.description,
            input.location,
            input.theme,
            current.shopId,
          ],
        );
        await auditEvent(tx, current.shopId, current.userId, 'shop.updated', current.shopId);
      });
      return json({ ok: true });
    }
    if (route === 'staff' && method === 'GET')
      return json(
        (
          await db.query(
            'SELECT id,name,email,role,active FROM staff WHERE shop_id=$1 ORDER BY created_at',
            [(await actor(true)).shopId],
          )
        ).rows,
      );
    if (route === 'staff/invite' && method === 'POST') {
      const result = await auth.inviteStaff(
        await actor(true),
        z
          .object({
            name: text.max(100),
            email: z.email().max(200),
            role: z.enum(['owner', 'cashier']),
          })
          .parse(body),
      );
      return json({ url: `${applicationOrigin()}/invite?token=${result.token}` });
    }
    if (route === 'staff/accept' && method === 'POST') {
      const input = z.object({ token: text, password: z.string().min(10).max(200) }).parse(body);
      await auth.acceptStaffInvite(input.token, input.password);
      return json({ ok: true });
    }
    if (route.startsWith('staff/') && method === 'DELETE') {
      await auth.revokeStaff(await actor(true), route.slice(6));
      return json({ ok: true });
    }
    if (route === 'support' && method === 'GET')
      return json(
        (
          await db.query(
            'SELECT r.*,c.name FROM support_requests r LEFT JOIN memberships m ON m.id=r.membership_id LEFT JOIN customers c ON c.id=m.customer_id WHERE r.shop_id=$1 ORDER BY r.created_at DESC LIMIT 100',
            [(await actor(true)).shopId],
          )
        ).rows,
      );
    if (route === 'support' && method === 'POST') {
      const current = await actor(true);
      const input = z
        .object({
          membershipId: text.optional(),
          kind: z.enum(['recovery', 'programme-transition']),
          message: z.string().trim().min(10).max(2000),
        })
        .parse(body);
      if (input.membershipId) await loyalty.getMembership(current, input.membershipId);
      const requestId = id();
      await db.transaction(async (tx) => {
        await assertActor(tx, current, true, true);
        if (input.membershipId) {
          const member = await tx.query('SELECT id FROM memberships WHERE id=$1 AND shop_id=$2', [
            input.membershipId,
            current.shopId,
          ]);
          if (!member.rows.length) throw new Error('Membership not found or access denied.');
        }
        await tx.query(
          'INSERT INTO support_requests(id,shop_id,membership_id,kind,message) VALUES($1,$2,$3,$4,$5)',
          [requestId, current.shopId, input.membershipId || null, input.kind, input.message],
        );
        await auditEvent(tx, current.shopId, current.userId, 'support.requested', requestId);
      });
      return json({ ok: true });
    }
    throw new HttpError('This action could not be found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Check the form fields.', operationRejected: true },
        { status: 400 },
      );
    if (error instanceof HttpError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && !('code' in error))
      return NextResponse.json(
        { error: error.message, operationRejected: error instanceof OperationRejectedError },
        { status: /owner access|access denied/i.test(error.message) ? 403 : 400 },
      );
    console.error(
      'Nqta request failed:',
      error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error',
    );
    return NextResponse.json(
      { error: 'We could not complete this action. Please try again.' },
      { status: 500 },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
