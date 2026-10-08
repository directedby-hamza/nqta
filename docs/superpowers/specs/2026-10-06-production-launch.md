# Nqta merchant launch

The founder wants to offer the existing loyalty product to real shops in the next few days. A live shop must start empty, use individual staff accounts, verify actual customer phone numbers, and save purchases, rewards and preferences in shared PostgreSQL. The deployed synthetic test environment is preserved until real delivery and the release checks pass.

## Release scope

Retain the existing stamps, configurable rewards, QR enrolment, cashier, reporting, staff invitations and refund ledger. No new billing, POS, wallet or promotional campaign claims are introduced.

Ordinary production requires PostgreSQL with TLS, an exact HTTPS origin, a strong session secret, DEMO_MODE=false, configured real SMS and transactional email. It must reject a seeded demo database, public sample staff accounts and their sessions. Local development and explicitly protected hosted testing retain simulation for automated checks only.

Owner registration requires mailbox verification before workspace access. Staff receive expiring single-use verification links; forgotten passwords use equivalent generic request responses and hashed expiring tokens. Reset invalidates all staff sessions. Provider failures never reveal credentials or verification tokens. No paid provider activation or messages are authorized until the founder chooses an account and spending allowance.

Persisted delivery limits apply across instances and destinations, with an explicit daily SMS ceiling and allowed dialling prefixes. Rates return 429; customer SMS delivery outages return 503. Public email recovery requests keep account-neutral acceptance responses during an outage; committed registration/invitation flows show verification delivery failure and offer resend. Database migrations are versioned, serialized and atomic. Preference pairs are saved under a shop lock followed by a membership lock.

Each merchant supplies its location, privacy notice and contact before publishing a live programme. Deletion intake is transactional and deduplicated. An owner can fulfil a deletion request for its own shop only, disconnecting the member's personal identity, closing the card and revoking unused rewards while preserving the financial ledger. Membership in another shop remains intact. Other review requests have a recorded resolution and completion time.

## Operations and evidence

Provide migration and launch preflight commands, a production environment template, a backup/restore runbook, and independent PostgreSQL concurrency checks on disposable databases. Never seed, purge or reset the current hosted test database. A fresh production database is prepared separately without importing synthetic data.

The release is ready for real customers only after merchant email delivery, customer SMS delivery in Morocco, clean production onboarding, concurrent ledger/reward checks, restore verification and supported physical phone checks pass. External accounts, approved SMS spend, sending domain, business contact and provider sender registration are genuine dependencies. Missing evidence remains an explicit launch blocker; changing labels does not establish readiness.
