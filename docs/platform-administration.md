# Nqta platform administration

The founder signs in at `/admin/sign-in`, separately from shop owners at `/sign-in`. Administrator accounts are provisioned privately; there is no public administrator signup. The first sign-in requires a new password of at least 14 characters. Administrator sessions last 12 hours. Changing the password revokes other administrator sessions.

## Review shops and collect payment

1. Open **Shops & payments** and search by shop name, slug or owner email.
2. Choose **Manage** to see the owner, customer and purchase counts, access period and recorded payment history.
3. For an unpaid account, choose **Manage access → Suspended**, supply a reason and save. The server blocks merchant operations and new enrolment, including existing signed-in merchant sessions. Customer records, existing QR cards and points remain saved. Customers can still open their own cards, withdraw contact permission and request deletion.
4. Receive the money outside Nqta. Choose **Record payment**, enter the amount in MAD, a receipt/transfer/cash reference, and the last access date. Saving records the received payment and activates or extends access. This feature does not charge a bank card or confirm a bank transfer automatically.
5. **Void entry** corrects a mistaken payment record with a reason. It neither refunds money nor changes access. Use **Manage access** separately if necessary.

**Needs review** means previous payment history has not been imported. It does not mean a shop has failed to pay. Existing shops retain access until the founder reviews them. New production shops start **Awaiting activation** and cannot operate until the founder activates them. Demo/development signup remains usable.

An active subscription remains valid through its selected date in Africa/Casablanca. The following day it becomes **Expired**, with the same operation restrictions as suspension. An active shop without an end date stays active until manually changed. Recording an older receipt never shortens a later access date. A payment recorded with an already expired date remains in history but cannot grant current access.

Payment totals are gross amounts manually recorded, excluding voided entries; they are not profit, unpaid invoices or automatically reconciled bank balances. History and activity show the latest 100 entries per shop; older records remain in the database. No subscription prices, payment amounts or paid status are guessed for existing shops.

If a payment response is interrupted, reopen **Record payment** in the same browser tab and retry the saved draft. The same request cannot create a second payment or replay activation after a later suspension. Before clearing a pending draft, check the shop's history. Different request identifiers represent separate entries, so always check the receipt reference before entering it again.

Known minor form limitation: a reference containing only spaces is rejected by the server after the browser saves the draft. No payment is recorded. Check history, clear the pending draft and reopen the form with a real reference; improved client validation is deferred.

## Operations

Migration 7 adds separate administrator/session, billing, payment and administrator audit tables. It backfills existing shops as unreviewed and leaves customer, merchant and loyalty rows intact. Database backups include these tables. Back up using the old application version before upgrading; the encrypted restore format requires the matching application migration version. Never restore into a nonempty live database.

To provision an administrator, set `DATABASE_URL` and private `NQTA_ADMIN_EMAIL`, `NQTA_ADMIN_NAME`, `NQTA_ADMIN_PASSWORD` environment values, then run `npm run admin:create`. Supply a random temporary password of at least 14 characters. The command refuses to overwrite an existing account and never prints passwords. Keep private credentials outside the repository. There is no public password reset or mailbox-verification claim for platform administrators.

The admin API requires its own HttpOnly `nqta_admin` cookie, exact trusted Origin on writes, an active administrator and completion of the initial password change. Merchant/customer cookies do not grant access. Responses are uncached; authentication and writes have durable limits. Shop-level transactional locks serialize access changes with loyalty mutations. Recording/voiding payments and changing access leave an administrator audit trail. Shop owners cannot edit subscription state through shop settings.

Run `npm test`, `npm run typecheck`, `npm run test:admin:e2e` and `npm run build` to verify. The admin browser suite creates a disposable local database and synthetic credentials; it must never target production. Production verification is limited to authenticated identity/read-only checks and anonymous denial. Real shop payments and access decisions belong to the founder.

## Verification — 10 November 2026

All 439 unit/integration tests passed across 46 files, including migration and encrypted backup restoration. Typecheck, formatting and the production build passed. The admin browser journey covered initial password rotation, recording a payment, suspension/reactivation, merchant-session isolation and mobile width. Ten existing customer/profile/staff browser scenarios passed; one cold local database initialization exceeded its first-run timeout and its targeted rerun passed. A disposable PostgreSQL schema verified concurrent payment idempotency, a purchase queued behind suspension, revision conflicts and migration; the owned schema was removed. Independent review found no blocking issues and the minor reference-validation limitation above remains documented.

Before publication, an encrypted backup preserved 25 production tables / 133 rows. The founder's live shops are not suspended automatically. Publication and private credential delivery will be recorded after verification on the host.
