import { afterEach, beforeEach, expect, it } from 'vitest';
import { createReportingService } from '../../src/server/reporting/metrics';
import { fixture, owner, cashier, otherOwner } from './fixture';
import type { Database } from '../../src/server/db/client';
import { createPrivacyService } from '../../src/server/privacy/service';

let db: Database;
let reporting: ReturnType<typeof createReportingService>;
beforeEach(async () => {
  db = await fixture();
  reporting = createReportingService(db);
  await db.query("INSERT INTO customers(id,phone,name) VALUES('person',NULL,'Mina El Amrani')");
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,contact_phone,contact_email) VALUES('member','shop','programme','person','NQ-PROFILE','+212612345678','mina@example.com')",
  );
});
afterEach(async () => {
  await db?.close();
});
async function emailConsent(value: boolean, membership = 'member') {
  await db.query(
    "INSERT INTO consents(id,membership_id,channel,opted_in,wording_version) VALUES($1,$2,'email',$3,'email-newsletter-1.0')",
    [crypto.randomUUID(), membership, value],
  );
}

it('shows the owner declared contacts and latest newsletter choice without claiming verification', async () => {
  const withoutConsent = (await reporting.listMemberships(owner))[0];
  expect(withoutConsent).toMatchObject({
    name: 'Mina El Amrani',
    contactPhone: '+212612345678',
    contactEmail: 'mina@example.com',
    newsletterOptedIn: false,
    newsletterUpdatedAt: null,
  });
  await emailConsent(true);
  const optedIn = (await reporting.listMemberships(owner))[0];
  expect(optedIn.newsletterOptedIn).toBe(true);
  expect(new Date(optedIn.newsletterUpdatedAt!).getTime()).toBeGreaterThan(0);
  await emailConsent(false);
  expect((await reporting.listMemberships(owner))[0].newsletterOptedIn).toBe(false);
  expect(await reporting.listMemberships(otherOwner)).toEqual([]);
});

it('uses the actual staff role to redact raw contacts and newsletter metadata for cashiers', async () => {
  await emailConsent(true);
  for (const actor of [cashier, { ...cashier, role: 'owner' as const }]) {
    const result = (await reporting.listMemberships(actor))[0];
    expect(result.phone).toContain('•••');
    expect(result).not.toHaveProperty('contactPhone');
    expect(result).not.toHaveProperty('contactEmail');
    expect(result).not.toHaveProperty('newsletterOptedIn');
    expect(result).not.toHaveProperty('newsletterUpdatedAt');
    expect(JSON.stringify(result)).not.toContain('mina@example.com');
  }
});

it('exports only explicit latest opt-ins at the owner’s shop and records a contact-free audit', async () => {
  expect(await reporting.exportNewsletter(owner)).not.toContain('mina@example.com');
  await emailConsent(true);
  const csv = await reporting.exportNewsletter(owner);
  expect(csv).toContain('"full_name","email","phone","consent_updated_at"');
  expect(csv).toContain('Mina El Amrani');
  expect(csv).toContain('mina@example.com');
  expect(csv).toContain("'+212612345678");
  expect(await reporting.exportNewsletter(otherOwner)).not.toContain('mina@example.com');
  await expect(reporting.exportNewsletter(cashier)).rejects.toThrow(/owner/i);
  await expect(reporting.exportNewsletter({ ...cashier, role: 'owner' })).rejects.toThrow(/owner/i);
  await emailConsent(false);
  expect(await reporting.exportNewsletter(owner)).not.toContain('mina@example.com');
  const audit = (await db.query("SELECT reason FROM audit WHERE action='newsletter.exported'"))
    .rows;
  expect(audit.length).toBeGreaterThan(0);
  expect(JSON.stringify(audit)).not.toContain('mina@example.com');
});

it('excludes closed or invalid-email memberships and deduplicates newsletter addresses', async () => {
  await emailConsent(true);
  await db.query(
    "INSERT INTO customers(id,phone,name) VALUES('second',NULL,'Sara'),('third',NULL,'Closed person'),('fourth',NULL,'Invalid person')",
  );
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,contact_email,status) VALUES('second-member','shop','programme','second','NQ-SECOND','MINA@EXAMPLE.COM','active'),('closed-member','shop','programme','third','NQ-CLOSED','closed@example.com','closed'),('invalid-member','shop','programme','fourth','NQ-INVALID','not-an-email','active')",
  );
  for (const member of ['second-member', 'closed-member', 'invalid-member'])
    await emailConsent(true, member);
  const csv = await reporting.exportNewsletter(owner);
  expect(csv.split('\r\n')).toHaveLength(2);
  expect(csv).not.toContain('closed@example.com');
  expect(csv).not.toContain('not-an-email');
});

it('escapes formulas, commas and quotes in newsletter CSV cells', async () => {
  await db.query('UPDATE customers SET name=$1 WHERE id=$2', [
    ' =HYPERLINK("example"), Mina',
    'person',
  ]);
  await emailConsent(true);
  expect(await reporting.exportNewsletter(owner)).toContain('"\' =HYPERLINK(""example""), Mina"');
});

it('respects a more recent withdrawal for the same email at the same shop', async () => {
  await emailConsent(true);
  await db.query("INSERT INTO customers(id,phone,name) VALUES('returning',NULL,'Mina')");
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,contact_email) VALUES('returning-member','shop','programme','returning','NQ-RETURNING','MINA@EXAMPLE.COM')",
  );
  await emailConsent(false, 'returning-member');
  expect(await reporting.exportNewsletter(owner)).not.toContain('mina@example.com');
});

it('keeps a duplicate address withdrawn after deleting the membership that withdrew it', async () => {
  await emailConsent(true);
  await db.query("INSERT INTO customers(id,phone,name) VALUES('deleting',NULL,'Delete my card')");
  await db.query(
    "INSERT INTO memberships(id,shop_id,programme_id,customer_id,member_code,contact_email) VALUES('deleting-member','shop','programme','deleting','NQ-DELETING','MINA@EXAMPLE.COM')",
  );
  await emailConsent(false, 'deleting-member');
  await db.query(
    "INSERT INTO support_requests(id,shop_id,membership_id,kind,message) VALUES('delete-request','shop','deleting-member','deletion','Remove my information')",
  );
  await createPrivacyService(db).fulfilDeletion(
    owner,
    'delete-request',
    'Customer requested removal from this shop.',
  );
  expect(await reporting.exportNewsletter(owner)).not.toContain('mina@example.com');
  expect(
    (await db.query("SELECT contact_email FROM memberships WHERE id='deleting-member'")).rows[0]
      .contact_email,
  ).toBeNull();
  const preservedChoice = (
    await db.query(
      "SELECT opted_in,wording_version FROM consents WHERE membership_id='member' AND channel='email' ORDER BY sequence DESC LIMIT 1",
    )
  ).rows[0];
  expect(preservedChoice).toEqual({
    opted_in: false,
    wording_version: 'email-newsletter-deletion-1.0',
  });
  await emailConsent(true);
  expect(await reporting.exportNewsletter(owner)).toContain('mina@example.com');
});
