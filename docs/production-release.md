# Production release runbook

The existing [Netlify/Neon deployment](deployment-status.md) is a synthetic test environment. Keep its records, access gate and configuration intact while preparing a **separate** production database and origin. This runbook describes the production upgrade; it does not confirm a deployment or real-customer readiness. See the [launch gate](production-readiness.md).

## Configure a separate production environment

1. Choose the production host/database regions, assigned HTTPS origin, accountable operator and backup retention. Preserve the existing test database; create a new empty PostgreSQL database rather than importing the Morrow seed or local `.data` files.
2. Select and approve the real SMS/email provider accounts and sending domain. Agree an explicit SMS budget before activating paid delivery or sending messages. Confirm an approved sender or messaging service for Morocco ([Twilio country guidelines](https://www.twilio.com/en-us/guidelines/ma/sms)) and verify an owned email sending domain ([Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)). Provider credentials and any actual setup/delivery are still pending.
3. Copy [production-environment.example](production-environment.example) into a private `.env.production`. Configure `HOSTED_TEST_MODE=false`, `DEMO_MODE=false`, a TLS PostgreSQL URL, the exact HTTPS `APP_URL`, a strong random `SESSION_SECRET`, Twilio sender/credentials, `SMS_ALLOWED_PREFIXES=212`, an approved `SMS_DAILY_LIMIT`, and Resend credentials/sender. The example daily limit is a placeholder, not a spending authorization. Keep the file and all real values outside Git.
4. Keep the backup key separate from archives: `BACKUP_ENCRYPTION_KEY` is exactly 32 random bytes encoded as base64. Store it in the operator's secret store and retain keys for the full retention period of their archives. Losing the key makes those encrypted backups unusable.

On 6 October, a separate `nqta_production` database was created with a restricted application role and both migrations applied. Verification found zero shops, staff, customers and events, and the post-drill check confirmed those counts remained zero. Its private preparation file is `.env.production.pending` (mode 0600); this contains the actual database connection and generated secrets, while production origin and delivery settings remain blank. Preserve that file privately and complete those missing settings before copying it to `.env.production`. The existing test database was unchanged. The two databases share the current Neon project/region; confirm regions and capacity for the launch.

Use Node 24 and the pinned dependencies. Load the private environment in the **same process** as each operator command:

```sh
./node_modules/.bin/node --env-file=.env.production --import tsx scripts/migrate.ts
./node_modules/.bin/node --env-file=.env.production --import tsx scripts/preflight.ts
```

Migration applies the versioned schema without seeding. Preflight validates live configuration, checks database access/schema and rejects demo records; it reports delivery/device verification as outstanding. It does not send a provider message or certify a sending domain. Do not use `db:seed` during production setup. `/api/health` is liveness; `/api/ready` checks application/database readiness, not SMS/email delivery.

## Verify the merchant and customer workflow

After account/spending approval and final technical checks:

1. Create a fresh shop at the assigned production origin with a real owner email and actual location. Confirm it starts with no customers or financial activity and does not open the workspace before mailbox verification. Open the received single-use email link. Exercise resend after a failed delivery, and verify password reset revokes earlier staff sessions.
2. Add the shop's customer privacy notice and contact in Settings. Agree the reward, qualifying paid receipt, refund terms, retention and support ownership. Save, review and publish the first programme, then share its enrolment QR. Create an individual cashier account through a private invitation and actual mailbox verification.
3. On a supported physical phone, enrol through a real Moroccan phone number and enter the received SMS. Ensure no development code appears. Record separate qualifying receipts from the cashier device, check the saved stamps/reward, redeem with the short-lived customer code, and confirm retry/replay behaviour and recovery from another browser.
4. Check camera permission/manual fallback, mobile layout, owner/cashier access, receipts, reports/export, pause, refund reconciliation and consent persistence. Submit a deletion request and fulfil it as the owner: this shop's card closes and unused rewards are revoked; financial activity remains and the same person's other-shop card stays intact.
5. Record the production origin, source revision, timestamps, provider delivery evidence, tested devices and outcomes without placing credentials, private links or customer identifiers in this repository. Cut over only after every [launch gate](production-readiness.md#launch-gate) item is complete.

## Backup and restore

The application backup tool uses authenticated AES-256-GCM encryption. It preserves the compatible schema's records, including the financial ledger, reward states, idempotency history, consent history and authentication records. Archives therefore remain sensitive even though encrypted. Restrict access, store an off-host copy and follow the agreed retention schedule.

Prepare a private backup directory outside the repository; it must already exist. Create an archive before a production migration and on the agreed routine schedule, using a new filename each time:

```sh
./node_modules/.bin/node --env-file=.env.production --import tsx scripts/backup.ts create /private/prepared/path/snapshot.nqta
```

Replace the example path with the prepared directory. Creation writes only encrypted bytes with private file permissions and refuses to overwrite an existing archive. It snapshots the selected application's current schema and checks compatible migration history; store the source revision alongside the archive so a restore can use the matching application version. Copy the archive to the agreed off-host storage without copying its encryption key into the same location.

For restoration, prepare a private `.env.restore` with a **new, empty TLS PostgreSQL database** as `DATABASE_URL` and the original `BACKUP_ENCRYPTION_KEY`. Use the application version compatible with the archive:

```sh
./node_modules/.bin/node --env-file=.env.restore --import tsx scripts/backup.ts restore /private/prepared/path/snapshot.nqta
```

Restore requires an empty selected schema, including no tables, views, materialized views or sequences. It recreates the schema and imports records atomically; it never clears existing records or objects. A new empty database is the simplest target. If using a separately created schema, configure `DATABASE_URL` with an explicit `search_path` containing only that schema. Never select the running production or hosted test database/schema for restoration. These backup commands open PostgreSQL directly; they do not send SMS/email or load the private env file on your behalf.

Keep production configuration and credentials separate from the archive. Restore verification must compare balances, event counts, reward state, idempotent retries, preferences and subsequent writes before any recovery cutover.

Restoration includes session and token records. During incident recovery, explicitly revoke restored sessions and outstanding authentication challenges/tokens as required by the incident decision. `SESSION_SECRET` rotation invalidates OTP codes; it does not invalidate ordinary stored sessions. Retain the original backup key to decrypt retained archives.

## Independent PostgreSQL drill

Prepare a private `.env.postgres-drill` that selects a separate disposable PostgreSQL database with TLS, contains a fresh `BACKUP_ENCRYPTION_KEY`, and explicitly sets `NQTA_ALLOW_DISPOSABLE_SCHEMA=true`. Use a role allowed to create/drop schemas there:

```sh
./node_modules/.bin/node --env-file=.env.postgres-drill --import tsx scripts/check-postgres.ts
```

The drill creates two internally generated schemas, uses independent PostgreSQL pools, and removes only those schemas on completion. It checks migration/concurrent loyalty operations and encrypted restoration using synthetic records. Do not point it at the deployed test database or customer data. A passing drill demonstrates the application recovery/concurrency checks; it does not configure scheduled backups, off-host storage, real provider delivery or physical phones.

The actual independent TLS PostgreSQL drill completed on 6 October with **exit 0 and 63 checks**, restoring **22 tables and 125 synthetic rows**. Both UUID-named schemas created by the drill were dropped. A read-only follow-up found zero shops, staff, customers and events in the production public schema, zero disposable drill schemas and no active drill connections. A separate encrypted production baseline contains **22 tables and only the two migration-history rows**; its file permissions are **0600** and its parent directory is **0700**. Scheduled backups and off-host storage remain pending.

## Release evidence — 2026-10-06

These checks apply to the local production-upgrade work, not the already published synthetic deployment. Checks are recorded only after their commands complete successfully.

| Check                                                                                | Evidence available                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Chromium browser journeys, including password recovery/session revocation            | Full run 16/16 passed, 2.3m; additional deletion UI test 1/1 passed separately, 48.8s                         |
| Focused privacy, TLS configuration and customer regression checks after review fixes | 35/35 passed; isolated records and mocked delivery                                                            |
| Earlier focused configuration/provider/customer/API checks                           | Passed; mocked providers do not prove real delivery                                                           |
| Final complete unit/integration suite and strict TypeScript                          | 207/207 in 21 files, 334.63s; strict TypeScript passed                                                        |
| Final production build and independent review of the final tree                      | Webpack production build passed; final independent review found no actionable P1/P2 issues                    |
| Independent TLS PostgreSQL concurrency and encrypted restore drill                   | Exit 0; 63 checks; 22 tables/125 synthetic rows restored; both owned schemas dropped                          |
| Post-drill safety check                                                              | Production public shops/staff/customers/events all zero; disposable schemas zero; no active drill connections |
| Encrypted empty production baseline                                                  | 22 tables/2 migration-history rows; archive 0600, parent 0700                                                 |
| Fresh production database and verified merchant onboarding                           | Database prepared empty; actual mailbox onboarding pending                                                    |
| Real transactional email and Moroccan SMS delivery                                   | Pending approved providers/domain/sender and spending                                                         |
| Physical phones/cameras and production cutover                                       | Pending                                                                                                       |
| Scheduled backups and off-host recovery storage                                      | Pending operational setup                                                                                     |
| Source publication and upgraded deployment                                           | GitHub integration write returned HTTP 403; remote `main` at `19a5730`; upgrade not published/deployed        |

The older [hosted deployment evidence](deployment-status.md) remains valid for its recorded synthetic test version and shared Neon records. It does not establish that this production upgrade is deployed, that real providers work, or that the launch gate is complete.

The completed technical checks do not authorize a real-customer cutover. Approved Twilio/Resend accounts, sender/domain setup, SMS budget, actual mailbox/SMS acceptance, physical-phone checks, assigned production origin and scheduled/off-host backups remain outstanding. Preserve the existing test site/database until publication, deployment and these launch conditions are resolved.
