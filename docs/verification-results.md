# Verification evidence

5 October 2026, local macOS workspace. Runtime: project-local Node 24.21.0.

- Database and unit tests: **52 passed in 10 files**, 110.40s. Actual PostgreSQL-compatible PGlite databases; no mocked loyalty balances. A separate controlled waiting-lock test verifies authorization after a revocation commits. Lost commit acknowledgement and explicit business rejection are also covered.
- Browser journeys: **14 passed**, Chromium, 1.1m. Joining, five paid receipts, single redemption, original-card recovery, owner/cashier access, new-shop publication, camera denial/manual fallback, keyboard focus, reduced motion, narrow layouts, a lost-response retry, delayed saving, stale-tab publication, paused recovery entry, durable purchase/redemption recovery after reload, unclassified server-error recovery, and the exact staff invitation link.
- TypeScript: `npm run typecheck` passed with strict checking.
- Production build: the final Next.js 16.3.8 Webpack build passed, including TypeScript, page generation and all listed routes. Compilation completed in 5.4s.
- Screenshots inspected: landing and overview on desktop; enrolment, customer lists and the customer reward card on mobile. Customer/activity rows adapt to readable cards on small screens.
- Dependency installation reported **0 known vulnerabilities** in its audit; this is not a penetration test.

The browser suite uses synthetic data and makes no real SMS, billing or Wallet calls. Phone-camera hardware on real iOS/Android devices, hosted PostgreSQL multi-process concurrency, provider delivery and full backup restoration remain pilot/production checks.

Initial failures were reproduced and corrected: fresh nested data directory creation, canonical browser origin, failed-code attempt persistence, unsaved programme publication, dialog focus restoration, and narrow decorative overflow. Resource-heavy checks are run sequentially after simultaneous build/testing exhausted the 30-second fixture boot window. Test timeouts were not enlarged to hide these failures.

The fresh whole-project review found seven Important issues; each entered one regression-driven fix pass. See [review disposition](final-review.md) and [execution ledger](progress.md) for reproductions, fixes, scope rulings and the three deferred Minor findings. The isolated seed CLI also completed successfully on a separate fresh data directory.

Two later verification runs were interrupted by laptop sleep, producing fixture timeouts with approximately 930-second gaps. The macOS power log confirmed those sleep intervals. The final database run used temporary process-scoped sleep prevention and passed with the existing 30-second hook limits; no timeout or assertion was relaxed.

## Hosted testing preparation

The later hosting changes passed **71/71 database/unit tests** in 12 files (203.61s), **14/14 Chromium journeys** (1.7m), strict TypeScript, the Next.js Webpack production build, Render YAML parsing and environment parsing. An independent review found no Critical or Important defect. Production Chromium additionally verified password gating, mobile assets, cached browser credentials, health and foreign-origin rejection.

The source is now fully published to `directedby-hamza/nqta`, with all 96 local source blobs verified against the publication snapshot. On **6 October 2026 at 00:57:29.714 UTC**, independent Neon verification confirmed **12 memberships, 99 events, and 99 saved actions**, sample card `NQ-DEMO0001` at **4 of 5 stamps**, and TLS enabled on the actual Node `pg` connection. These cloud seed checks supplement the local PGlite tests; they do not establish a deployed application workflow.

Render Free creation was retried after the repository app connection with only nonsecret settings and still returned HTTP 402 requiring payment information; no service was created. Netlify Free is now selected. Its Nqta team is created, GitHub directedby-hamza is connected with repository-only app access, and the main-branch Next.js import form is ready with build npm run build and output .next. No Netlify deployment has been submitted. Adapter 5.16.2 compatibility build verification remains pending.

Earlier automatic approval review rejected transferring the private credentials to Render without explicit permission. The current permission question targets Netlify and supersedes that Render question; no approval reply has arrived and no credentials have been entered into Netlify. No deployed application or live URL exists. Live phone/computer QA, the Netlify access gate, and application persistence across fresh function instances or redeploy remain pending; see [deployment status](deployment-status.md) for the exact boundary and [hosted testing](hosted-testing.md) for phone/computer steps.
