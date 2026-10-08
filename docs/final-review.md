# Whole-project review and disposition

A fresh `gpt-6-astra` reviewer read the complete application at `bd5b490`, the approved plan, the specification and execution ledger. This review covered the foundation and UI commits. The reviewer reported no Critical findings, seven Important findings and three Minor findings. Important findings entered one implementation fix pass; no second review was dispatched.

| Important finding                        | Reproduction and fix                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication differs from reviewed rules  | Stale draft publication succeeded and fields remained editable during a delayed save. Publication now requires the saved revision; editing is disabled while saving.                                                                |
| Paused-shop recovery denied              | A verified existing member was rejected while paused; the UI hid verification. Existing membership recovery precedes the new-enrolment check, while earning/new members stay blocked. Earned rewards remain redeemable.             |
| Uncertain operation identifier discarded | Lost responses followed by dialog closure/reload had no recoverable operation. Purchase and redemption payloads are now saved before sending, scoped by shop/staff, and resumed with their original key.                            |
| Revocation read before lock              | A controlled waiting-lock reproduction authorised a staff member revoked before lock acquisition. The shop lock now precedes the current staff check, within the protected mutation transaction, including invites/profile/support. |
| Concurrent login limiter exceeded        | Fifteen bad logins all reached credential rejection. An atomic reservation now permits ten and rejects five before credential verification.                                                                                         |
| Invitation origin rejected               | The generated link used `localhost` instead of the trusted `127.0.0.1` origin. Invitation URLs now use the same canonical origin as mutation validation.                                                                            |
| Fractional receipt amount rounded        | `2550` minor units displayed as `MAD 26`. Receipts and activity now show exact two-decimal amounts, including `0.01`.                                                                                                               |

Regression tests first failed with the existing behaviour. The updated database/unit suite passed **52/52**. A further interrupted-response check ensures an unclassified server error retains the original operation; only an explicit business rejection resolves it. Browser and build evidence is recorded in [verification results](verification-results.md).

The three Minor findings remain recorded in [the ledger](progress.md): the README SMS-variable mismatch (use `.env.example`), a member-code/detail link missing in support intake, and unnecessary re-verification after a transient join failure. Every item the reviewer declined to judge has an explicit scope ruling and cost in that ledger.

The waiting-lock test deliberately controls the revocation interleaving; it is not a claim that a hosted PostgreSQL concurrency/restore drill has been performed. Real provider and hardware checks remain production/pilot work.

## Production upgrade review — 6 October 2026

A later independent review covered the production-upgrade changes, including live configuration, email verification/password recovery, tenant-scoped privacy fulfilment, migrations, encrypted backup/restore and operator tooling. Review findings received fixes and focused regression checks. The final independent review found **no actionable P1/P2 issues** in the reviewed final tree. This is a separate review from the historical foundation/UI review above.

Final verification passed: **207/207 unit/integration tests** in 21 files (334.63s), **16/16** in the full Chromium run (2.3m), and a separate **1/1** deletion UI regression (48.8s), plus strict TypeScript and the production Webpack build. The actual independent TLS PostgreSQL drill passed **63 checks with exit 0**, restored **22 tables/125 synthetic rows**, and removed both schemas it created. A read-only follow-up confirmed zero production public shops/staff/customers/events, zero disposable schemas and no active drill connections. See [verification results](verification-results.md#production-upgrade-evidence--6-october-2026) for the evidence boundaries.

A separate empty `nqta_production` database, restricted app role, migrations and encrypted baseline are prepared; the baseline contains 22 tables and two migration-history rows, with archive mode 0600 and parent mode 0700. The existing test site/database were preserved.

Technical verification does not complete the launch. Source publication is blocked by **HTTP 403** on GitHub integration writes; remote `main` remains **`19a5730`**, and no upgraded deployment/cutover occurred. Real Twilio/Resend account/sender/domain setup, SMS spending approval, mailbox/Moroccan SMS acceptance, physical phones, production origin and scheduled/off-host backups remain pending. These are explicit [launch dependencies](production-readiness.md), separate from the final code-review assessment.
