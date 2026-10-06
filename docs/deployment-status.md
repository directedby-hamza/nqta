# Hosted test deployment status

The founder authorized free hosting and explicitly approved transferring the test credentials to **Netlify Free**. The test application is published at **[https://nqta-hamza-test.netlify.app](https://nqta-hamza-test.netlify.app)**, backed by the dedicated Neon Free PostgreSQL database. The live browser/API smoke passed with **exit 0 at 2026-10-06 01:53:06.052 UTC**, including enrolment, five purchases, redemption, replay protection, recovery, and shared saved records. A subsequent check passed after replacement deployment **`6ac454ffe559490685609057`**, confirming the original customer balance and six activity events persisted. The application's Basic authentication remains enabled. The actual Netlify team is confirmed Free with no payment method or billing details; no paid resource or live SMS is provisioned.

## Prepared

- Render Blueprint pins the existing Node/Next.js stack, binds to the assigned port on `0.0.0.0`, uses a liveness endpoint, and supplies its assigned HTTPS origin.
- Netlify import detects Next.js with build `npm run build` and publish directory `.next`; Node 24 and automatic adapter configuration are documented. The full offline compatibility build with adapter 5.16.2 passed, including server-function and Node-proxy Edge-function packaging.
- Explicit `HOSTED_TEST_MODE=true` enables simulated verification and demo access without changing production cookies. It requires PostgreSQL, HTTPS, a session secret, and a private test access password.
- HTTP Basic access protects every page and API before data access; the API repeats the check. Only exact health GET/HEAD requests are public. Existing staff/customer session authorization remains enforced.
- Hosted seeding is an explicit one-time operation against the dedicated test database. Runtime requests never automatically seed it.
- Shared-data labels and the complete phone/computer testing checklist are in [hosted testing](hosted-testing.md).

## Published source and connected accounts

GitHub is connected as `directedby-hamza`. The application source was fully published to [directedby-hamza/nqta](https://github.com/directedby-hamza/nqta) through the manually invoked `import-source` workflow; [run 37395242138](https://github.com/directedby-hamza/nqta/actions/runs/37395242138) succeeded. At publication verification, all **96 local source blobs** matched the published repository. Its only additional file was `.github/workflows/import-source.yml`, which supports that manual import.

Render is connected to workspace `tea-db23eoijnfac73eota1g`. Its GitHub app was installed with access only to `directedby-hamza/nqta`, and normal browser email verification completed. Retrying service creation with **`plan=free` and only nonsecret variables** still returned **HTTP 402 requiring payment information**. No Render web service was created. The application code and retained alternative `render.yaml` remain unchanged.

Netlify's actual team is **`directedby-hamza`**, signed in through GitHub as the same account. Its **Usage & billing** screen confirms the **Free plan, 300 credits/month, and no payment method or billing details**. Its GitHub app is installed only for `directedby-hamza/nqta`, and branch `main` is selected. Site **`nqta-hamza-test`**, ID **`e12fa69f-4793-4f85-983b-e35c5afa3778`**, uses build command `npm run build` and publish directory `.next`. Eight environment variables were imported after explicit user approval, limited to the **Production** deploy context and the **Builds, Functions, and Runtime** scopes, with **Contains secret** enabled. `APP_URL` is saved as the canonical HTTPS origin, and the private local hosted-test environment matches it. Netlify Free supports commercial projects without a card and has a hard credit limit. [Free-plan announcement](https://www.netlify.com/blog/introducing-netlify-free-plan/), [current pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

## Dedicated cloud database: seed complete

Neon project `holy-fire-28396345` uses the **Free plan**, **PostgreSQL 18**, and the **Singapore region**. Schema tables and synthetic Morrow Coffee records have been created in that dedicated database.

Independent verification at **2026-10-06 00:57:29.714 UTC** confirmed the complete seed: **12 memberships, 99 events, and 99 saved actions**. Sample card `NQ-DEMO0001` has **4 stamps toward its 5-stamp reward**. The actual Node `pg` client connection also confirmed socket TLS was enabled. Database connection details and private test secrets are kept outside the repository.

## Authorized Netlify import and published builds

The user explicitly approved exporting `DATABASE_URL`, `SESSION_SECRET`, and `TEST_ACCESS_PASSWORD` to Netlify. That authorized transfer is complete. The earlier Render automatic-review rejection is historical and is not a current permission blocker. Private values remain outside the repository and are not recorded in these documents.

Hosted build **`6ac44eceac975ec9810c4d4e`** completed compilation and function/Edge packaging, then failed secret scanning because the whole environment import had also marked public values secret: `APP_URL`, `NODE_ENV`, `NODE_VERSION`, and `NPM_FLAGS`. Second build **`6ac450a4226fe92417f2d012`** repeated the `NODE_ENV`, `NODE_VERSION`, and `NPM_FLAGS` detections because the scanner-exception save had not been retained through Netlify's sensitive-value confirmation; the corrected `APP_URL` was not flagged in that build. Neither failed log detected a private credential.

The public setting **`SECRETS_SCAN_OMIT_KEYS=APP_URL,NODE_ENV,NODE_VERSION,NPM_FLAGS,HOSTED_TEST_MODE`** is saved after confirming **Save without marking as secret**, using Netlify's documented key-specific exception. `DATABASE_URL`, `SESSION_SECRET`, and `TEST_ACCESS_PASSWORD` remain scanned; secret scanning is enabled. Netlify's GUI reports third deploy **`6ac4524072eb0c3479ca50c3`** as **Published**, with **Building Complete** and **Deploying Complete**. The live smoke below exercised this published deploy. [Netlify secret-scanning configuration](https://docs.netlify.com/build/environment-variables/secrets-controller/#configure-secret-scanning).

## Live verification and redeploy persistence passed

The initial `401` came from Netlify's platform visibility gate. **Production: Public** and **Deploy Previews: Private** are now saved and confirmed, while the application's Basic authentication remains enabled. The live smoke finished with **exit 0 at 2026-10-06 01:53:06.052 UTC**:

- Health **GET/HEAD returned 200**; another unauthenticated method returned **401**. Pages, API routes, and actual JavaScript/CSS assets required Basic access; a wrong password was denied.
- Staff sign-in issued **Secure, HttpOnly, SameSite=Lax** cookies. Role permissions, owner export, and foreign-origin rejection passed.
- A **390px mobile browser viewport** completed simulated-OTP enrolment and displayed a member QR. A separate cashier session found the new member. Five unique test receipts produced **5 total stamps and one reward**.
- Same-key purchase and redemption retries were idempotent; redemption replay with a different key was denied. The member's activity contained exactly **5 purchase events and 1 redemption event**.
- Logout revoked the server token. Fresh mobile verification recovered the same card. A fresh owner session and reloaded cashier showed **5 total stamps, cycle progress 0, and 1 redeemed reward**. No browser JavaScript errors were recorded. The canonical site also opened in desktop Chrome with the owner overview signed in.

Fourth deploy **`6ac454ffe559490685609057`** is confirmed **Published / Building Complete / Deploying Complete**. The subsequent browser/API check passed with **exit 0**: health and Basic gates still worked, fresh owner/cashier logins retained their roles and secure cookies, and both sessions read the original customer's **5 total stamps, progress 0, and 1 redeemed reward**. The same **six events** remained: **five qualifying 25 MAD purchases and one redemption**. Fresh pages reported no runtime errors. This verifies saved records across a replacement published deployment.

Read-only owner checks also opened overview, customers (**13**), programme, and settings/team (**2 staff**) with HTTP 200. Fresh **390px** mobile join/sign-in pages had no overflow or browser errors. Netlify's optional badge was disabled, and a fresh **390×844** join-page check confirmed no visible badge or covered phone input and a document width of 390px.

Physical phone/device and camera checks, real SMS delivery, the live interrupted-confirmation UI, and backup/restore remain untested. The interface still uses English/LTR with no Arabic language switch, as documented for the MVP. The existing local regression evidence remains available; these live checks cover the core loyalty flow, roles, shared records, and the listed read-only screens.

## Verification

The hosted production verification/recovery regression was observed failing when the implementation still required SMS, then passing with the explicit validated test environment. Missing access configuration refuses verification; ordinary production still refuses simulated codes even with `DEMO_MODE=true`. Additional access-gate checks cover unauthorized pages, APIs/static files, invalid passwords, invalid configuration, and the precise liveness exception.

A fresh independent code review found no Critical or Important defects in these hosting changes. The automated local database tests use real PGlite records. Separate cloud verification confirmed the full Neon seed and an actual TLS-enabled PostgreSQL connection. The live smoke above additionally exercised the published Netlify application against its shared Neon records.

- Full database/unit suite: **71/71 passed**, 12 files, 203.61s. Includes production-mode simulated verification/recovery, fail-closed configuration and ordinary production denial.
- Access-gate mutation proof: deliberately reversing the gate's environment branch caused **15/16 security assertions to fail**. Restoring the exact source yielded **19/19** focused gate and hosted-verification checks passing.
- Strict TypeScript: `npm run typecheck` passed.
- Next.js production build: `npm run build` passed, including Node proxy and the health route; compilation took 7.8s.
- Full offline Netlify Build: **exit 0**, **1m 56.6s**, with Node **24.21.0**, Next.js **16.3.8**, TypeScript **7**, and adapter **5.16.2**. The unchanged `next build --webpack` command passed type checking, page generation, build traces, Node server-function packaging, and Node-proxy Edge-function packaging. This used dummy environment values, no real credentials, and no deployment or live runtime QA.
- Actual Netlify builds: first **`6ac44eceac975ec9810c4d4e`** compiled and packaged, then failed on public-value scan detections; second **`6ac450a4226fe92417f2d012`** repeated three detections while the exception save was unconfirmed. Third **`6ac4524072eb0c3479ca50c3`** is confirmed **Published / Building Complete / Deploying Complete** after the public-key exception was retained. Its actual log records **Netlify Build Complete in 47.9s**, including Next.js **16.3.8** compilation in **11.6s**, function/Edge packaging in **2.4s/1.7s**, a **511-file secret scan with no secrets detected**, and deployment in **11s**. Node version is masked in the imported-secret log; the environment UI confirms **24.21.0**. The live smoke subsequently passed on this deploy.
- Local production Chromium access smoke: password protection, mobile landing/assets, browser credential reuse, unauthenticated health and foreign-origin mutation rejection all passed. This used an unreachable local PostgreSQL URL and deliberately avoided database access; the separate live smoke supplies cloud workflow evidence.
- Full Chromium loyalty journeys: **14/14 passed**, 1.7m, including customer enrolment, five receipts, single reward redemption, recovery, roles, publishing, paused recovery and uncertain confirmation retries.
- Render YAML parsing, environment example parsing, formatting and `git diff --check` passed. The supplied GitHub URL is configured as the local `origin`; source publication subsequently succeeded through the manual import workflow described above.
