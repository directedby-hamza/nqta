# Production rollout boundaries

The initial delivery was a local application. The founder has now requested separate hosted testing with synthetic data; its setup is described in [hosted testing](hosted-testing.md). Testing does not establish readiness to collect live customer data.

Before a real pilot:

- Choose and configure a hosted PostgreSQL database; apply the application migrations.
- Set a strong application secret, HTTPS application URL, and secure deployment environment.
- Disable `HOSTED_TEST_MODE` before a real merchant launch. Configure a real SMS provider and test delivery in the launch country. Simulated verification codes belong only in the separate, password-protected synthetic test environment described in [hosted testing](hosted-testing.md).
- Provision individual owner/cashier credentials; disable synthetic demonstration accounts and data.
- Verify tenant boundaries, concurrent redemption, rate limits, staff revocation, backup restoration, and the supported pilot phones.
- Agree the exact reward, eligible receipt definition, refund/closure terms, data retention, privacy notice, and marketing preferences with each merchant.
- Select hosting/backup regions, accountable data roles, support coverage, and applicable launch-market requirements.
- Measure verification delivery cost, infrastructure cost, and time spent supporting each shop before setting subscription prices.

## Deferred integrations

Wallet passes, promotional campaigns, spending points, automated subscription collection, multiple shop branches, and checkout/POS connectors follow the releases described in the product report. The core application's progress and reward ledger must remain authoritative when those channels are added.

## Local verification delivery

Local development and the explicitly enabled, password-protected hosted test environment display a short-lived test code so the founder can exercise enrolment and recovery without an SMS account. Visible labels distinguish those codes from real SMS delivery. Ordinary production must fail closed when a real provider has not been configured.

## Local storage

Unresolved economic confirmations are saved in browser storage, scoped to the staff account and shop. Resume them with the same account on that device; do not clear its browser storage while an operation is unresolved. Network, server and authentication failures keep the original operation. A confirmed business rejection or successful response resolves it. Clearing storage or independently entering the same physical receipt on another device requires a receipt reference or owner reconciliation.

The development PostgreSQL-compatible database persists in `.data/`. This directory contains application records and must stay out of Git. A production database needs controlled access, encrypted backups, documented retention, and a tested restoration procedure.
