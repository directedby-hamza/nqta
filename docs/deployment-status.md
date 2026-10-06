# Hosted test deployment status

The founder authorized free hosting so the same application can be tested from phone and computer. The source is published, and the dedicated Neon Free PostgreSQL database is fully seeded and independently verified. **Netlify Free** is now selected after Render Free creation continued to require payment information. The Netlify import form is prepared, but explicit permission to transfer its private credentials is pending. No credentials have been transferred to Netlify. No paid resource, billing setup, or live SMS is authorized or provisioned. No deployed application or live application URL exists yet.

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

Netlify's **Nqta** Free team has been created, signed in through GitHub as `directedby-hamza`. Its GitHub app is installed only for `directedby-hamza/nqta`, and branch `main` is selected. The Next.js import form is ready with build command `npm run build` and publish directory `.next`; import/deployment has not been submitted. Its environment controls are prepared for the production deploy context with private entries marked **Contains secret**, but the value textarea remains empty and no actual environment values have been created. Netlify Free supports commercial projects without a card; current Free accounts receive **300 monthly credits with a hard limit**. [Free-plan announcement](https://www.netlify.com/blog/introducing-netlify-free-plan/), [current pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

## Dedicated cloud database: seed complete

Neon project `holy-fire-28396345` uses the **Free plan**, **PostgreSQL 18**, and the **Singapore region**. Schema tables and synthetic Morrow Coffee records have been created in that dedicated database.

Independent verification at **2026-10-06 00:57:29.714 UTC** confirmed the complete seed: **12 memberships, 99 events, and 99 saved actions**. Sample card `NQ-DEMO0001` has **4 stamps toward its 5-stamp reward**. The actual Node `pg` client connection also confirmed socket TLS was enabled. Database connection details and private test secrets are kept outside the repository.

## Permission pending for Netlify credentials

Earlier automatic approval review rejected transferring `DATABASE_URL`, `SESSION_SECRET`, and `TEST_ACCESS_PASSWORD` from the local private `.env.hosted-test` file to Render without explicit user permission. That Render permission request is superseded by the host change. The current question explicitly requests permission to transfer those credentials to **Netlify**. No approval reply has been received, no credentials have been entered into Netlify, and no application deployment has occurred.

## Live verification pending

After permission for the Netlify credential transfer is resolved, submit only the Free project deployment, configure its assigned canonical HTTPS origin, and run the hosted enrolment, five-receipt purchase, redemption, recovery, and shared-record checks. A standalone live Playwright smoke script is prepared, but has not been run against a deployed application. Live phone/computer QA, Netlify's deployed access gate, and application persistence after a fresh function instance or redeploy remain pending.

## Verification

The hosted production verification/recovery regression was observed failing when the implementation still required SMS, then passing with the explicit validated test environment. Missing access configuration refuses verification; ordinary production still refuses simulated codes even with `DEMO_MODE=true`. Additional access-gate checks cover unauthorized pages, APIs/static files, invalid passwords, invalid configuration, and the precise liveness exception.

A fresh independent code review found no Critical or Important defects in these hosting changes. The automated local database tests use real PGlite records. Separate cloud verification confirmed the full Neon seed and an actual TLS-enabled PostgreSQL connection. These checks do not establish a deployed application's PostgreSQL connection or the complete cloud loyalty workflow.

- Full database/unit suite: **71/71 passed**, 12 files, 203.61s. Includes production-mode simulated verification/recovery, fail-closed configuration and ordinary production denial.
- Access-gate mutation proof: deliberately reversing the gate's environment branch caused **15/16 security assertions to fail**. Restoring the exact source yielded **19/19** focused gate and hosted-verification checks passing.
- Strict TypeScript: `npm run typecheck` passed.
- Next.js production build: `npm run build` passed, including Node proxy and the health route; compilation took 7.8s.
- Full offline Netlify Build: **exit 0**, **1m 56.6s**, with Node **24.21.0**, Next.js **16.3.8**, TypeScript **7**, and adapter **5.16.2**. The unchanged `next build --webpack` command passed type checking, page generation, build traces, Node server-function packaging, and Node-proxy Edge-function packaging. This used dummy environment values, no real credentials, and no deployment or live runtime QA.
- Production Chromium access smoke: password protection, mobile landing/assets, browser credential reuse, unauthenticated health and foreign-origin mutation rejection all passed. This used an unreachable local PostgreSQL URL and deliberately avoided database access; cloud persistence is pending.
- Full Chromium loyalty journeys: **14/14 passed**, 1.7m, including customer enrolment, five receipts, single reward redemption, recovery, roles, publishing, paused recovery and uncertain confirmation retries.
- Render YAML parsing, environment example parsing, formatting and `git diff --check` passed. The supplied GitHub URL is configured as the local `origin`; source publication subsequently succeeded through the manual import workflow described above.
