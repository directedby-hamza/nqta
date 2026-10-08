# Production Launch Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the authorized existing-product release. Independent database and authentication tasks are delegated; the root integrates and verifies the whole branch.

**Goal:** Replace demo assumptions with verified merchant access and safe real-customer operation.

**Architecture:** Keep the existing Next.js app and PostgreSQL ledger. Add strict live configuration, versioned database bootstrap, verified merchant email/recovery, durable delivery limits and operable privacy requests. Keep the current hosted test deployment until external delivery and release verification succeed.

**Tech Stack:** Existing pinned Next.js 16, React 19, TypeScript, PostgreSQL, Node 24; direct Twilio and Resend HTTPS adapters.

**Spec:** ../specs/2026-10-06-production-launch.md

## Global Constraints

- No paid provider activation or live messages before account/spend authorization.
- No seed, purge or reset of the hosted test database.
- Simulation is confined to local development and explicitly protected hosted testing.
- No secrets in source, public documentation, API responses or logs.
- Retain tenant checks, immutable published rules, idempotency and the existing ledger.

## Review Focus

- Missing production configuration must fail before opening local storage or exposing simulated codes.
- Concurrent migration, reset and preference requests must remain atomic.
- Delivery failure after account creation must offer verification resend rather than duplicate registration.
- One merchant's deletion must preserve another merchant's member and the ledger.
- Unknown recovery accounts and provider errors must disclose no identity or private token.

### Task 1: Production configuration and delivery controls — root

Files: environment.ts, providers/verification.ts, auth/customer.ts, API route, tests/unit/production-environment.test.ts, tests/unit/verification.test.ts, tests/integration/production-customer.test.ts.

- [x] Write failing validation, real-provider disclosure/failure, budget and consent-pair tests.
- [x] Add productionMode() and assertRuntimeConfiguration(); require TLS PostgreSQL, HTTPS APP_URL, secrets and actual provider settings.
- [x] Use reserveLimit(db, {scope,key,limit,windowSeconds}) for daily SMS and destination controls; normalize provider failures.
- [x] Lock paired preference saves and transactional deduplicated deletion requests.
- [x] Verify focused tests.

### Task 2: Database bootstrap — database agent

Files: db/client.ts, db/migrate.ts, db/check.ts, tests/integration/migrations.test.ts.

- [x] Write failing atomic rollback, checksum, repeat and demo-data rejection tests.
- [x] Add Database.dialect, transactional advisory-lock migrations and applied version checksums.
- [x] Add verified staff/email token/request-limit/privacy/resolution schema migration.
- [x] Validate runtime before DB creation, reject synthetic production data and close failed initialization.
- [x] Verify focused tests.

### Task 3: Verified staff and recovery — authentication agent

Files: auth/staff.ts, auth/onboarding.ts, auth/recovery.ts, auth/rate-limit.ts, providers/email.ts, corresponding unit/integration tests.

- [x] Write failing verification, expiry, replay, reset/session invalidation, generic response and delivery failure tests.
- [x] Implement durable atomic request limits and safe Resend delivery.
- [x] Implement createStaffRecoveryService(db) requestVerification, verifyEmail -> {token}, requestPasswordReset, resetPassword.
- [x] Gate live registration/invite/sign-in/session access by email verification and reject sample accounts.
- [x] Verify focused tests and report shared interfaces.

### Task 4: Real merchant flows and privacy operations — root

Files: app pages, auth screen, settings, join, merchant shell, API route, privacy service and tests.

- [x] Add email verification/resend and forgotten/reset-password screens, wire tokens through POST endpoints.
- [x] Replace hardcoded Morrow configuration lookup with public runtime configuration; remove production demo/local copy.
- [x] Add merchant location/privacy profile fields and require them for live programme publication/enrolment.
- [x] Add owner-scoped deletion fulfilment and support resolution, preserving other tenants and economic records.
- [x] Verify access, no cross-shop erasure, and browser journeys.

### Task 5: Launch tooling and final evidence — root

Files: scripts, package scripts, docs/production-environment.example, production-readiness.md, release evidence.

- [x] Add safe migration/preflight commands and backup/restore instructions.
- [x] Run full unit/integration, typecheck, production build and browser regression checks.
- [x] Exercise independent PostgreSQL pools and backup restoration in disposable schemas: actual TLS PostgreSQL drill passed with exit 0, 63 checks, and 22 tables/125 synthetic rows restored; both owned schemas removed.
- [x] Prepare fresh empty production DB with migrations and a restricted app role; verify public shops/staff/customers/events remain zero after the drill.
- [x] Create an encrypted empty-production baseline: 22 tables/2 migration-history rows; archive 0600 and parent directory 0700.
- [x] Record final verified checks and explicit remaining dependencies in production release/readiness and historical evidence documents.
- [ ] Configure approved real providers and SMS spending, verify actual mailbox/Moroccan SMS delivery and supported physical phones, assign the production origin, and configure scheduled/off-host backups before cutover.
- [ ] Publish/deploy the verified upgrade. GitHub integration writes return HTTP 403 and remote main remains at 19a5730; no upgraded deployment or production cutover occurred.

### Final evidence — 2026-10-06

Full unit/integration suite: **207/207**, 21 files, 334.63s. Full Chromium run: **16/16**, 2.3m; the additional deletion UI regression passed **1/1 separately**, 48.8s. Strict TypeScript and production Webpack build passed. Final independent review found no actionable P1/P2 issues. A read-only PostgreSQL follow-up confirmed zero production public shops/staff/customers/events, zero disposable schemas and no active drill connections. The existing hosted test site/database were preserved. These checks establish technical verification, not real-provider acceptance or customer-launch readiness.
