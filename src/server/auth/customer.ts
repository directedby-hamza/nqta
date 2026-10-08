import type { Database } from '../db/client';
import type { MembershipCard } from '../loyalty/types';
import { randomBytes, randomInt } from 'node:crypto';
import { hashCode, hashToken, id, token } from './crypto';
import { readMembership } from '../loyalty/membership';
import { deliverVerification, VerificationDeliveryError } from '../providers/verification';
import { auditEvent } from '../audit';
import { demoMode, productionMode, recoveryKeyMode } from '../environment';
import { reserveLimit, RateLimitError } from './rate-limit';
import { assertMerchantPrivacy } from '../privacy/service';
import { lockCustomerIdentity } from './identity-lock';
export function normalisePhone(value: string) {
  const phone = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error('Use a phone number with its country code, for example +212600000001.');
  return phone;
}
export function createCustomerService(db: Database, options = { development: false }) {
  return {
    async requestVerification(
      value: string,
    ): Promise<{ challengeId: string; developmentCode?: string }> {
      const phone = normalisePhone(value);
      if (productionMode()) {
        const prefixes = (process.env.SMS_ALLOWED_PREFIXES || '').split(',').filter(Boolean);
        if (!prefixes.length)
          throw new VerificationDeliveryError(
            'SMS verification is not configured. Please contact this shop.',
          );
        if (!prefixes.some((prefix) => phone.startsWith(`+${prefix}`)))
          throw new Error('Phone verification is not available for this country.');
      }
      const reserved = await db.query(
        `INSERT INTO verification_limits(phone) VALUES($1) ON CONFLICT(phone) DO UPDATE SET
        requests=CASE WHEN verification_limits.window_started<=NOW()-interval '10 minutes' THEN 1 ELSE verification_limits.requests+1 END,
        window_started=CASE WHEN verification_limits.window_started<=NOW()-interval '10 minutes' THEN NOW() ELSE verification_limits.window_started END
        WHERE verification_limits.window_started<=NOW()-interval '10 minutes' OR verification_limits.requests<6 RETURNING phone`,
        [phone],
      );
      if (!reserved.rows.length) throw new RateLimitError(600);
      if (productionMode())
        await reserveLimit(db, {
          scope: 'sms-delivery-daily',
          key: 'all',
          limit: Number(process.env.SMS_DAILY_LIMIT),
          windowSeconds: 86400,
        });
      const challengeId = id();
      const code = randomInt(0, 1000000).toString().padStart(6, '0');
      const codeHash = hashCode(challengeId, code);
      await deliverVerification(phone, code, options.development);
      await db.transaction(async (tx) => {
        await lockCustomerIdentity(tx, phone);
        await tx.query(
          'UPDATE verification_challenges SET used=true WHERE phone=$1 AND used=false',
          [phone],
        );
        await tx.query(
          "INSERT INTO verification_challenges(id,phone,code_hash,expires_at) VALUES($1,$2,$3,NOW()+interval '5 minutes')",
          [challengeId, phone, codeHash],
        );
      });
      return {
        challengeId,
        ...(options.development && demoMode() ? { developmentCode: code } : {}),
      };
    },
    async verifyCode(
      challengeId: string,
      code: string,
    ): Promise<{ token: string; customerId: string }> {
      const result = await db.transaction(async (tx) => {
        const identity = (
          await tx.query<{ phone: string }>(
            'SELECT phone FROM verification_challenges WHERE id=$1',
            [challengeId],
          )
        ).rows[0];
        if (identity) await lockCustomerIdentity(tx, identity.phone);
        const { rows } = await tx.query<{
          id: string;
          phone: string;
          code_hash: string;
          attempts: number;
          used: boolean;
          expires_at: Date;
        }>('SELECT * FROM verification_challenges WHERE id=$1 FOR UPDATE', [challengeId]);
        const challenge = rows[0];
        if (!challenge || challenge.used || new Date(challenge.expires_at).getTime() <= Date.now())
          return { error: 'This verification code is expired or already used.' };
        if (challenge.attempts >= 5)
          return { error: 'Too many code attempts. Request a new verification code.' };
        if (!/^\d{6}$/.test(code) || challenge.code_hash !== hashCode(challengeId, code)) {
          await tx.query('UPDATE verification_challenges SET attempts=attempts+1 WHERE id=$1', [
            challengeId,
          ]);
          return { error: 'The verification code is incorrect.' };
        }
        const customer = await tx.query<{ id: string }>(
          'INSERT INTO customers(id,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING id',
          [id(), challenge.phone],
        );
        const customerId = customer.rows[0].id;
        const sessionToken = token();
        await tx.query('UPDATE verification_challenges SET used=true WHERE id=$1', [challengeId]);
        await tx.query(
          "INSERT INTO sessions(id,token_hash,principal_id,kind,expires_at) VALUES($1,$2,$3,'customer',NOW()+interval '30 days')",
          [id(), hashToken(sessionToken), customerId],
        );
        return { token: sessionToken, customerId };
      });
      if ('error' in result) throw new Error(result.error);
      return result;
    },
    async getCustomerIdentity(sessionToken: string): Promise<string> {
      const { rows } = await db.query<{ principal_id: string }>(
        "SELECT principal_id FROM sessions WHERE token_hash=$1 AND kind='customer' AND expires_at>NOW()",
        [hashToken(sessionToken)],
      );
      if (!rows[0])
        throw new Error(
          recoveryKeyMode()
            ? 'Please sign in to recover your card.'
            : 'Please verify your phone to recover your card.',
        );
      return rows[0].principal_id;
    },
    async joinProgramme(
      customerId: string,
      programmeId: string,
      name: string,
      consents: { sms: boolean; whatsapp: boolean },
    ): Promise<{ id: string }> {
      if (name.length > 100) throw new Error('Use a shorter display name.');
      return db.transaction(async (tx) => {
        const programme = await tx.query<{ shop_id: string; shop_status: string }>(
          "SELECT p.shop_id,s.status AS shop_status FROM programmes p JOIN shops s ON s.id=p.shop_id WHERE p.id=$1 AND p.status='published' FOR UPDATE OF s",
          [programmeId],
        );
        if (!programme.rows[0]) throw new Error('This programme is unavailable.');
        const shopId = programme.rows[0].shop_id;
        const person = (
          await tx.query<{ phone: string | null }>(
            'SELECT phone FROM customers WHERE id=$1 FOR UPDATE',
            [customerId],
          )
        ).rows[0];
        if (!person) throw new Error('Customer not found or access denied.');
        if (!person.phone && (consents.sms || consents.whatsapp))
          throw new Error('Phone contact preferences are unavailable for this account.');
        const previous = await tx.query<{ id: string }>(
          'SELECT id FROM memberships WHERE customer_id=$1 AND programme_id=$2',
          [customerId, programmeId],
        );
        if (previous.rows[0]) return previous.rows[0];
        if (productionMode()) await assertMerchantPrivacy(tx, shopId);
        if (programme.rows[0].shop_status !== 'active')
          throw new Error(
            'This shop has paused new enrolments. Existing cards can still be recovered.',
          );
        if (name.trim())
          await tx.query('UPDATE customers SET name=$1 WHERE id=$2', [name.trim(), customerId]);
        const membershipId = id();
        const memberCode = `NQ-${randomBytes(8).toString('hex').toUpperCase()}`;
        await tx.query(
          'INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code) VALUES($1,$2,$3,$4,$5)',
          [membershipId, shopId, programmeId, customerId, memberCode],
        );
        for (const channel of ['sms', 'whatsapp'] as const)
          await tx.query(
            'INSERT INTO consents(id,membership_id,channel,opted_in) VALUES($1,$2,$3,$4)',
            [id(), membershipId, channel, consents[channel] === true],
          );
        await auditEvent(tx, shopId, customerId, 'membership.joined', membershipId);
        return { id: membershipId };
      });
    },
    async getCard(customerId: string, membershipId: string): Promise<MembershipCard> {
      const card = await readMembership(db, membershipId, { customerId });
      const { rows } = await db.query<{ channel: 'sms' | 'whatsapp'; opted_in: boolean }>(
        'SELECT DISTINCT ON(channel) channel,opted_in FROM consents WHERE membership_id=$1 ORDER BY channel,sequence DESC',
        [membershipId],
      );
      card.consents = { sms: false, whatsapp: false };
      for (const row of rows) card.consents[row.channel] = row.opted_in;
      return card;
    },
    async createRedemptionChallenge(
      customerId: string,
      rewardId: string,
    ): Promise<{ challengeId: string; code: string; expiresAt: string }> {
      return db.transaction(async (tx) => {
        const { rows } = await tx.query<{ shop_id: string; membership_id: string }>(
          "SELECT r.shop_id,r.membership_id FROM rewards r JOIN memberships m ON m.id=r.membership_id WHERE r.id=$1 AND m.customer_id=$2 AND m.status='active' AND r.state='available' FOR UPDATE OF r",
          [rewardId, customerId],
        );
        if (!rows[0]) throw new Error('Reward not found or unavailable.');
        const code = randomInt(0, 1000000).toString().padStart(6, '0');
        const challengeId = id();
        const expiresAt = new Date(Date.now() + 120000).toISOString();
        await tx.query(
          'UPDATE redemption_challenges SET used=true WHERE reward_id=$1 AND used=false',
          [rewardId],
        );
        await tx.query(
          'INSERT INTO redemption_challenges(id,reward_id,customer_id,code_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
          [challengeId, rewardId, customerId, hashCode(challengeId, code), expiresAt],
        );
        return { challengeId, code, expiresAt };
      });
    },
    async updatePreferences(
      customerId: string,
      membershipId: string,
      preferences: { sms: boolean; whatsapp: boolean },
    ) {
      const card = await readMembership(db, membershipId, { customerId });
      await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [card.shopId]);
        const member = await tx.query(
          "SELECT id FROM memberships WHERE id=$1 AND customer_id=$2 AND status='active' FOR UPDATE",
          [membershipId, customerId],
        );
        if (!member.rows.length) throw new Error('Membership not found or access denied.');
        const person = (
          await tx.query<{ phone: string | null }>(
            'SELECT phone FROM customers WHERE id=$1 FOR UPDATE',
            [customerId],
          )
        ).rows[0];
        if (!person?.phone && (preferences.sms || preferences.whatsapp))
          throw new Error('Phone contact preferences are unavailable for this account.');
        for (const channel of ['sms', 'whatsapp'] as const)
          await tx.query(
            'INSERT INTO consents(id,membership_id,channel,opted_in) VALUES($1,$2,$3,$4)',
            [id(), membershipId, channel, preferences[channel] === true],
          );
        await auditEvent(tx, card.shopId, customerId, 'preferences.updated', membershipId);
      });
    },
    async requestDeletion(customerId: string, membershipId: string) {
      const card = await readMembership(db, membershipId, { customerId });
      await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM shops WHERE id=$1 FOR UPDATE', [card.shopId]);
        const member = (
          await tx.query<{ shop_id: string }>(
            "SELECT shop_id FROM memberships WHERE id=$1 AND customer_id=$2 AND status='active' FOR UPDATE",
            [membershipId, customerId],
          )
        ).rows[0];
        if (!member) throw new Error('Membership not found or access denied.');
        if (
          (
            await tx.query(
              "SELECT id FROM support_requests WHERE membership_id=$1 AND kind='deletion' AND status='open'",
              [membershipId],
            )
          ).rows.length
        )
          return;
        await tx.query(
          "INSERT INTO support_requests(id,shop_id,membership_id,kind,message) VALUES($1,$2,$3,'deletion',$4)",
          [
            id(),
            member.shop_id,
            membershipId,
            'Customer requests removal of personal data. Explain outstanding rewards and apply the documented retention policy before completing.',
          ],
        );
        await auditEvent(tx, member.shop_id, customerId, 'deletion.requested', membershipId);
      });
    },
  };
}
