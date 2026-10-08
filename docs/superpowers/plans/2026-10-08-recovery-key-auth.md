# Recovery Key Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement real customer and staff authentication/recovery without a message-delivery dependency in explicit recovery-key mode.

**Architecture:** Append a migration for nullable customer phone, customer credentials and per-account staff authentication method/key hash. Reuse password hashing, session cookies, PostgreSQL transactions and durable limits. Keep verified-contact mode intact and expose mode-aware UI/API paths.

**Tech Stack:** Existing Next.js 16, React 19, TypeScript 7, PostgreSQL/PGlite, Vitest and Playwright; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-08-recovery-key-auth.md`

## Global Constraints

- `AUTH_MODE` accepts exactly `verified-contact` or `recovery-key`; default is verified-contact.
- Passwords retain the existing 10–200 character policy.
- Persist only password/key hashes.
- Append migration 3; do not modify migrations 1 or 2 or erase any existing test/production records.
- Keys are never stored in localStorage, URLs, logs or analytics; the one-time panel requires acknowledgement before continuing.

## Review Focus

- Recovery races permit only one use and invalidate previous sessions.
- Existing unverified contact accounts cannot gain access when a global mode changes.
- Nullable phone does not break reporting, masking or deletion; absent contact cannot be opted into.
- Public QR/member code never gives account access or recovery authority.
- Browser reload during the one-time save-key step offers honest recovery guidance and does not fabricate a replacement key.

### Task 1: Customer credentials, migration and safe identity handling

**Ownership:** customer worker. `src/server/db/{migrate,schema}.ts`, new `src/server/auth/customer-password.ts`, `src/server/auth/customer.ts`, nullable-phone handling in membership/reporting/privacy and dedicated integration tests.

**Interfaces:** `createCustomerPasswordService(db)` produces `register(password) -> {token,customerId,accountId,recoveryKey}`, `signIn(accountId,password) -> {token,customerId}`, `recover(accountId,recoveryKey,password) -> {token,customerId,accountId,recoveryKey}`, `rotateRecoveryKey(customerId,password,expectedAccountId?) -> {accountId,recoveryKey}`. Migration adds `customer_credentials(customer_id,account_id,password_hash,recovery_key_hash)` and `staff.auth_method` default `verified-contact`, `staff.recovery_key_hash` nullable. Mode helper is root-owned `recoveryKeyMode()`.

- [x] Write/run failing integration tests for new accounts without phone, wrong passwords, key replay/concurrency, old-session revocation and same card access from a second session.
- [x] Implement migration 3 and credential service with account-specific durable limits and transaction locks.
- [x] Pin nullable phone masking/reporting/deletion and forbid contact opt-ins without a phone.
- [x] Run focused tests; provide red/green evidence and integration contract to root.

### Task 2: Staff recovery and message-free onboarding

**Ownership:** staff worker. `src/server/auth/{staff,onboarding,recovery}.ts`, new `staff-key-recovery.ts`, merchant auth/recovery UI, staff invite acceptance UI and dedicated integration tests. Do not edit API/environment/migrations.

**Interfaces:** existing workspace creation/invite acceptance additionally return `recoveryKey` in recovery-key mode (workspace also returns its session token). `createStaffKeyRecoveryService(db).resetPassword(email,recoveryKey,password) -> {recoveryKey}`. New accounts store `auth_method='recovery-key'`, hashed recovery key and `email_verified=false`. Only such accounts use the new sign-in path; existing unverified accounts retain their gate.

- [x] Write/run failing tests for password owner signup without delivery, invited staff, old unverified accounts denied, key reset rotation/session revocation and inactive staff denied.
- [x] Implement mode-specific account provisioning and key reset with shop/staff locks and durable limits.
- [x] Add save/download/acknowledge key panels to workspace/invite flows and key-based staff reset UI. Consumption endpoint is `/api/auth/staff/recover-key` with `{email,recoveryKey,password}`; response `{ok:true,recoveryKey}` clears staff session.
- [x] Run focused tests and report red/green evidence.

### Task 3: Customer browser flow

**Ownership:** customer UI worker. `src/features/card/*`, `/join/[slug]` and `/recover` pages, dedicated Playwright scenario. Do not edit API/server authentication/schema/environment.

**Interfaces:** `/api/public/config` returns existing flags plus `authMode`. Endpoints POST `/auth/customer/register` `{password}` -> `{ok:true,accountId,recoveryKey}`; `/auth/customer/sign-in` `{accountId,password}` -> `{ok:true}`; `/auth/customer/recover` `{accountId,recoveryKey,password}` -> `{ok:true,accountId,recoveryKey}`; all set ordinary customer cookie. POST `/auth/customer/rotate-recovery-key` `{accountId,password}` -> `{accountId,recoveryKey}` requires current session. Existing join/card routes unchanged.

- [x] Write a failing browser journey for password signup, saved-key acknowledgement, a cashier purchase, second-browser sign-in restoring the same card, recovery rotation and old credentials denied.
- [x] Implement mode-aware create/sign-in/recovery forms and one-time downloadable key panel with acknowledgement, no persistent raw-key storage. Hide absent-contact preference controls.
- [x] Keep current visual design/animation/accessibility and verified-contact UI.
- [x] Run the focused browser scenario after API integration; report results.

### Task 4: API, configuration, full verification and release docs

**Ownership:** root. Environment mode helper/validation, API dispatcher, public config, environment/API integration tests, docs and final independent review.

- [x] Write/run failing mode-validation and API tests for provider-free production configuration, disabled inactive auth routes and secure session/origin behaviour.
- [x] Implement mode helper/validation and root-owned endpoint dispatch with global limits, schema validation, no-store responses, secure cookies and generic auth errors.
- [x] Run full Vitest suite, strict TypeScript, production build and focused/full browser suite. Address meaningful failures before completion.
- [x] Request independent review, resolve important findings, document actual deployment/physical-device limits and current evidence. Preserve the deployed test site and private preparation files.

## Execution rulings

The founder already authorized project implementation and explicitly selected passwords/recovery keys in this session. Proceed with reversible local implementation without another plan permission gate. Work in the existing clean feature checkout; do not merge or alter live configuration as part of this slice. Schema owner coordinates staff columns before integration; endpoint contracts above are shared between workers.

## Local completion evidence

8 October 2026: 258/258 Vitest tests across 26 files, strict TypeScript, Webpack production build, 7/7 recovery-key browser checks and 21 contact-mode browser checks passed. The latter intentionally skipped 3 key-only customer journeys; those ran in the dedicated configuration. Independent review found no remaining actionable P1/P2 after fixing account-bound key rotation and interrupted staff recovery. The dedicated PostgreSQL/restore drill is additional release verification; its final result and publication status are recorded in `docs/message-free-launch.md`. Local task completion does not establish a production cutover or actual phone compatibility.
