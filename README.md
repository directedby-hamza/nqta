# Nqta

A working local digital loyalty MVP for neighbourhood shops. Customers join with a verified phone, keep a browser card, and earn one stamp per qualifying paid receipt. Staff confirm rewards with a short-lived customer code. The merchant workspace shows the saved activity, with shop isolation and owner controls.

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

## Test on phone and computer

The [Render Blueprint](render.yaml) prepares a Free Node service backed by a dedicated Neon Free PostgreSQL test database. [Hosted testing](docs/hosted-testing.md) covers deployment, private test access, one-time synthetic seeding and the phone-to-computer QR, purchase and redemption journey. Use the actual HTTPS URL from a successful deployment; this repository does not itself establish a live URL.

Hosted testing explicitly uses `HOSTED_TEST_MODE=true` with `NODE_ENV=production`. Verification codes are displayed without sending SMS, and both devices share saved synthetic data. A private HTTP Basic password protects the test site. Render Free can take about a minute to wake after inactivity. [Render Free limits](https://render.com/docs/free).

## What works

- Responsive landing, merchant dashboard, customers, activity, cashier, programme and settings screens.
- Phone enrolment and recovery, an authenticated mobile card, opaque member QR, stamp progress, rewards, consent preferences and deletion-request intake.
- On-demand camera scanning with manual member-code entry when camera access is unavailable.
- Review and confirmation of purchases with exact MAD amounts. Interrupted purchase/redemption confirmations survive dialog closure and browser reload; choose **Resume pending confirmation** to resolve the original action before recording another receipt. Optional receipt references prevent duplicate receipts.
- Single-use reward redemption with a two-minute customer code and five-attempt limit.
- Reasoned owner reversals, revoked unused entitlements, and reconciliation flags when a refund affects an enjoyed reward.
- Honest activity reporting, date filters, missing-amount coverage, customer search/filters, member detail and owner-only CSV activity export. Contact numbers are masked; export does not include phone numbers.
- Publication binds the exact saved draft version reviewed by the owner; changes in another tab require another review. Published economic rules stay locked. Shop branding can change independently. Pause stops new enrolment and earning while existing customers can still recover their cards and redeem earned rewards.
- Owner-controlled, single-use staff invitation links, individual passwords, seven-day staff sessions and immediate access revocation.
- Reduced-motion support, accessible dialog focus management, pending/error states and server-confirmed success messages.

## Development checks

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Playwright needs a Chromium installation. If it is absent, run `npx playwright install chromium`. The browser suite creates fresh synthetic customer and shop records in the local demo database. Use a separate `DATA_DIRECTORY` when testing a workspace containing data you want to keep pristine. Tests against the loyalty engine use isolated temporary databases.

Production compilation uses Next’s supported Webpack compiler; local development uses Turbopack. The host’s restricted socket permissions prevented the Turbopack production compiler from running. No hosted font, remote image or external account is needed to render the interface.

`npm run db:seed` explicitly creates the demonstration workspace on an empty development database. Hosted test seeding requires `HOSTED_TEST_MODE=true` and validated hosted configuration; follow the [one-time database setup](docs/hosted-testing.md#seed-the-dedicated-database-once). **Stop the dev server before running a database CLI against the same PGlite directory.** PGlite is for one local app process; use hosted PostgreSQL for a deployed service. Do not delete `.data` unless you intend to erase the local records.

## Configuration

`.env.example` documents the optional variables. Copy it to `.env.local` when you need overrides.

| Setting                                                         | Purpose                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                                       | Canonical app origin, used to check mutation requests. Match the preview or deployed HTTPS URL exactly. |
| `DATA_DIRECTORY`                                                | Local PGlite path; default `.data/nqta`.                                                                |
| `DEMO_MODE=false`                                               | Disables local demo seeding, sign-in and verification codes when hosted test mode is off.               |
| `HOSTED_TEST_MODE=true`                                         | Explicit synthetic testing in production; requires PostgreSQL, HTTPS origin and private test access.    |
| `TEST_ACCESS_PASSWORD`                                          | Private HTTP Basic password of at least 16 characters for hosted testing; username `nqta`.              |
| `DATABASE_URL`                                                  | PostgreSQL connection string for a configured hosted database.                                          |
| `SESSION_SECRET`                                                | Random secret of at least 32 characters; required in production for verification code hashing.          |
| `SMS_PROVIDER=twilio`                                           | Selects the real SMS delivery adapter.                                                                  |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Live SMS provider credentials; never commit them.                                                       |

In `NODE_ENV=production`, demo sign-in and simulated verification are disabled unless the validated `HOSTED_TEST_MODE=true` setting is explicitly enabled. Hosted test mode requires a dedicated PostgreSQL connection, an HTTPS `APP_URL`, a session secret and a private test access password. Ordinary production requires real SMS configuration and refuses verification when delivery is unavailable. No live provider calls were made during this implementation.

## Structure

`src/app` contains routes and API dispatch. `src/features` contains the merchant and customer screens. `src/server` owns authentication, parameterised database access, transactional loyalty logic and reporting. UI requests cannot choose a staff actor or shop scope. `tests/integration` checks actual PostgreSQL-compatible records; `tests/e2e` checks the browser journeys.

The original PDF and specification JSON remain in the parent workspace. [Production readiness](docs/production-readiness.md), [requirement coverage](docs/requirement-coverage.md), and [verification results](docs/verification-results.md) describe the precise scope and remaining rollout work.

## Before a real merchant launch

The hosted test configuration supports synthetic testing of the existing MVP. Before a real merchant launch, disable `HOSTED_TEST_MODE`, set `DEMO_MODE=false`, configure and exercise real SMS and hosted PostgreSQL, complete merchant email verification/password recovery, run a PostgreSQL concurrency and backup-restore drill, and agree on support ownership and privacy/retention procedures. Deletion and assisted recovery are review requests, not completed automated operations. Subscription status is manual; no billing is charged. Wallet passes, messaging campaigns, points, multi-location support and POS connections are later phases.
