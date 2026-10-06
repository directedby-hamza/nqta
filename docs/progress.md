# Execution ledger — plan: ../docs/superpowers/plans/2026-10-05-digital-loyalty-mvp.md

Execution: native, approved by the founder. Fresh repository on feat/loyalty-mvp in nqta/; report artifacts remain in the parent directory.

Pre-flight: Tasks 1→2→3→5 share shop scope, membership IDs, actor roles, and reward challenge ownership; implement one transactional service and shared actor type.
Pre-flight: Tasks 1→4 share ledger/reversal semantics; reports read confirmed events and explicit reversals rather than cached UI totals.
Pre-flight: Tasks 2→6 share owner permission enforcement and audit events; API handlers derive actor scope from sessions.
Pre-flight: Task 7 consumes all route journeys and validates browser behaviour.

Task 1: backend verified — 12/12 original loyalty integration tests RED→GREEN; full foundation suite 37/37 passed. Idempotency, unique entitlements, cross-shop access, concurrent redemption and reversals verified. UI integration remains in Tasks 2–7.
Tasks 2–3: service tests 16/16 RED→GREEN. Phone recovery, attempts, consent, owner actions and invitation reuse verified; route/UI work in progress.
Tasks 4 and 6: service tests 9/9 RED→GREEN. Honest metrics, date boundaries, missing amounts, publishing and paused earning verified.
Ruling: Use a tracked docs/progress.md ledger because the plan lives outside this new repository and there is no pre-existing base commit — this keeps recovery and final review evidence in the application history — cost if wrong: the skill helper scripts need a path adapter.
Ruling: Add fresh-workspace registration as well as demo sign-in — FR-01 needs a usable new-shop path — cost if wrong: email verification is still a production rollout dependency.
Task 5: Redemption attempt cap RED→GREEN; five failed guesses persist and require a fresh code.
Task 7: Persistence boot test reproduced ENOENT on a fresh nested directory; recursive directory creation fixes saved-database startup and reopen persistence.
Task 2: Browser sign-in reproduced Next’s internal localhost hostname differing from browser 127.0.0.1. Canonical APP_URL origin tests RED→GREEN preserve cross-origin rejection.
Ruling: Use Next’s supported Webpack production build after Turbopack failed to bind its compiler socket even with escalation — retain Turbopack for the working local dev server — cost if wrong: slower production compilation, with no change to the application’s behaviour.
Tasks 2–7: Browser suite 7/7 passed (2.0m). Real join→five purchases→redemption→phone recovery; owner/cashier permissions; new workspace and publication; camera denial/manual entry; focus restoration; mobile/reduced motion; interrupted-response retry verified.
Task 6: Unsaved programme fields could be published with a different saved promise; browser reproduction RED→GREEN now requires saving after edits.
Task 7: Dialog closure returned no focus; browser reproduction RED→GREEN restores the launch control. Mobile customers/activity use readable cards. Decorative landing orbits fit a 360px viewport.
Task 7: Heavy simultaneous build/browser/database runners caused 30s fixture boot timeouts. Final verification runs these resource-heavy checks sequentially; assertion failures are not hidden by increasing timeouts.
Task 3: Seven simultaneous verification requests reproduced a rate-limit race. An atomic database reservation bounds delivery requests across processes; verification secret validation precedes provider delivery.
Task 1: complete — real-database engine, new reward response identifier, idempotency, threshold, refund and challenge tests verified in the 45/45 full suite.
Task 2: complete — individual staff accounts, invitation/revocation, HttpOnly cookies, canonical origin checks, UI sign-in and owner/cashier isolation verified.
Task 3: complete — phone verification/recovery, consent history, bounded delivery reservations, owned card and customer confirmation verified.
Task 4: complete — saved-record reports, coverage labels, search, filters, details and authorised CSV export verified.
Task 5: complete — camera/manual lookup, review/confirm, single redemption, interrupted-response retry and owner corrections verified.
Task 6: complete — branding, immutable publication, QR poster, staff controls, support intake, pause and manual status implemented and verified.
Task 7: pre-review verification complete — full suite 45/45, browser 7/7, typecheck and production compilation passed; final formatted build and whole-project review follow.
Task 8: documentation complete — README setup/credentials/configuration, requirements/acceptance mapping, and explicit production dependency map. Final verification evidence will be recorded after review.
Final review: fresh gpt-6-astra reviewer assessed the whole repository at bd5b490. Re-graded by user effect: seven Important findings enter one TDD fix pass; no Critical findings. Three Minor findings remain deferred.
Final: minor (deferred): README's VERIFICATION_PROVIDER name differs from implemented SMS_PROVIDER; .env.example remains the correct reference.
Final: minor (deferred): support intake needs a visible member-code/detail link for customers with duplicate or empty names; membership_id remains available in the owner API for manual lookup.
Final: minor (deferred): transient join failure after successful verification requires requesting a fresh verification code rather than retrying join directly.
Final: Ruling: Live SMS delivery and carrier/provider behaviour remain rollout validation — local verification is explicitly simulated — cost if wrong: real messages may be delayed or fail at launch.
Final: Ruling: Email ownership verification, password recovery and MFA remain rollout work — individual local accounts satisfy the approved pilot — cost if wrong: public account recovery and takeover protections are incomplete.
Final: Ruling: Hosted PostgreSQL load, failover and encrypted backup/restore drills remain deployment gates — fix the concrete authorization race now — cost if wrong: hosted concurrency or recovery defects remain undiscovered.
Final: Ruling: One PGlite process owns one local data directory — documented deployment constraint — cost if wrong: multiple processes can contend or fail to open it.
Final: Ruling: Deletion, identity migration, account merging and programme transitions remain manual intake — preserve earned records pending owner review — cost if wrong: customers depend on timely human fulfilment.
Final: Ruling: Support completion/status administration remains manual — the owner can review saved requests — cost if wrong: request fulfilment cannot be tracked in the app.
Final: Ruling: Wallet, campaigns, points, POS, billing, multiple locations and configurable currencies/timezones remain later phases — the approved MVP uses receipts and MAD/Casablanca — cost if wrong: some shops need features this pilot lacks.
Final: Ruling: Privacy/retention wording and operating support commitments need launch-country review — local implementation is not legal certification — cost if wrong: launch policy may require changes.
Final: Ruling: Real iOS/Android cameras and additional browsers require pilot checks — Chromium proves the tested web journeys — cost if wrong: hardware/browser-specific failures remain.
Final: Ruling: WAF, global/IP abuse budgets, signup throttling and denial-of-service resistance remain public deployment work — repair the implemented email limiter now — cost if wrong: internet-scale abuse remains unbounded.
Final: Ruling: Duplicate physical receipts require a shared action identifier or unique receipt reference — identical amounts/times can represent separate purchases — cost if wrong: independently entered copies still require owner correction.
Final: Ruling: Issued staff invitations remain single-use and expiring after issuer revocation — invitation policy is unspecified — cost if wrong: a revoked owner’s pending invitation can still be accepted before expiry.
Final: Ruling: Revoked email reuse and one staff account spanning shops remain unsupported — accounts are individual and shop-scoped — cost if wrong: staff lifecycle changes need owner assistance or another email.
Final: Ruling: Customer display names remain global identity data — only the verified customer can set them on joining — cost if wrong: joining another shop can change the displayed name on prior cards.
Final: Ruling: Historical lists remain limited to the documented 150 activity/500 member rows and fixed reporting options — suitable for the local pilot — cost if wrong: larger shops need pagination and wider exports.
Final: Ruling: Dashboard queries may observe slightly different instants during activity — economic records remain transactional — cost if wrong: momentary figures may differ until refresh.
Final: Ruling: SQL bootstrap remains authoritative; unused Drizzle declarations need unification before generated migrations — current boot serves the existing pilot — cost if wrong: future generated migrations could miss fields.
Final: Ruling: Responsive layouts, focus and reduced motion form the verified accessibility baseline — no full certification claimed — cost if wrong: additional assistive-technology issues remain.
Final: Ruling: Transient sign-out/card-refresh and lost verification responses use retry or re-verification — no economic operation is duplicated by those paths — cost if wrong: customers may need another code or refresh.
Final: fixed publication binding and edits during saving — stale draft integration test and delayed/stale-tab browser tests RED→GREEN, suite 50/50, browser 13/13.
Final: fixed paused recovery — paused earned-card recovery/new-enrolment/redemption integration test and paused verification browser test RED→GREEN, suite 50/50, browser 13/13.
Final: fixed discarded uncertain operations — lost purchase/redemption responses followed by closure/reload browser tests RED→GREEN with exactly one economic event, suite 50/50, browser 13/13.
Final: fixed authorization before lock — controlled waiting-revocation test RED→GREEN; invites/profile/support checks moved inside their protected transactions, suite 50/50.
Final: fixed concurrent staff login limits — fifteen concurrent incorrect sign-ins now produce ten credential rejections and five early limit rejections RED→GREEN, suite 50/50.
Final: fixed invitation origin — browser reproduced localhost URL versus trusted 127.0.0.1; exact returned invitation now accepts a new account RED→GREEN, suite 50/50, browser 13/13.
Final: fixed fractional amounts — 25.50 and 0.01 currency test RED→GREEN plus mobile receipt confirmation assertion, suite 50/50, browser 13/13.
Final: Ruling: Preserve feat/loyalty-mvp locally because this fresh repository has no base branch or remote and the approved delivery is local — no integration target exists — cost if wrong: remote setup and integration remain a later step.
Task 7: complete — final database/unit suite 50/50 in 94.55s; complete Chromium browser suite 13/13 in 1.7m; no Critical or Important review finding remains unaddressed. Hosted/provider/hardware validation remains explicitly outside local evidence.
Final verification: two later runs timed out during fixture startup. macOS power logs confirm lid-closed maintenance sleep with roughly 930-second gaps matching the failures; application assertions were not relaxed. Repeat with a process-scoped caffeinate assertion while the machine is awake. The earlier 50/50 and 13/13 evidence remains historical; the final rejection-classification tree needs its own clean run.
Final: fixed uncertain failure classification — an unexpected server error previously discarded the operation key; the browser reproduction failed. Known economic rejection marking also failed its database reproduction. Explicit rejection markers now distinguish definite failure from unknown outcomes; the full final database/unit suite passes 52/52 in 110.40s with unchanged timeouts. Browser and production compilation checks follow on this tree.
Final: fixed uncertain failure classification — database rejection and browser unclassified-error tests RED→GREEN, final suite 52/52, complete browser suite 14/14 in 1.1m; the simulated lost commit acknowledgement retains exactly one economic event on retry.
Tasks 1–8: complete — approved local MVP implemented and documented; final tree passes 52/52 database/unit tests, 14/14 Chromium journeys, strict TypeScript, and the final Next Webpack production build. Original report artifacts remain in the parent directory. Seven Important review findings are fixed; the three Minor findings and all scope rulings are retained above.
Finishing: normal repository with no upstream/base branch or remote. Keep feat/loyalty-mvp and the tracked ledger in place; no plan-owned ignored scratch directory exists to remove. Stop temporary sleep prevention after verification and leave the local dev preview running.

Hosted testing follow-up: founder explicitly requested free hosting and supplied directedby-hamza/nqta. Prepared Render Free + Neon Free configuration, production test-mode password gate, shared-data labels and simulated OTP. Strict TypeScript/build passed; 71/71 real-database/unit tests and 14/14 Chromium journeys passed. Fresh independent hosting review found no Critical/Important defects; production access smoke passed. Corrected the deferred SMS_PROVIDER documentation mismatch as part of hosting configuration. The origin remote is configured, but GitHub is still connected as jungleclients-ops with no push permission, and Render/Neon are not connected. No upload, provisioned cloud resource, or live URL is claimed. Continue from docs/deployment-status.md after the founder completes account connections.
