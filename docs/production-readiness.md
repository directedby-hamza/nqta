# Production readiness

The founder selected password accounts and saved recovery keys on 8 October 2026. The new [message-free launch guide](message-free-launch.md) supersedes delivery prerequisites when `AUTH_MODE=recovery-key` is explicitly selected. This mode does not claim verified phone/mailbox ownership or convert existing unverified contact accounts. Migration 3, public deployment and actual phone/recovery checks remain required on the selected production environment. The [existing Netlify deployment](deployment-status.md) remains a protected synthetic test site backed by its own Neon database.

The table below records the earlier verified-contact release evidence and dependencies. Its last publication attempt returned GitHub HTTP 403; no source publication or production cutover has been confirmed. A separate empty production database was prepared with migrations 1 and 2; apply migration 3 through the normal migration process before launching the new mode.

The [release runbook](production-release.md) describes setup and records the evidence. Local tests and mocked provider responses verify application behaviour; they do not establish customer delivery or physical-device compatibility.

## Launch gate

| Required before customer use                                                                                | Current state                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Approved provider accounts, Morocco sender registration and explicit SMS spending allowance                 | Pending external setup; no live messages authorized by this implementation                                                              |
| Verified sending domain, transactional email sender and working owner/staff verification and password reset | Application implemented; actual mailbox delivery pending                                                                                |
| Assigned HTTPS production origin and private live configuration                                             | Template supplied; production configuration/cutover pending                                                                             |
| Separate empty TLS PostgreSQL database with migrations and no synthetic records                             | `nqta_production` prepared and migrated with a restricted app role; zero shops/staff/customers/events confirmed after the drill         |
| Clean merchant onboarding through actual verified email, then a new customer through actual Moroccan SMS    | Pending real delivery checks                                                                                                            |
| Final complete unit/integration suite, TypeScript, production build and independent code review             | 207/207 tests; full browser run 16/16, separate deletion UI 1/1; strict TypeScript/build passed; final review found no actionable P1/P2 |
| Independent PostgreSQL concurrency and encrypted backup/restore drill                                       | Passed, exit 0: 63 checks; 22 tables/125 synthetic rows restored; both owned schemas removed                                            |
| Encrypted production baseline backup and ongoing recovery operations                                        | Baseline created with 22 tables/2 migration-history rows and private permissions; scheduled/off-host backups pending                    |
| Publish and deploy the production upgrade                                                                   | Blocked by GitHub integration HTTP 403 write access; no upgraded deployment or cutover                                                  |
| Supported physical phones, cameras and customer/cashier workflow on the assigned production origin          | Pending; simulated browser viewports are insufficient                                                                                   |
| Merchant location, privacy notice/contact, reward/refund terms and operational support/retention ownership  | Required merchant input before publication and launch                                                                                   |

## What the upgrade provides

- Ordinary production requires `NODE_ENV=production`, `HOSTED_TEST_MODE=false`, `DEMO_MODE=false`, TLS PostgreSQL, an exact HTTPS `APP_URL`, a strong `SESSION_SECRET`, and real SMS/email adapter settings. Startup rejects synthetic demo records. The hosted test environment retains explicit simulation and private Basic access.
- New owners and invited staff must verify their mailbox before live workspace access. Links are hashed, expiring and single-use. Resend and password reset are available; reset revokes that staff member's existing sessions. Delivery failures preserve an unverified account so its owner can request another link.
- SMS attempts use durable destination limits, allowed dialling prefixes and a daily ceiling. Provider responses do not return verification secrets or provider credentials. Configuration preflight is separate from actual delivery verification.
- A merchant supplies a location during live registration, then its privacy notice and contact before publication/enrolment. Consent pairs are saved atomically. Owner fulfilment of a deletion request closes the shop's card, removes its personal identity and unused rewards, and preserves financial activity and other shops' memberships. Other review requests retain a recorded resolution and completion time.
- Migrations are versioned, checked against their recorded definition and applied atomically. Encrypted backups and restoration into an empty target support a separate recovery drill. Preserve the deployed synthetic database; do not seed, purge or reset it as part of production setup.

## Operating decisions

Choose the hosting/database/backup regions, responsible operator, backup schedule and retention period, customer privacy contact and support coverage before launch. Review the selected host's actual allowances: [Netlify usage limits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) and [Neon connection guidance](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md). The retained Render alternative was not provisioned; its [Free limitations](https://render.com/docs/free) are documented separately. A host's free plan does not establish free SMS or email delivery; provider costs and sender approval need their own decision.

Unresolved purchase/redemption confirmations remain in browser storage, scoped to staff and shop. Resume the original action on that device before recording another receipt. Network, server and authentication failures preserve it; a confirmed business rejection or successful response resolves it. Use unique receipt references when another device may enter the same receipt.

`SESSION_SECRET` rotation invalidates outstanding verification-code hashes. It does not revoke ordinary database-backed staff/customer sessions. Revoke sessions explicitly when incident response or account recovery requires it, and retain the original backup key privately for any archive still in the retention window.

## Product scope

This release retains stamps, configurable rewards, QR enrolment, cashier activity, reporting, staff invitations, refunds and preferences. The subsequent native Wallet implementation and its activation prerequisites are documented in [Wallet setup](wallet-setup.md); migration 4 is required. Assisted account recovery and programme transitions require recorded owner review. Billing, POS payments, promotional campaigns, spending points and multiple shop branches remain outside this release.
