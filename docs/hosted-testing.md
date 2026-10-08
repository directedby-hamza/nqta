# Hosted testing on phone and computer

Open **[https://nqta-hamza-test.netlify.app](https://nqta-hamza-test.netlify.app)** on your phone and computer. The test application is published on **Netlify Free**, backed by a dedicated **Neon Free PostgreSQL database**. Its live browser/API smoke passed with **exit 0 at 2026-10-06 01:53:06.052 UTC**, covering simulated OTP, a member QR, a separate cashier session, five receipts, one redemption, replay protection, and logout/recovery. Both devices use this same origin and share saved test records. A further check passed after replacement deployment **`6ac454ffe559490685609057`**, retaining the original customer's balance and six activity events. The Render Blueprint remains an alternative; Free service creation requires payment information. See [deployment status](deployment-status.md).

`HOSTED_TEST_MODE=true` enables synthetic demo sign-in and displays verification codes in the interface. No SMS is sent. `NODE_ENV=production` keeps the production build and secure cookies. The browser first asks for HTTP Basic credentials: username **`nqta`**, password **the private `TEST_ACCESS_PASSWORD` configured on the selected host**. Staff sign-in inside the app is a separate step. The live smoke verified Basic protection on pages, APIs, and actual JavaScript/CSS assets, denied a wrong password, and confirmed Secure/HttpOnly/SameSite=Lax staff cookies. Only exact `/api/health` GET/HEAD requests bypass the access gate; both returned 200, while another unauthenticated method returned 401. Netlify's Production visibility is Public and Deploy Previews are Private; the app's Basic gate remains enabled.

Use invented names, test receipt references, and synthetic phone numbers. Anyone who knows the test access password can enter the demo and use its public sample staff accounts. Keep the password private and rotate it after sharing with testers.

## Shared application environment

Both hosting options use these six application variables. Keep private values outside Git. The user explicitly approved the Netlify credential transfer, and these application variables plus the two build variables were imported with production-only scope. This site's `APP_URL` is saved as `https://nqta-hamza-test.netlify.app`.

| Variable               | Hosted test value                                         |
| ---------------------- | --------------------------------------------------------- |
| `NODE_ENV`             | `production`                                              |
| `HOSTED_TEST_MODE`     | `true`                                                    |
| `DATABASE_URL`         | Dedicated Neon test PostgreSQL connection string with TLS |
| `APP_URL`              | Exact assigned HTTPS origin, with no path or query        |
| `SESSION_SECRET`       | Random private secret, at least 32 characters             |
| `TEST_ACCESS_PASSWORD` | Random private password, at least 16 characters           |

## Deploy on Netlify Free: selected host

Netlify permits commercial projects on its no-card Free plan. The actual **`directedby-hamza`** team's **Usage & billing** screen confirms **Free, 300 credits/month, no payment method, and no billing details**. Current credit-based Free accounts have a hard limit. Use this ongoing Free plan without paid upgrades or add-ons. [Netlify Free announcement](https://www.netlify.com/blog/introducing-netlify-free-plan/), [current credit-based pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

1. Import the published `directedby-hamza/nqta` GitHub repository into the **directedby-hamza** Free team. Keep the GitHub app limited to that repository and select branch `main`. This import has created **`nqta-hamza-test`**, site ID `e12fa69f-4793-4f85-983b-e35c5afa3778`, with detected framework **Next.js**, build command **`npm run build`**, and publish directory **`.next`**.
2. Set the build environment **`NODE_VERSION=24.21.0`** and **`NPM_FLAGS=--include=dev`**. The second flag installs the TypeScript and Tailwind build tools when `NODE_ENV=production` is present. [Netlify build dependency configuration](https://docs.netlify.com/build/configure-builds/manage-dependencies/).
3. Configure the six application variables above for the deployed server runtime. The user-approved import is complete: eight application/build variables are limited to the **Production** deploy context and **Builds, Functions, and Runtime** scopes, with **Contains secret** enabled. `APP_URL` is saved as **`https://nqta-hamza-test.netlify.app`**, and the private local hosted-test environment matches it. A local origin, join-page path, or another deploy's origin will fail the application's mutation-origin checks.
4. Let Netlify apply its automatic **OpenNext adapter** for Next.js. It prepares serverless functions for the app's dynamic pages and route handlers. The application code, HTTP Basic gate, and secure-cookie settings remain unchanged. The full offline compatibility build with adapter **5.16.2**, Node **24.21.0**, and Next.js **16.3.8** passed, including type checks, page generation, traces, server-function packaging, and Node-proxy Edge-function packaging; that isolated run used only dummy environment values. The third and fourth actual hosted deploys are confirmed **Published / Building Complete / Deploying Complete**; live authentication/loyalty checks and post-redeploy persistence passed against Neon. [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).
5. After each deployment, verify unauthenticated `/api/health`, password protection on pages/API/static assets, and the phone/computer workflow below. These checks passed after the fourth published deploy. Fresh owner/cashier sessions read the original customer's **5 total stamps, progress 0, and 1 redeemed reward**, with exactly **five qualifying 25 MAD purchase events and one redemption**. Use the already seeded dedicated Neon database; hosted requests do not seed it again.

The first hosted build, **`6ac44eceac975ec9810c4d4e`**, stopped on secret-scanning false positives for `APP_URL`, `NODE_ENV`, `NODE_VERSION`, and `NPM_FLAGS`, which the whole environment import had marked secret. Second build **`6ac450a4226fe92417f2d012`** repeated three public-key detections because the scanner-exception save had not passed Netlify's sensitive-value confirmation; the corrected `APP_URL` was not flagged there. Neither failed log detected a private credential. The public setting **`SECRETS_SCAN_OMIT_KEYS=APP_URL,NODE_ENV,NODE_VERSION,NPM_FLAGS,HOSTED_TEST_MODE`** is retained after **Save without marking as secret**, and third deploy **`6ac4524072eb0c3479ca50c3`** is confirmed **Published**. Its actual log confirms **511 files scanned with no secrets detected**. The database URL, session secret, and test access password remain scanned. The initial platform-visibility `401` was resolved by saving Production Public and Deploy Previews Private; the subsequent live smoke passed. [Netlify secret-scanning configuration](https://docs.netlify.com/build/environment-variables/secrets-controller/#configure-secret-scanning).

Netlify Functions for new Free sites use the default **Ohio (`cmh`)** region. The existing Neon database is in **Singapore**, so expect additional database round-trip latency during testing. Function-region customization is documented for Pro/Enterprise plans; the selected deployment stays Free. [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/).

Read-only live checks also opened owner overview, customers (**13**), programme, and settings/team (**2 staff**). Fresh **390px** join/sign-in pages had no overflow or browser errors. Netlify's optional badge is disabled; a fresh **390×844** join-page check confirmed the phone input was uncovered and the document width was 390px. These checks use a simulated mobile viewport. Physical phones/cameras, real SMS, the live interrupted-confirmation UI, and backup/restore remain untested. English/LTR is the current MVP interface; there is no Arabic language switch. The existing local regression tests remain the evidence for their covered behaviours.

## Render Blueprint: alternative host

Render Free creation was retried after its GitHub app connection, using only nonsecret configuration, and still returned **HTTP 402 requiring payment information**. No Render service exists. The instructions below describe the retained alternative configuration; they do not establish that the account can provision it without that requirement.

1. Create a new Neon project on the **Free** plan for this test only. Choose a region close to the Render service; the Blueprint uses Frankfurt. In Neon's **Connect** panel, copy the PostgreSQL connection string with its TLS options intact. Use a direct connection for the one-time database setup; the app can use the pooled connection. [Neon connection guide](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md).
2. Publish this app repository to a Git provider connected to Render. The repository root must contain `package.json` and `render.yaml`. If a different repository wraps the app in an `nqta/` directory, set `rootDir: nqta` and the Blueprint path accordingly.
3. In Render, create a Blueprint from `render.yaml`. Supply the dedicated test `DATABASE_URL` when prompted. The Blueprint selects the Free Node service, pins Node 24.21.0, builds with `npm ci --include=dev && npm run build`, and starts with `npm run start`. Including development dependencies installs the TypeScript and Tailwind build tools even with `NODE_ENV=production`. [npm install options](https://docs.npmjs.com/cli/v11/commands/npm-ci/#include).
4. `APP_URL` references the service's assigned `RENDER_EXTERNAL_URL`. Render generates `SESSION_SECRET` and `TEST_ACCESS_PASSWORD`; retrieve those privately from the service's environment settings. If you rename the service in the Blueprint, also update the self-reference under `APP_URL`. [Render Blueprint reference](https://render.com/docs/blueprint-spec), [Render default environment variables](https://render.com/docs/environment-variables).
5. Seed the empty test database once using the instructions below. After the deployment succeeds, open its assigned HTTPS URL on both devices and enter the HTTP Basic credentials. Confirm the hosted test notice appears and a displayed verification code completes enrolment.

For a service created through the Render API or manually instead of a Blueprint, use these same build/start settings and environment values. Set `APP_URL` to its assigned HTTPS origin after service creation, then deploy with that value before testing. Do not put a local URL or a path such as `/join/morrow` in `APP_URL`.

Use the shared application environment above. The Render Blueprint additionally sets `NODE_VERSION=24.21.0`, supplies `APP_URL` through its self-reference, and generates the two private secrets.

`npm run start` binds to `0.0.0.0` and Next.js reads Render's `PORT` environment variable. The health path is `/api/health`. Automatic deployments are off; use **Manual Deploy** for later code updates. [Render web service guide](https://render.com/docs/web-services), [Render Blueprint reference](https://render.com/docs/blueprint-spec).

## Seed the dedicated database once

Hosted requests do not automatically seed demo data. The existing dedicated Neon project is already fully seeded; see [deployment status](deployment-status.md) for independent verification. For a fresh, empty test database, install the pinned dependencies from a trusted computer with `npm ci --include=dev`. Create a private `.env.hosted-test` file in the app directory containing the application variables above, using the assigned HTTPS origin and the same secrets as the host. `.env*` files are ignored by Git except `.env.example`.

Check that `DATABASE_URL` selects the dedicated, empty test database, then run the seed entry point directly with the pinned Node 24 binary and the `tsx` loader:

```sh
./node_modules/.bin/node --env-file=.env.hosted-test --import tsx src/server/db/seed.ts
```

Running the entry point in this same process applies the private env file to the seed operation. This explicitly runs synthetic seeding with `NODE_ENV=production` and `HOSTED_TEST_MODE=true`. It creates the schema and Morrow Coffee sample workspace; it does not copy your local PGlite records. The seed skips a database that already has a shop, so seed before creating a fresh shop. Keep this CLI operation separate from deployments and other seed runs. Render Free has no dashboard shell or one-off jobs. [Render Free limitations](https://render.com/docs/free).

## Test the customer and cashier together

Open the hosted service in the phone's browser and on the computer. HTTPS is required for secure sessions and camera permissions. Authorize the HTTP Basic gate on each device, including any separate browser or private window used below.

| Role    | App sign-in email   | App password    |
| ------- | ------------------- | --------------- |
| Owner   | `owner@nqta.demo`   | `NqtaDemo2026!` |
| Cashier | `cashier@nqta.demo` | `NqtaDemo2026!` |

1. On the computer, sign in as owner and open **Loyalty programme**. Display or download its enrolment QR. On the phone, scan that poster QR or open `/join/morrow` at the hosted origin.
2. Join with a new synthetic number, for example `+212600000099`, and an invented name. Enter the **displayed test verification code**. The phone opens the customer card with its member QR and code. The enrolment poster QR opens a join page; the cashier scans the member QR inside the card.
3. On the computer, open **Cashier**, choose **Scan customer card**, and allow camera access. Hold the phone card QR to the computer camera. If the computer has no camera or permission is denied, enter the member code shown on the phone.
4. Record a qualifying paid test receipt for `25.00` MAD with a unique receipt reference. Choose **Review purchase**, then **Confirm purchase**. Refresh the phone card and confirm one stamp. Repeat with four separate receipt references; the fifth qualifying purchase unlocks a coffee reward. A new customer starts at zero stamps.
5. On the phone, choose **Use reward** to generate its two-minute confirmation code. On the computer, choose **Redeem reward**, enter that code, and **Confirm redemption**. Refresh both devices: the reward is used once and the activity contains the redemption. A reward-only receipt does not earn a stamp.
6. Recover the phone card in another browser using the same synthetic phone number and the displayed verification code. The same member and progress should return. For a shorter path, recover sample number `+212600000001` or find `NQ-DEMO0001` in Cashier; this sample starts with four purchases, so its next qualifying receipt unlocks a reward.

## Cover the rest of the existing MVP

- **New workspace and rules:** choose **Create your shop**, use invented owner details, save a first programme draft, review and publish it, then enrol another synthetic customer through its own QR. Check that its members and activity stay separate from Morrow Coffee. Published economic rules remain locked; test draft edits before publishing.
- **Branding and pause:** change the new shop's branding in **Settings**, then pause and resume the programme. While paused, new enrolment and earning stop; existing cards and earned rewards remain available.
- **Staff roles:** invite a cashier through **Settings**, accept its single-use link in a separate browser, and test purchases with that account. Verify owner-only programme/settings/reversal/export actions are unavailable to the cashier, then revoke the account and confirm it loses access.
- **Reporting:** search and filter customers, inspect a customer detail, change activity dates/filters, and export the owner CSV. Check that a test purchase and redemption appear and that exported contact numbers are absent.
- **Refund correction:** as owner, reverse a test purchase in **Activity** with an invented refund reason. Check the stamp is reversed. If the associated reward was already enjoyed, check the reconciliation flag; the app records the correction and does not refund a real payment.
- **Preferences and requests:** on the phone card, change SMS/WhatsApp preferences, refresh, and confirm they persist. Submit a deletion request and inspect the owner request queue. Deletion and assisted recovery remain review requests in this MVP.
- **Interrupted confirmation:** if a purchase or redemption response is interrupted, reload the cashier and use **Resume pending confirmation** to resolve that same saved action before creating another receipt. Confirm it appears only once in activity.
- **Persistence:** reload both devices, sign out/in, and repeat after a fresh Netlify function instance or a new deployment; for the alternative Render host, also test a service restart. Records should remain in Neon. `SESSION_SECRET` rotation invalidates outstanding verification codes. Revoke stored sessions explicitly when access must be removed.

## Free host behaviour and real launch

Netlify Free's 300 monthly credits cover metered deployments, function compute, traffic, and bandwidth. Monitor usage against the hard limit; no paid recharge is configured. Persistent test records belong in Neon rather than a function's local filesystem. [Current Netlify credit-based pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

For the retained alternative, Render Free sleeps after 15 minutes without traffic; opening the app again can take about a minute. Its local files disappear on restart, redeploy or sleep, so hosted testing requires PostgreSQL. Free usage allowances can suspend the service or prevent further builds. [Render Free limitations](https://render.com/docs/free).

This environment exercises the existing MVP with saved synthetic data and simulated phone verification. It does not test real SMS delivery, billing, POS payments, automated deletion, or other future features. For real merchant use, disable `HOSTED_TEST_MODE`, set `DEMO_MODE=false`, and complete the requirements in [production readiness](production-readiness.md), including `SMS_PROVIDER=twilio`, provider credentials, database concurrency and backup/restore checks. Keep the test database separate from customer data.
