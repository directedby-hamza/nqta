# Hosted testing on phone and computer

The deployment configuration is prepared for **Render Free Node hosting + a dedicated Neon Free PostgreSQL database**. This document does not establish that a service is live: use the actual HTTPS URL from a successful Render deployment. Both devices use that same URL and share the saved test database.

`HOSTED_TEST_MODE=true` enables synthetic demo sign-in and displays verification codes in the interface. No SMS is sent. `NODE_ENV=production` keeps the production build and secure cookies. The browser first asks for HTTP Basic credentials: username **`nqta`**, password **the private `TEST_ACCESS_PASSWORD` configured on Render**. Staff sign-in inside the app is a separate step. All application routes require this access gate except the exact `/api/health` endpoint, which returns basic process health without opening the database.

Use invented names, test receipt references, and synthetic phone numbers. Anyone who knows the test access password can enter the demo and use its public sample staff accounts. Keep the password private and rotate it after sharing with testers.

## Deploy the test service

1. Create a new Neon project on the **Free** plan for this test only. Choose a region close to the Render service; the Blueprint uses Frankfurt. In Neon's **Connect** panel, copy the PostgreSQL connection string with its TLS options intact. Use a direct connection for the one-time database setup; the app can use the pooled connection. [Neon connection guide](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md).
2. Publish this app repository to a Git provider connected to Render. The repository root must contain `package.json` and `render.yaml`. If a different repository wraps the app in an `nqta/` directory, set `rootDir: nqta` and the Blueprint path accordingly.
3. In Render, create a Blueprint from `render.yaml`. Supply the dedicated test `DATABASE_URL` when prompted. The Blueprint selects the Free Node service, pins Node 24.21.0, builds with `npm ci --include=dev && npm run build`, and starts with `npm run start`. Including development dependencies installs the TypeScript and Tailwind build tools even with `NODE_ENV=production`. [npm install options](https://docs.npmjs.com/cli/v11/commands/npm-ci/#include).
4. `APP_URL` references the service's assigned `RENDER_EXTERNAL_URL`. Render generates `SESSION_SECRET` and `TEST_ACCESS_PASSWORD`; retrieve those privately from the service's environment settings. If you rename the service in the Blueprint, also update the self-reference under `APP_URL`. [Render Blueprint reference](https://render.com/docs/blueprint-spec), [Render default environment variables](https://render.com/docs/environment-variables).
5. Seed the empty test database once using the instructions below. After the deployment succeeds, open its assigned HTTPS URL on both devices and enter the HTTP Basic credentials. Confirm the hosted test notice appears and a displayed verification code completes enrolment.

For a service created through the Render API or manually instead of a Blueprint, use these same build/start settings and environment values. Set `APP_URL` to its assigned HTTPS origin after service creation, then deploy with that value before testing. Do not put a local URL or a path such as `/join/morrow` in `APP_URL`.

| Variable               | Hosted test value                                                       |
| ---------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`             | `production`                                                            |
| `NODE_VERSION`         | `24.21.0`                                                               |
| `HOSTED_TEST_MODE`     | `true`                                                                  |
| `DATABASE_URL`         | Dedicated test PostgreSQL connection string with TLS                    |
| `APP_URL`              | Exact assigned HTTPS origin; Blueprint self-reference supplies it       |
| `SESSION_SECRET`       | Random secret, at least 32 characters; Blueprint generates it           |
| `TEST_ACCESS_PASSWORD` | Random private password, at least 16 characters; Blueprint generates it |

`npm run start` binds to `0.0.0.0` and Next.js reads Render's `PORT` environment variable. The health path is `/api/health`. Automatic deployments are off; use **Manual Deploy** for later code updates. [Render web service guide](https://render.com/docs/web-services), [Render Blueprint reference](https://render.com/docs/blueprint-spec).

## Seed the dedicated database once

Hosted requests do not automatically seed demo data. From a trusted computer, install the pinned dependencies with `npm ci --include=dev`. Create a private `.env.hosted-test` file in the app directory containing the seven variables in the table above, using the assigned HTTPS URL and the same secrets as the service. `.env*` files are ignored by Git except `.env.example`.

Check that `DATABASE_URL` selects the dedicated, empty test database, then run the existing `db:seed` script with Node 24:

```sh
./node_modules/.bin/node --env-file=.env.hosted-test --run db:seed
```

This explicitly runs synthetic seeding with `NODE_ENV=production` and `HOSTED_TEST_MODE=true`. It creates the schema and Morrow Coffee sample workspace; it does not copy your local PGlite records. The seed skips a database that already has a shop, so seed before creating a fresh shop. Keep this CLI operation separate from deployments and other seed runs. Render Free has no dashboard shell or one-off jobs. [Render Free limitations](https://render.com/docs/free).

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
- **Persistence:** reload both devices, sign out/in, and repeat after a Render restart or manual redeploy. Records should remain in Neon. Browser sessions may require sign-in again if you rotate `SESSION_SECRET`.

## Free host behaviour and real launch

Render Free sleeps after 15 minutes without traffic; opening the app again can take about a minute. Its local files disappear on restart, redeploy or sleep, so hosted testing requires PostgreSQL. Free usage allowances can suspend the service or prevent further builds. [Render Free limitations](https://render.com/docs/free).

This environment exercises the existing MVP with saved synthetic data and simulated phone verification. It does not test real SMS delivery, billing, POS payments, automated deletion, or other future features. For real merchant use, disable `HOSTED_TEST_MODE`, set `DEMO_MODE=false`, and complete the requirements in [production readiness](production-readiness.md), including `SMS_PROVIDER=twilio`, provider credentials, database concurrency and backup/restore checks. Keep the test database separate from customer data.
