# Whole-project review package

Application: `/Users/azer/thoughts /nqta`, branch `feat/loyalty-mvp`.
Base: `4b825dc642cb6eb9a060e54bf8d69288fbee4904` (empty tree; this is a new repository).
Head: `bd5b490`.

Review the entire repository, including the engine in the first commit. This is a local loyalty MVP, not a public production deployment.

Plan: `../docs/superpowers/plans/2026-10-05-digital-loyalty-mvp.md`.
Spec: `../loyalty-platform-specification.json`.
Coverage: `docs/requirement-coverage.md`.
Ledger and decisions: `docs/progress.md`, especially `Ruling:` lines.
Verification: `docs/verification-results.md`, `.suite-final.log` (45/45), `.e2e-round3.log` (7/7), `.typecheck-formatted.log`, `.build-webpack.log`.

## Review focus, verbatim from the plan

1. Same customer and programme joined again, including simultaneous submissions: return one existing membership and retain the balance. Task 3 tests the uniqueness boundary.
2. Lost network response followed by repeated confirmation: return the original purchase or redemption result. Tasks 1 and 5 test idempotency across the database boundary.
3. A valid session requests another shop's membership, report, or reward: deny both access and writes. Tasks 2 and 5 test explicit cross-tenant identifiers.
4. Refund after a reward was redeemed: preserve the history and create an owner reconciliation flag instead of silently charging or issuing a replacement entitlement. Task 1 tests this transition.
5. Missing purchase amounts, phone-camera access, and reduced-motion preferences: preserve usable flows and honest metrics. Tasks 4, 5, and 7 cover these conditions.

Also check revocation during operations, malicious body scope/role fields, challenge attempt persistence, rate reservations, publication review/save boundaries, support/privacy ownership, and error handling for interrupted transactions. Review the actual behaviour a reasonable local pilot user gets, including conditions the spec does not enumerate.

Known rollout dependencies are deliberate: live SMS configuration/validation, hosted PostgreSQL concurrency and backup drills, merchant email verification/password recovery, manual support/deletion fulfilment, fixed pilot MAD/Africa-Casablanca, and later Wallet/campaigns/points/POS/billing. Do not judge those as already shipped integrations. Do list any behaviour set aside under “Declined to judge” so the implementer can rule on it explicitly.

Review is read-only: do not edit source, index, HEAD or branch state; do not start a second app process against the open PGlite database; do not send messages, make provider calls, or spawn additional reviewers. Return findings with actual severity, file/line references, reproducible inputs, and a merge-readiness assessment.
