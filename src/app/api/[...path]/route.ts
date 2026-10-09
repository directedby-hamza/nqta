import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '@/server/db/client';
import { createAuthService } from '@/server/auth/staff';
import {
  createCustomerService,
  joinContactsSchema,
  joinProfileSchema,
} from '@/server/auth/customer';
import {
  createCustomerPasswordService,
  CustomerCredentialError,
  CustomerLoginUnavailableError,
} from '@/server/auth/customer-password';
import { createCustomerAccessService } from '@/server/auth/customer-access';
import { createStaffKeyRecoveryService } from '@/server/auth/staff-key-recovery';
import { createWorkspace } from '@/server/auth/onboarding';
import { applicationOrigin, trustedOrigin } from '@/server/auth/origin';
import { assertActor } from '@/server/auth/permissions';
import { createLoyaltyService } from '@/server/loyalty/service';
import { OperationRejectedError } from '@/server/loyalty/errors';
import { createProgrammeService } from '@/server/loyalty/programme';
import { createReportingService } from '@/server/reporting/metrics';
import { auditEvent } from '@/server/audit';
import { id } from '@/server/auth/crypto';
import { authMode, demoMode, hostedTestMode, recoveryKeyMode } from '@/server/environment';
import { testAccessResponse } from '@/server/test-access';
import { createStaffRecoveryService } from '@/server/auth/recovery';
import { reserveLimit, RateLimitError } from '@/server/auth/rate-limit';
import { DeliveryError } from '@/server/providers/email';
import { VerificationDeliveryError } from '@/server/providers/verification';
import { createPrivacyService } from '@/server/privacy/service';
import { walletOptions } from '@/server/wallet/options';
import { createWalletStore, enqueueShopWalletUpdates } from '@/server/wallet/store';
import { flushWalletUpdates } from '@/server/wallet/delivery';
import { googleWalletObjectId, googleWalletSaveUrl } from '@/server/wallet/google';
import { applePassTypeIdentifier, createAppleWalletPass } from '@/server/wallet/apple';
import { WalletUnavailableError } from '@/server/wallet/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const text = z.string().trim().min(1).max(200);
const key = z.string().min(8).max(128);
const consent = z.object({
  sms: z.boolean(),
  whatsapp: z.boolean(),
  email: z.boolean().optional(),
});
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
    if (route === 'public/config' && method === 'GET')
      return NextResponse.json(
        {
          isDemo: demoMode(),
          hostedTest: hostedTestMode(),
          authMode: authMode(),
          wallet: walletOptions(),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    const keyMode = recoveryKeyMode();
    const contactRoutes = [
      'auth/customer/request',
      'auth/customer/verify',
      'auth/staff/request-verification',
      'auth/staff/request-reset',
      'auth/staff/verify-email',
      'auth/staff/reset-password',
    ];
    const keyRoutes = [
      'auth/customer/register',
      'auth/customer/sign-in',
      'auth/customer/recover',
      'auth/customer/rotate-recovery-key',
      'auth/customer/account',
      'auth/customer/login-phone',
      'auth/staff/recover-key',
    ];
    if ((keyMode && contactRoutes.includes(route)) || (!keyMode && keyRoutes.includes(route)))
      throw new HttpError('This sign-in method is unavailable.', 404);
    const db = await getDatabase().catch(() => {
      throw new HttpError('The service is not ready. Please try again later.', 503);
    });
    const auth = createAuthService(db);
    const isDemo = demoMode();
    const hostedTest = hostedTestMode();
    const customers = createCustomerService(db, { development: isDemo });
    const passwordCustomers = createCustomerPasswordService(db);
    const recovery = createStaffRecoveryService(db);
    let scheduled = false;
    function scheduleWalletUpdates() {
      if (
        scheduled ||
        ![
          'card/',
          'membership',
          'purchases',
          'rewards/redeem',
          'reversals',
          'shop',
          'support/resolve',
          'wallet/',
        ].some((prefix) => route.startsWith(prefix))
      )
        return;
      const available = walletOptions();
      if (!available.google && !available.apple) return;
      scheduled = true;
      try {
        after(async () => {
          await flushWalletUpdates(db, { limit: 2 }).catch(() => {});
        });
      } catch {
        // A host without after support leaves the durable queue for the next
        // request/CLI. A committed purchase must still return its saved outcome.
      }
    }
    const json = (data: unknown) => {
      scheduleWalletUpdates();
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    };
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
        throw new HttpError('Sign in to recover your card.', 401);
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
    if ((route === 'wallet/google' || route === 'wallet/apple') && method === 'POST') {
      const provider = route === 'wallet/google' ? 'google' : 'apple';
      const customerId = await customer();
      if (!walletOptions()[provider]) throw new WalletUnavailableError();
      const { membershipId } = z.object({ membershipId: text }).parse(body);
      await reserveLimit(db, {
        scope: 'wallet-issuance-global',
        key: 'all',
        limit: 1000,
        windowSeconds: 900,
      });
      await reserveLimit(db, {
        scope: 'wallet-issuance-customer',
        key: customerId,
        limit: 30,
        windowSeconds: 3600,
      });
      const store = createWalletStore(db);
      const issued = await store.getOrCreatePass(
        customerId,
        membershipId,
        provider,
        provider === 'google' ? googleWalletObjectId(membershipId) : applePassTypeIdentifier(),
      );
      if (provider === 'apple')
        return json({ url: `/api/wallet/download/apple/${encodeURIComponent(membershipId)}` });
      try {
        await flushWalletUpdates(db, { passId: issued.pass.id });
        const synced = await store.getPassBySerial('google', issued.pass.id);
        if (!synced || synced.card.status !== 'active') throw new WalletUnavailableError();
        return json({ url: googleWalletSaveUrl(synced.pass) });
      } catch {
        throw new WalletUnavailableError();
      }
    }
    if (route.startsWith('wallet/download/apple/') && method === 'GET') {
      const customerId = await customer();
      if (!walletOptions().apple) throw new WalletUnavailableError();
      const membershipId = text.parse(route.slice('wallet/download/apple/'.length));
      await reserveLimit(db, {
        scope: 'wallet-apple-download',
        key: customerId,
        limit: 60,
        windowSeconds: 3600,
      });
      // Issuance is a browser-origin-checked POST. This GET only reads a pass
      // already issued to this customer; a cross-site navigation cannot create it.
      const card = await customers.getCard(customerId, membershipId);
      if (card.status !== 'active') throw new HttpError('This membership is inactive.', 409);
      const row = (
        await db.query<{ id: string }>(
          "SELECT p.id FROM wallet_passes p JOIN memberships m ON m.id=p.membership_id WHERE p.membership_id=$1 AND p.provider='apple' AND p.external_id=$2 AND m.customer_id=$3 AND m.status='active'",
          [membershipId, applePassTypeIdentifier(), customerId],
        )
      ).rows[0];
      if (!row)
        throw new HttpError('Add this card to Apple Wallet from your Nqta card first.', 404);
      const issued = await createWalletStore(db).getPassBySerial('apple', row.id);
      if (!issued || issued.card.status !== 'active')
        throw new HttpError('This membership is inactive.', 409);
      const binary = await createAppleWalletPass(issued.pass, issued.card);
      scheduleWalletUpdates();
      return new NextResponse(new Uint8Array(binary), {
        headers: {
          'Content-Type': 'application/vnd.apple.pkpass',
          'Content-Disposition': 'inline; filename="nqta-loyalty.pkpass"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (route === 'auth/staff/sign-in' && method === 'POST') {
      const input = z
        .object({ email: z.email().max(200), password: z.string().min(1).max(200) })
        .parse(body);
      await reserveLimit(db, {
        scope: 'staff-sign-in-global',
        key: 'all',
        limit: 1000,
        windowSeconds: 900,
      });
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
          location: z.string().trim().max(200).optional(),
        })
        .parse(body);
      await reserveLimit(db, {
        scope: 'workspace-creation-global',
        key: 'all',
        limit: 30,
        windowSeconds: 3600,
      });
      await reserveLimit(db, {
        scope: 'workspace-creation-email',
        key: input.email.toLowerCase(),
        limit: 3,
        windowSeconds: 900,
      });
      const result = await createWorkspace(db, input);
      return result.token
        ? session(
            json({ ok: true, ...(result.recoveryKey ? { recoveryKey: result.recoveryKey } : {}) }),
            'nqta_staff',
            result.token,
            7,
          )
        : json({ ok: true, ...result });
    }
    if (route === 'auth/staff/recover-key' && method === 'POST') {
      const input = z
        .object({
          email: z.email().max(200),
          recoveryKey: z.string().min(1).max(200),
          password: z.string().min(10).max(200),
        })
        .parse(body);
      const result = await createStaffKeyRecoveryService(db).resetPassword(
        input.email,
        input.recoveryKey,
        input.password,
      );
      return session(json({ ok: true, recoveryKey: result.recoveryKey }), 'nqta_staff', '', 0);
    }
    if (route === 'auth/staff/request-verification' && method === 'POST')
      return json(
        await recovery.requestVerification(
          z.object({ email: z.email().max(200) }).parse(body).email,
        ),
      );
    if (route === 'auth/staff/request-reset' && method === 'POST')
      return json(
        await recovery.requestPasswordReset(
          z.object({ email: z.email().max(200) }).parse(body).email,
        ),
      );
    if (route === 'auth/staff/verify-email' && method === 'POST') {
      const result = await recovery.verifyEmail(
        z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(body).token,
      );
      return session(json({ ok: true }), 'nqta_staff', result.token, 7);
    }
    if (route === 'auth/staff/reset-password' && method === 'POST') {
      const input = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string().min(10).max(200),
        })
        .parse(body);
      await recovery.resetPassword(input.token, input.password);
      return session(json({ ok: true }), 'nqta_staff', '', 0);
    }
    if (route === 'auth/sign-out' && method === 'POST') {
      const which = z.object({ kind: z.enum(['staff', 'customer']) }).parse(body).kind;
      const name = `nqta_${which}`;
      const value = request.cookies.get(name)?.value;
      if (value) await auth.signOut(value);
      return session(json({ ok: true }), name, '', 0);
    }
    if (route === 'auth/customer/account' && method === 'GET')
      return json(await passwordCustomers.getAccount(await customer()));
    if (route === 'auth/customer/login-phone' && method === 'POST') {
      const input = z.object({ phone: text, password: z.string().min(1).max(200) }).parse(body);
      await passwordCustomers.setLoginPhone(await customer(), input.phone, input.password);
      return json({ ok: true });
    }
    if (keyRoutes.includes(route) && route.startsWith('auth/customer/') && method === 'POST') {
      await reserveLimit(db, {
        scope: 'customer-key-auth-global',
        key: 'all',
        limit: 1000,
        windowSeconds: 900,
      });
      if (route === 'auth/customer/register') {
        const input = z
          .object({ password: z.string().min(10).max(200), phone: text.optional() })
          .parse(body);
        if (input.phone !== undefined) {
          const result = await passwordCustomers.register(input.password, input.phone);
          return session(json({ ok: true }), 'nqta_customer', result.token, 90);
        }
        // Keep already deployed clients compatible; the current signup always supplies phone.
        const result = await passwordCustomers.register(input.password);
        return session(
          json({ ok: true, accountId: result.accountId, recoveryKey: result.recoveryKey }),
          'nqta_customer',
          result.token,
          90,
        );
      }
      if (route === 'auth/customer/rotate-recovery-key') {
        const input = z
          .object({
            password: z.string().min(1).max(200),
            accountId: z.string().trim().min(1).max(100),
          })
          .parse(body);
        return json(
          await passwordCustomers.rotateRecoveryKey(
            await customer(),
            input.password,
            input.accountId,
          ),
        );
      }
      const input = z
        .object({
          accountId: z.string().trim().min(1).max(100).optional(),
          phone: text.optional(),
          password: z
            .string()
            .min(route === 'auth/customer/recover' ? 10 : 1)
            .max(200),
          recoveryKey: z.string().min(1).max(200).optional(),
        })
        .refine((input) => Boolean(input.accountId) !== Boolean(input.phone), {
          message: 'Enter your phone number or previous account ID.',
        })
        .parse(body);
      try {
        if (route === 'auth/customer/recover') {
          if (!input.accountId) throw new HttpError('Enter your previous account ID.', 400);
          if (!input.recoveryKey) throw new HttpError('Enter your saved recovery key.', 400);
          const result = await passwordCustomers.recover(
            input.accountId,
            input.recoveryKey,
            input.password,
          );
          return session(
            json({ ok: true, accountId: result.accountId, recoveryKey: result.recoveryKey }),
            'nqta_customer',
            result.token,
            90,
          );
        }
        const result = await passwordCustomers.signIn(
          input.phone || input.accountId!,
          input.password,
        );
        return session(json({ ok: true }), 'nqta_customer', result.token, 90);
      } catch (error) {
        if (error instanceof CustomerCredentialError)
          throw new HttpError('The account credentials are incorrect.', 401);
        throw error;
      }
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
        .object({
          programmeId: text,
          name: z.string().max(100).optional(),
          consents: consent,
          contacts: joinContactsSchema.optional(),
          profile: joinProfileSchema.optional(),
        })
        .parse(body);
      return json(
        await customers.joinProgramme(
          await customer(),
          input.programmeId,
          input.profile?.fullName ?? input.name ?? '',
          input.consents,
          input.profile
            ? { phone: input.profile.phone, email: input.profile.email }
            : input.contacts,
        ),
      );
    }
    if (route.startsWith('public/shop/') && method === 'GET') {
      const slug = route.slice('public/shop/'.length);
      const shop = (
        await db.query(
          'SELECT id,slug,name,category,description,location,theme,status,privacy_notice,privacy_contact FROM shops WHERE slug=$1',
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
    if (route.startsWith('customer/shop/') && method === 'GET') {
      const customerId = await customer();
      const found = await createCustomerAccessService(db).lookup(
        customerId,
        route.slice('customer/shop/'.length),
      );
      const account = keyMode
        ? await passwordCustomers.getAccount(customerId)
        : { loginPhone: null };
      return json({ ...found, ...account });
    }
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
    if (route === 'customers/newsletter-export' && method === 'GET')
      return new NextResponse(await reporting.exportNewsletter(await actor(true)), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="nqta-newsletter.csv"',
          'Cache-Control': 'no-store',
        },
      });
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
          privacyNotice: z.string().trim().max(5000).optional(),
          privacyContact: z.union([z.email().max(200), z.literal('')]).optional(),
        })
        .parse(body);
      await db.transaction(async (tx) => {
        await assertActor(tx, current, true, true);
        await tx.query(
          'UPDATE shops SET name=$1,category=$2,description=$3,location=$4,theme=$5,privacy_notice=COALESCE($7,privacy_notice),privacy_contact=COALESCE($8,privacy_contact) WHERE id=$6',
          [
            input.name,
            input.category,
            input.description,
            input.location,
            input.theme,
            current.shopId,
            input.privacyNotice ?? null,
            input.privacyContact ?? null,
          ],
        );
        await auditEvent(tx, current.shopId, current.userId, 'shop.updated', current.shopId);
        await enqueueShopWalletUpdates(tx, current.shopId);
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
      const result = await auth.acceptStaffInvite(input.token, input.password);
      return json({ ok: true, ...result });
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
    if (route === 'support/resolve' && method === 'POST') {
      const input = z
        .object({
          id: text,
          resolution: z.string().trim().min(10).max(2000),
          deletion: z.boolean(),
        })
        .parse(body);
      const current = await actor(true);
      const privacy = createPrivacyService(db);
      if (input.deletion) await privacy.fulfilDeletion(current, input.id, input.resolution);
      else await privacy.resolveRequest(current, input.id, input.resolution);
      return json({ ok: true });
    }
    throw new HttpError('This action could not be found.', 404);
  } catch (error) {
    if (error instanceof CustomerLoginUnavailableError)
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    if (error instanceof CustomerCredentialError)
      return NextResponse.json(
        { error: 'The account credentials are incorrect.' },
        {
          status: 401,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    if (error instanceof RateLimitError)
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { 'Retry-After': String(error.retryAfterSeconds), 'Cache-Control': 'no-store' },
        },
      );
    if (
      error instanceof DeliveryError ||
      error instanceof VerificationDeliveryError ||
      error instanceof WalletUnavailableError
    )
      return NextResponse.json(
        { error: error.message },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
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
