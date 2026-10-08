# Nqta

A digital loyalty application for neighbourhood shops. Customers keep a browser card and earn one stamp per qualifying paid receipt. Staff confirm rewards with a short-lived customer code. The merchant workspace shows saved activity, with shop isolation and owner controls. Choose password accounts with saved recovery keys, or the original verified-contact flow.

The current upgrade adds `AUTH_MODE=recovery-key` for real customer and staff password accounts without outbound authentication messages. Recovery keys replace message-based password recovery; phone/mailbox ownership is not claimed in this mode. The existing [Netlify site](https://nqta-hamza-test.netlify.app) remains a protected synthetic test environment. Public cutover and physical-device checks remain required before customer use; see [message-free launch](docs/message-free-launch.md). The original [verified-contact production release](docs/production-release.md) remains available for shops selecting that mode.

Native Google Wallet and Apple Wallet integration is now implemented locally, including signed issuance, repeat-visit member QR and queued progress updates. Actions appear only when provider configuration passes local validation; hosted test mode keeps them disabled. Issuer approval, Apple signing credentials, public deployment and actual phone installation still need activation; see [Wallet setup](docs/wallet-setup.md).

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

The published synthetic test site is **[https://nqta-hamza-test.netlify.app](https://nqta-hamza-test.netlify.app)** on Netlify, backed by a dedicated Neon PostgreSQL test database. Its previously verified deployment and saved-record checks are documented in [deployment status](docs/deployment-status.md). This production upgrade has not been cut over to real customer operation. [Hosted testing](docs/hosted-testing.md) covers private test access and the phone-to-computer QR, purchase and redemption journey. The [Render Blueprint](render.yaml) remains an alternative configuration; no Render service was provisioned.

Hosted testing explicitly uses `HOSTED_TEST_MODE=true` with `NODE_ENV=production`. Verification codes are displayed without sending SMS, and both devices share saved synthetic data. A private HTTP Basic password protects the test site. Keep its database and credentials separate from production. Host plan limits still apply; see [Netlify usage documentation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) and the recorded [hosting constraints](docs/hosted-testing.md#free-host-behaviour-and-real-launch).

## What works

- Responsive landing, merchant dashboard, customers, activity, cashier, programme and settings screens.
- Mode-aware password/key or phone enrolment and recovery, an authenticated mobile card, opaque member QR, stamp progress, rewards and deduplicated deletion-request intake. Key accounts have no verified phone and cannot enable phone contact preferences.
- On-demand camera scanning with manual member-code entry when camera access is unavailable.
- Native Wallet issuance with customer ownership checks, privacy-safe pass contents, durable progress updates and Apple device refresh callbacks. A saved Wallet QR earns while the customer browser is signed out; reward confirmation retains its existing protection.
- Review and confirmation of purchases with exact MAD amounts. Interrupted purchase/redemption confirmations survive dialog closure and browser reload; choose **Resume pending confirmation** to resolve the original action before recording another receipt. Optional receipt references prevent duplicate receipts.
- Single-use reward redemption with a two-minute customer code and five-attempt limit.
- Reasoned owner reversals, revoked unused entitlements, and reconciliation flags when a refund affects an enjoyed reward.
- Honest activity reporting, date filters, missing-amount coverage, customer search/filters, member detail and owner-only CSV activity export. Contact numbers are masked; export does not include phone numbers.
- Publication binds the exact saved draft version reviewed by the owner; changes in another tab require another review. Published economic rules stay locked. Shop branding can change independently. Pause stops new enrolment and earning while existing customers can still recover their cards and redeem earned rewards.
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

| Setting                                                 | Purpose                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                               | Canonical app origin, used to check mutation requests. Match the preview or deployed HTTPS URL exactly.       |
| `AUTH_MODE`                                             | `recovery-key` for message-free passwords/keys; `verified-contact` is the default and requires live delivery. |
| `DATA_DIRECTORY`                                        | Local PGlite path; default `.data/nqta`.                                                                      |
| `DEMO_MODE=false`                                       | Disables local demo seeding, sign-in and verification codes when hosted test mode is off.                     |
| `HOSTED_TEST_MODE=true`                                 | Explicit synthetic testing in production; requires PostgreSQL, HTTPS origin and private test access.          |
| `TEST_ACCESS_PASSWORD`                                  | Private HTTP Basic password of at least 16 characters for hosted testing; username `nqta`.                    |
| `DATABASE_URL`                                          | PostgreSQL connection string; ordinary production requires TLS and a separate database with no demo records.  |
| `SESSION_SECRET`                                        | Random secret of at least 32 characters; required in production for verification code hashing.                |
| `SMS_PROVIDER=twilio`                                   | Selects the real SMS delivery adapter.                                                                        |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`               | Private SMS provider credentials; configure only after account and spending approval.                         |
| `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`  | Registered SMS delivery service or approved sender for the destination country.                               |
| `SMS_ALLOWED_PREFIXES`, `SMS_DAILY_LIMIT`               | Allowed dialling prefixes and the maximum daily SMS attempts; choose the ceiling from the approved budget.    |
| `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email adapter, private key and sender on the verified sending domain.                           |
| `BACKUP_ENCRYPTION_KEY`                                 | Exactly 32 random bytes encoded as base64, held separately from encrypted backup archives.                    |

In `NODE_ENV=production`, demo sign-in and simulated verification are disabled unless the validated `HOSTED_TEST_MODE=true` setting is explicitly enabled. Hosted test mode requires a dedicated PostgreSQL connection, an HTTPS `APP_URL`, a session secret and a private test access password. Ordinary production requires `HOSTED_TEST_MODE=false`, `DEMO_MODE=false`, TLS PostgreSQL, an exact HTTPS origin and a strong secret. `AUTH_MODE=recovery-key` removes message delivery from account access; `verified-contact` additionally requires configured Twilio and Resend adapters. Configuration validation does not establish a public deployment, provider ownership or actual delivery. No production cutover is confirmed for this upgrade.

`SESSION_SECRET` protects verification-code hashes. Rotating it invalidates outstanding codes; it does **not** revoke ordinary staff/customer sessions, whose token hashes are stored independently. Revoke those sessions explicitly when required.

## Structure

`src/app` contains routes and API dispatch. `src/features` contains the merchant and customer screens. `src/server` owns authentication, parameterised database access, transactional loyalty logic and reporting. UI requests cannot choose a staff actor or shop scope. `tests/integration` checks actual PostgreSQL-compatible records; `tests/e2e` checks the browser journeys.

The original PDF and specification JSON remain in the parent workspace. [Production readiness](docs/production-readiness.md) lists the launch gate; [production release](docs/production-release.md) contains the operations and current evidence. [Requirement coverage](docs/requirement-coverage.md) and [verification results](docs/verification-results.md) record earlier MVP scope and checks.

## Before a real merchant launch

Keep the hosted test environment intact. Use a separate production database without importing synthetic records, choose an authentication mode and assigned HTTPS origin, then verify clean owner/customer signup, second-device access, recovery, concurrency, restoration and physical-phone checks. Verified-contact mode also requires actual message delivery checks. Each merchant supplies its location, customer privacy notice, contact and operating terms before publishing. [Message-free launch](docs/message-free-launch.md) and [production readiness](docs/production-readiness.md) record the remaining dependencies. Subscription status is manual; no billing is charged. Native Wallet code requires the provider activation steps above. Messaging campaigns, points, multi-location support and POS connections remain later phases.
