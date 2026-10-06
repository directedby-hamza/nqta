import type { Database } from './client';
import { hashCode, hashPassword, id } from '../auth/crypto';
import { createLoyaltyService } from '../loyalty/service';
import type { Actor } from '../loyalty/types';
import { assertHostedTestConfiguration, hostedTestMode } from '../environment';
const names = [
  'Laila Idrissi',
  'Youssef Amrani',
  'Salma Bennis',
  'Hamza El Fassi',
  'Imane Rami',
  'Nadia Alaoui',
  'Sami Tahiri',
  'Rania Bennani',
  'Omar Chraibi',
  'Lina Lahlou',
  'Mehdi Amine',
  'Sara Benali',
];
export async function seedDemo(db: Database) {
  if ((await db.query('SELECT id FROM shops LIMIT 1')).rows.length) return;
  const password = await hashPassword('NqtaDemo2026!');
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO shops(id,slug,name,description,location) VALUES('shop-morrow','morrow','Morrow Coffee','Good coffee. Familiar faces. A little something for coming back.','Casablanca, Morocco')",
    );
    await tx.query(
      "INSERT INTO staff(id,shop_id,name,email,password_hash,role) VALUES('demo-owner','shop-morrow','Adam Benali','owner@nqta.demo',$1,'owner'),('demo-cashier','shop-morrow','Yasmine Amrani','cashier@nqta.demo',$1,'cashier')",
      [password],
    );
    await tx.query(
      "INSERT INTO programmes(id,shop_id,threshold,reward_description,eligibility,status) VALUES('programme-morrow','shop-morrow',5,'One standard coffee, on us','One stamp per separate paid receipt containing a standard coffee.','published')",
    );
  });
  const actor: Actor = { userId: 'demo-owner', shopId: 'shop-morrow', role: 'owner' };
  const loyalty = createLoyaltyService(db);
  const counts = [4, 12, 8, 15, 9, 6, 3, 10, 7, 2, 14, 5];
  for (let i = 0; i < names.length; i++) {
    const customerId = `demo-customer-${i}`;
    const membershipId = `demo-member-${i}`;
    const joinedDays = (i % 4) * 7 + 4;
    const joinedAt = new Date(Date.now() - joinedDays * 86400000).toISOString();
    await db.query('INSERT INTO customers(id,phone,name,created_at) VALUES($1,$2,$3,$4)', [
      customerId,
      `+2126000000${String(i + 1).padStart(2, '0')}`,
      names[i],
      joinedAt,
    ]);
    await db.query(
      "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,created_at) VALUES($1,'shop-morrow','programme-morrow',$2,$3,$4)",
      [membershipId, customerId, `NQ-DEMO${String(i + 1).padStart(4, '0')}`, joinedAt],
    );
    for (const channel of ['sms', 'whatsapp'])
      await db.query(
        'INSERT INTO consents(id,membership_id,channel,opted_in) VALUES($1,$2,$3,$4)',
        [id(), membershipId, channel, i % 3 === 0],
      );
    for (let j = 0; j < counts[i]; j++) {
      const result = await loyalty.recordPurchase(actor, {
        membershipId,
        qualifies: true,
        amountMinor: j % 7 === 0 ? undefined : [2500, 3000, 2000, 3500][(i + j) % 4],
        idempotencyKey: `seed-${i}-${j}`,
      });
      const at = new Date(
        Date.now() -
          Math.floor(((counts[i] - 1 - j) * joinedDays) / counts[i]) * 86400000 -
          (i + j) * 1800000,
      ).toISOString();
      await db.query('UPDATE events SET created_at=$1 WHERE id=$2', [at, result.eventId]);
      if ((j + 1) % 5 === 0)
        await db.query('UPDATE rewards SET created_at=$1 WHERE membership_id=$2 AND sequence=$3', [
          at,
          membershipId,
          (j + 1) / 5,
        ]);
    }
    if (i % 3 === 1) {
      const card = await loyalty.getMembership(actor, membershipId);
      const reward = card.rewards.find((r) => r.state === 'available');
      if (reward) {
        const challengeId = id();
        await db.query(
          "INSERT INTO redemption_challenges(id,reward_id,customer_id,code_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+interval '2 minutes')",
          [challengeId, reward.id, customerId, hashCode(challengeId, '123456')],
        );
        await loyalty.redeemReward(actor, {
          rewardId: reward.id,
          challengeId,
          code: '123456',
          idempotencyKey: `seed-redemption-${i}`,
        });
      }
    }
  }
}
if (process.argv[1]?.endsWith('/seed.ts')) {
  void (async () => {
    if (process.env.NODE_ENV === 'production' && !hostedTestMode())
      throw new Error('Synthetic demo seeding is unavailable in production.');
    assertHostedTestConfiguration();
    const { getDatabase } = await import('./client');
    const db = await getDatabase();
    await seedDemo(db);
    await db.close();
    console.log('Synthetic test workspace is ready.');
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
