# Nqta

A digital loyalty application for neighbourhood shops. Customers keep a browser card and earn one stamp per qualifying paid receipt. Staff confirm rewards with a short-lived customer code. The merchant workspace shows saved activity, with shop isolation and owner controls. Customers sign up with a phone number and password, then immediately open their QR card. Signup collects full name, phone and email. An optional, unchecked choice records whether the customer wants email news from that shop. Returning signed-in browsers find the same card automatically; customers can save a branded checkout QR image or a home-screen shortcut.

The current upgrade is published at **[https://nqta-hamza.netlify.app](https://nqta-hamza.netlify.app)** with `AUTH_MODE=recovery-key`, demo/test modes disabled and a separate Neon production database. Customer phone/password accounts require no recovery-key save step or outbound authentication messages. Existing customer accounts remain compatible; staff recovery keys are unchanged. Phone/mailbox ownership is not claimed in this mode. Live readiness and 14 real production account/loyalty checks passed, including earning while the customer is signed out and single-use reward redemption. The temporary verification records were removed. The existing [Netlify test site](https://nqta-hamza-test.netlify.app) remains protected and unchanged. See [production deployment status](docs/production-deployment-status.md) for the exact deployment and outstanding checks, and [message-free launch](docs/message-free-launch.md) for account operation. The original [verified-contact production release](docs/production-release.md) remains available for shops selecting that mode.

Native Apple/Google Wallet remains deferred. Customer actions and server issuance, downloads, callbacks and delivery are disabled, including when old provider configuration exists. The active browser-card approach uses no new Wallet or messaging provider. See [simple customer access](docs/simple-customer-access.md) for signup, remembered sessions and saved QR behavior.

The requested imaginary shop is **[Atlas Coffee — Marrakech](https://nqta-hamza.netlify.app/join/atlas-coffee)**. New enrolment collects full name, declared phone/email and a private password, then opens the browser card with its greeting, points and checkout QR. Native Wallet is deferred and disabled. Newsletter permission is optional and editable from card settings. See the [walkthrough and QR](docs/atlas-coffee-wallet-flow.md); this shop remains saved for phone/computer testing.

## Run locally

```sh
cd nqta
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Use Node **24.x**; the project also installs a local Node 24 runtime for npm scripts. Dependencies are pinned in `package-lock.json`.

The first API request creates a persistent PGlite database at `.data/nqta` and seeds **Morrow Coffee** with synthetic customers. Local verification displays a test code instead of sending SMS. Every demo purchase uses the real transactional loyalty engine and persists on this computer.

On the sign-in screen, choose **Explore demo workspace**, or use:

| Role    | Email               | Password        |
| ------- | ------------------- | --------------- |
| Owner   | `owner@nqta.demo`   | `NqtaDemo2026!` |
| Cashier | `cashier@nqta.demo` | `NqtaDemo2026!` |

Customer enrolment: **/join/morrow**. To recover the first sample customer card, verify `+212600000001` using the displayed local code. Cashiers can find it with `NQ-DEMO0001`.

Choose **Create your shop** for a clean workspace. Save and publish its first programme, then share the enrolment link or download the QR poster. The new shop has its own owner, members, rules and reports.

To develop the message-free flow, set `AUTH_MODE=recovery-key` and use a separate `DATA_DIRECTORY`. Customers create an account ID/password and save their recovery key; new owners and invited staff save a key as well. Existing sample phone accounts are not silently converted. Demo seeding remains development-only.

## Test on phone and computer

The real-mode app is **[https://nqta-hamza.netlify.app](https://nqta-hamza.netlify.app)**, on Netlify Free with a separate TLS Neon database and versioned migrations applied. Its public sign-in and readiness endpoint respond successfully. A real API journey passed 14 checks for owner/customer signup, programme publication, five paid purchases, duplicate prevention and protected reward redemption; direct PostgreSQL checks confirmed the records, and cleanup restored all business/authentication tables to empty before the retained Atlas showcase shop was created. The live verification is recorded in [production deployment status](docs/production-deployment-status.md); physical-phone compatibility still needs device testing.

The synthetic test site is **[https://nqta-hamza-test.netlify.app](https://nqta-hamza-test.netlify.app)**, backed by its original dedicated Neon test database. Its earlier saved-record checks are documented in [test deployment status](docs/deployment-status.md). [Hosted testing](docs/hosted-testing.md) covers private test access and the phone-to-computer QR, purchase and redemption journey. The [Render Blueprint](render.yaml) remains an alternative configuration; no Render service was provisioned.

Hosted testing explicitly uses `HOSTED_TEST_MODE=true` with `NODE_ENV=production`. Verification codes are displayed without sending SMS, and both devices share saved synthetic data. A private HTTP Basic password protects the test site. Keep its database and credentials separate from production. Host plan limits still apply; see [Netlify usage documentation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) and the recorded [hosting constraints](docs/hosted-testing.md#free-host-behaviour-and-real-launch).

## What works

- Responsive landing, merchant dashboard, customers, activity, cashier, programme and settings screens.
- Phone/password signup with required full name and email, optional shop newsletter permission, direct authenticated QR cards, remembered shop-link access, 90-day password sessions, downloadable QR images, home-screen guidance, stamp progress, rewards and deletion-request intake. Phone usernames and shop contact declarations are unverified. Email offers require a separate explicit opt-in; phone promotional preferences remain unavailable for unverified-phone accounts. Existing account-ID sign-in and previously issued recovery keys remain compatible.
- On-demand camera scanning with manual member-code entry when camera access is unavailable.
- Customers open their saved web card and show its opaque QR to the cashier. Native Apple/Google Wallet is deferred: customer actions are removed and server issuance, downloads, callbacks and delivery stay disabled, even if provider credentials exist. Existing accounts, cards and ledger data remain intact.
- Review and confirmation of purchases with exact MAD amounts. Interrupted purchase/redemption confirmations survive dialog closure and browser reload; choose **Resume pending confirmation** to resolve the original action before recording another receipt. Optional receipt references prevent duplicate receipts.
- Single-use reward redemption with a two-minute customer code and five-attempt limit.
- Reasoned owner reversals, revoked unused entitlements, and reconciliation flags when a refund affects an enjoyed reward.
- Honest activity reporting, date filters, missing-amount coverage, customer search/filters, member detail and owner-only CSV activity export. Contact numbers are masked; export does not include phone numbers.
- Publication binds the exact saved draft version reviewed by the owner; changes in another tab require another review. Published economic rules stay locked. Shop branding can change independently. Pause stops new enrolment and earning while existing customers can still recover their cards and redeem earned rewards.
- Owner-visible declared customer contacts and email permission history, with an owner-only newsletter CSV of current opt-ins. Latest withdrawal is respected, addresses are deduplicated and cashier responses omit raw contact details. No newsletter is sent by this feature. See [customer profiles and newsletter preparation](docs/customer-profiles-newsletter.md).
- Owner-controlled, single-use staff invitation links, individual passwords, seven-day staff sessions and immediate access revocation. New key-mode accounts store an explicit authentication method and keep mailbox verification false; saved-key reset rotates the key and revokes sessions. Contact-mode accounts retain mailbox verification and expiring email reset links.
- Owner fulfilment of a shop's deletion requests closes the card, disconnects personal identity and revokes unused rewards while retaining financial activity and other shops' memberships. Owners can record resolutions for other review requests; assisted recovery and programme transitions still require their review.
- Live configuration rejects simulation and synthetic demo records. Key-mode production requires HTTPS, TLS PostgreSQL and a strong secret, with delivery routes disabled. Verified-contact mode additionally requires provider settings. PostgreSQL migrations are versioned and atomic; authentication uses durable request limits. Provider transport tests use mocked responses and do not prove real delivery.
- Reduced-motion support, accessible dialog focus management, pending/error states and server-confirmed success messages.

## Development checks

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
AUTH_MODE=recovery-key npx playwright test --config playwright.password.config.ts
```

Playwright needs a Chromium installation. If it is absent, run `npx playwright install chromium`. Run the two browser configurations sequentially. The browser suite creates synthetic customer and shop records in a separate local demo database. Set `NQTA_E2E_DATA_DIRECTORY` to an unused directory when selecting its storage, and `NQTA_E2E_PORT` when selecting a separate local port. Tests against the loyalty engine use isolated temporary databases. Independent PostgreSQL and restore checks are described in [production release](docs/production-release.md); do not run them against the hosted test or production database. See [password/key verification](docs/message-free-launch.md#verification-on-8-october-2026) for this upgrade's results.

Production compilation uses Next’s supported Webpack compiler; local development uses Turbopack. The host’s restricted socket permissions prevented the Turbopack production compiler from running. No hosted font, remote image or external account is needed to render the interface.

`npm run db:seed` explicitly creates the demonstration workspace on an empty development database. Hosted test seeding requires `HOSTED_TEST_MODE=true` and validated hosted configuration; follow the [one-time database setup](docs/hosted-testing.md#seed-the-dedicated-database-once). **Stop the dev server before running a database CLI against the same PGlite directory.** PGlite is for one local app process; use hosted PostgreSQL for a deployed service. Do not delete `.data` unless you intend to erase the local records.

## Configuration

`.env.example` documents local/test variables. Copy it to `.env.local` when you need development overrides. Use [production-environment.example](docs/production-environment.example) as the template for a private `.env.production`; real values stay outside Git.

| Setting                                                 | Purpose                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                               | Canonical app origin, used to check mutation requests. Match the preview or deployed HTTPS URL exactly.                                      |
| `AUTH_MODE`                                             | `recovery-key` for message-free customer phone/password and legacy/staff keys; `verified-contact` is the default and requires live delivery. |
| `DATA_DIRECTORY`                                        | Local PGlite path; default `.data/nqta`.                                                                                                     |
| `DEMO_MODE=false`                                       | Disables local demo seeding, sign-in and verification codes when hosted test mode is off.                                                    |
| `HOSTED_TEST_MODE=true`                                 | Explicit synthetic testing in production; requires PostgreSQL, HTTPS origin and private test access.                                         |
| `TEST_ACCESS_PASSWORD`                                  | Private HTTP Basic password of at least 16 characters for hosted testing; username `nqta`.                                                   |
| `DATABASE_URL`                                          | PostgreSQL connection string; ordinary production requires TLS and a separate database with no demo records.                                 |
| `SESSION_SECRET`                                        | Random secret of at least 32 characters; required in production for verification code hashing.                                               |
| `SMS_PROVIDER=twilio`                                   | Selects the real SMS delivery adapter.                                                                                                       |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`               | Private SMS provider credentials; configure only after account and spending approval.                                                        |
| `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`  | Registered SMS delivery service or approved sender for the destination country.                                                              |
| `SMS_ALLOWED_PREFIXES`, `SMS_DAILY_LIMIT`               | Allowed dialling prefixes and the maximum daily SMS attempts; choose the ceiling from the approved budget.                                   |
| `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email adapter, private key and sender on the verified sending domain.                                                          |
| `BACKUP_ENCRYPTION_KEY`                                 | Exactly 32 random bytes encoded as base64, held separately from encrypted backup archives.                                                   |

In `NODE_ENV=production`, demo sign-in and simulated verification are disabled unless the validated `HOSTED_TEST_MODE=true` setting is explicitly enabled. Hosted test mode requires a dedicated PostgreSQL connection, an HTTPS `APP_URL`, a session secret and a private test access password. Ordinary production requires `HOSTED_TEST_MODE=false`, `DEMO_MODE=false`, TLS PostgreSQL, an exact HTTPS origin and a strong secret. `AUTH_MODE=recovery-key` removes message delivery from account access; `verified-contact` additionally requires configured Twilio and Resend adapters. The public deployment uses the ordinary production configuration above; native Wallet remains disabled.

`SESSION_SECRET` protects verification-code hashes. Rotating it invalidates outstanding codes; it does **not** revoke ordinary staff/customer sessions, whose token hashes are stored independently. Revoke those sessions explicitly when required.

## Structure

`src/app` contains routes and API dispatch. `src/features` contains the merchant and customer screens. `src/server` owns authentication, parameterised database access, transactional loyalty logic and reporting. UI requests cannot choose a staff actor or shop scope. `tests/integration` checks actual PostgreSQL-compatible records; `tests/e2e` checks the browser journeys.

The original PDF and specification JSON remain in the parent workspace. [Production readiness](docs/production-readiness.md) lists the launch gate; [production release](docs/production-release.md) contains the operations and current evidence. [Requirement coverage](docs/requirement-coverage.md) and [verification results](docs/verification-results.md) record earlier MVP scope and checks.

## Before a real merchant launch

The protected hosted test environment is intact, and the separate public app now uses a clean production database and assigned HTTPS origin. The core live account/earning/redemption journey passed. Complete physical-phone, cross-device recovery/staff operation and operational backup/restore checks before merchant onboarding. Verified-contact mode additionally needs actual message delivery checks. Each merchant supplies its location, customer privacy notice, contact and operating terms before publishing. [Production deployment status](docs/production-deployment-status.md), [message-free launch](docs/message-free-launch.md) and [production readiness](docs/production-readiness.md) record the evidence and remaining dependencies. Subscription status is manual; no billing is charged. Native Wallet is deferred. Messaging campaigns, points, multi-location support and POS connections remain later phases.
