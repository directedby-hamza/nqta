# Hosted test deployment status

The founder authorized free hosting so the same application can be tested from phone and computer. The selected deployment is a Render Free Node web service and a dedicated Neon Free PostgreSQL database. No paid resource, billing setup, or live SMS is authorized or provisioned.

## Prepared

- Render Blueprint pins the existing Node/Next.js stack, binds to the assigned port on `0.0.0.0`, uses a liveness endpoint, and supplies its assigned HTTPS origin.
- Explicit `HOSTED_TEST_MODE=true` enables simulated verification and demo access without changing production cookies. It requires PostgreSQL, HTTPS, a session secret, and a private test access password.
- HTTP Basic access protects every page and API before data access; the API repeats the check. Only exact health GET/HEAD requests are public. Existing staff/customer session authorization remains enforced.
- Hosted seeding is an explicit one-time operation against the dedicated test database. Runtime requests never automatically seed it.
- Shared-data labels and the complete phone/computer testing checklist are in [hosted testing](hosted-testing.md).

## External access pending

Render and Neon integrations were discovered and suggested, but neither connection has been confirmed. No local hosting credential is available. The founder supplied [directedby-hamza/nqta](https://github.com/directedby-hamza/nqta), an empty public repository. The connected GitHub account is still `jungleclients-ops`; repository metadata confirms read access but no push permission. The founder chose to reconnect GitHub as `directedby-hamza`; that browser sign-in has not yet completed.

No service or cloud database has been created, no source has been uploaded, and no live URL is claimed. Once access is available, publish the verified source, create only free resources, seed the dedicated database, and verify enrolment, purchases, redemption, recovery, and persistent shared records at the deployed HTTPS origin.

## Verification

The hosted production verification/recovery regression was observed failing when the implementation still required SMS, then passing with the explicit validated test environment. Missing access configuration refuses verification; ordinary production still refuses simulated codes even with `DEMO_MODE=true`. Additional access-gate checks cover unauthorized pages, APIs/static files, invalid passwords, invalid configuration, and the precise liveness exception.

A fresh independent code review found no Critical or Important defects in these hosting changes. Local database tests use real PGlite records and do not establish a live PostgreSQL connection.

- Full database/unit suite: **71/71 passed**, 12 files, 203.61s. Includes production-mode simulated verification/recovery, fail-closed configuration and ordinary production denial.
- Access-gate mutation proof: deliberately reversing the gate's environment branch caused **15/16 security assertions to fail**. Restoring the exact source yielded **19/19** focused gate and hosted-verification checks passing.
- Strict TypeScript: `npm run typecheck` passed.
- Next.js production build: `npm run build` passed, including Node proxy and the health route; compilation took 7.8s.
- Production Chromium access smoke: password protection, mobile landing/assets, browser credential reuse, unauthenticated health and foreign-origin mutation rejection all passed. This used an unreachable local PostgreSQL URL and deliberately avoided database access; cloud persistence is pending.
- Full Chromium loyalty journeys: **14/14 passed**, 1.7m, including customer enrolment, five receipts, single reward redemption, recovery, roles, publishing, paused recovery and uncertain confirmation retries.
- Render YAML parsing, environment example parsing, formatting and `git diff --check` passed. The supplied GitHub URL is configured as the local `origin`; no push occurred.
