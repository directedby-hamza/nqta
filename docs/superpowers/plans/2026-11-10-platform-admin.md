# Platform Admin Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user has requested direct implementation and delivery.

**Goal:** Give the founder private platform access to review shops, record real payments and control unpaid shop access.
**Architecture:** Separate platform identities/sessions; an additive billing schema and service enforcing access inside existing shop transactions; dedicated admin API/UI.
**Tech Stack:** Existing Next.js 16, TypeScript, PostgreSQL/PGlite, React, Vitest and Playwright.
**Spec:** `docs/superpowers/specs/2026-11-10-platform-admin-design.md`

## Global Constraints

- No public admin registration, production demo password, payment fabrication or automatic suspension of existing shops.
- New production shops require activation; existing shops remain unreviewed until reviewed.
- Preserve existing customer/merchant data and the user edit to `docs/wallet-setup.md`.
- Server-enforced permissions, durable authentication limits, password rotation and transactional audit history.

## Review Focus

- Merchant/customer sessions submitted to admin routes must fail.
- Expired/revoked/admin-password-change sessions cannot access administration.
- Suspension cannot be bypassed by a stale browser, forged actor, shop edits or direct purchase/enrolment service calls.
- Retries and concurrent payment submissions record one payment; voiding is audited and explicit about access.
- Migration/backup preserve all prior records and do not invent paid status.

## Task 1: Authentication and billing service

Files: migration 7 in `src/server/db/migrate.ts`; new `src/server/platform/{auth,billing,access}.ts`; `scripts/create-admin.ts`; `tests/integration/platform-admin.test.ts`.

- [x] Write failing tests for separate authentication, forced password rotation, invalid identities, shop list, duplicate payments and access enforcement.
- [x] Implement provision/sign-in/session/rotation and admin authorization; service returns only safe identity fields.
- [x] Add shop billing, immutable payment history and admin audit tables; existing rows backfill unreviewed.
- [x] Implement shop list/detail, record/void payment, reasoned access changes and date expiry.
- [x] Run focused tests and typecheck.

## Task 2: Enforce access and API

Files: `src/app/api/admin/[...path]/route.ts`, existing API route, permissions/onboarding/customer service and merchant shell; integration/API tests.

- [x] Test merchant/customer denial, origin checks, expiry and suspension across earning/enrolment.
- [x] Add admin endpoints with separate cookie and no-store responses; credential changes rotate sessions.
- [x] Gate merchant actor and service transactions; allow restricted workspace status for the access notice. Gate new enrolment, preserve private cards/privacy actions.
- [x] Require activation for newly created production shops; preserve demo/development behavior.
- [x] Run focused tests and the full unit/integration suite.

## Task 3: UI, verification and delivery

Files: `src/features/admin/*`, `src/app/admin/*`, admin stylesheet, `tests/e2e/platform-admin.spec.ts`, admin Playwright config and operations documentation.

- [x] Build responsive admin sign-in/password change, summary, searchable/filterable shops, shop detail, payment/access forms and audit history.
- [x] Browser-check admin login, record payment, suspend/reactivate, merchant restriction, mobile layout and absence of merchant access to admin.
- [x] Full tests, typecheck, formatting, build and independent final security review.
- [ ] Back up live data, publish through established host, provision the private administrator and verify real read-only admin access plus unauthorised denial.
- [ ] Deliver the admin URL and temporary credentials; leave all real-shop decisions to the founder.
