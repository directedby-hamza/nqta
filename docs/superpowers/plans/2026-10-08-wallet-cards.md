# Native Wallet Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track execution using the checkboxes below.

**Goal:** Let customers show a saved native Wallet loyalty card on repeat earning visits without a Nqta browser/login.

**Architecture:** Add ownership-gated Wallet issuance, two real provider adapters, an atomic durable update queue with leases, Apple native callbacks, and mode-aware customer actions. Existing member codes and economic transactions remain authoritative.

**Tech Stack:** Existing Next.js/React/TypeScript/PostgreSQL, Node crypto and an established PKPass signing library; no paid service provisioning.

**Spec:** `docs/superpowers/specs/2026-10-08-wallet-cards.md`

## Global Constraints

- Append migration 4; applied migrations 1–3 remain unchanged.
- The barcode is the existing public member code, never a session/password/recovery credential.
- Provider network requests never run inside business transactions or alter saved purchase outcomes.
- Native callback auth is pass-scoped; browser Origin and hosted-test protection remain intact.
- No fake provider activation, paid enrollment or live cutover without verified real configuration.

## Review Focus

- A purchase saved while a Wallet provider times out still earns exactly once.
- Changes made during delivery cannot be acknowledged as already synchronized.
- Privacy deletion prevents issuance and invalidates the cashier barcode even before native refresh.
- Native serial listing across two memberships cannot miss the newer update.
- Wallet credentials/links cannot sign in, recover an account, delete data or redeem by public QR.

### Task 1: Google provider

**Owner:** Google worker. Create `src/server/wallet/google.ts`, Google-specific tests only.

**Interface:** `googleWalletOptions() -> boolean`; `googleWalletObjectId(membershipId) -> string`; `syncGoogleWalletPass(pass:WalletPass,card:MembershipCard) -> Promise<void>`; `googleWalletSaveUrl(pass:WalletPass) -> string`. Use shared contracts/errors. Credentials use `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64`, `GOOGLE_WALLET_PUBLISHING_ACCESS=approved|demo`; canonical HTTPS `APP_URL` supplies asset URLs. Production requires approved publishing.

- [x] Write/run failing cryptographic, privacy, stable-resource, REST success/failure and mode/config tests.
- [x] Implement genuine LoyaltyClass/Object create/update and bounded OAuth/REST, then minimal Save JWT.
- [x] Run focused tests and report actual red/green evidence; do not mutate package files or provider accounts.

### Task 2: Apple provider and native callbacks

**Owner:** Apple worker. Create `src/server/wallet/apple.ts`, `apple-web-service.ts`, `src/app/api/wallet/apple/[...path]/route.ts`, Apple-specific tests only.

**Interface:** `appleWalletOptions() -> boolean`; `applePassTypeIdentifier() -> string`; `createAppleWalletPass(pass:WalletPass,card:MembershipCard) -> Promise<Buffer>`; `appleWalletAuthorization(passId,header) -> boolean`; `pushAppleWalletUpdates(tokens:string[]) -> Promise<{token:string,status:'sent'|'remove'|'retry'}[]>`. The native handler consumes `createWalletStore(db)` methods described below. Credentials use `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_SIGNER_CERT_BASE64`, `APPLE_WALLET_SIGNER_KEY_BASE64`, optional `APPLE_WALLET_SIGNER_KEY_PASSPHRASE`, `APPLE_WALLET_WWDR_CERT_BASE64`, `APPLE_WALLET_AUTH_SECRET` (at least 32 chars). Assets supplied by root under `public/wallet`.

- [x] Write/run failing signing/privacy/config/native-protocol tests with explicit test-only certificates.
- [x] Implement signed .pkpass, scoped auth, required native callbacks and bounded APNs refresh signals.
- [x] Run focused checks; tell root the exact library dependency before importing it. Do not install or edit package files.

### Task 3: Durable Wallet store and transactional queue

**Owner:** store worker. `src/server/db/{migrate,schema}.ts`, new `src/server/wallet/store.ts`, hooks in loyalty/privacy/programme services, membership/types shop status, store/migration tests.

**Interfaces:** shared `WalletPass` has `id,membershipId,provider,externalId,revision,syncedRevision,lockToken?:string`; revisions are decimal strings. `createWalletStore(db)` exposes `getOrCreatePass(customerId,membershipId,provider,externalId:string) -> {pass,card}`, `getPassBySerial(provider,serial) -> {pass,card}|null`, `claimPendingPasses({passId?,membershipId?,limit?}) -> WalletPass[]`, `markSynced(pass)`, `markFailed(pass)`, `registerAppleDevice(passId,deviceId,pushToken)->{created:boolean}`, `unregisterAppleDevice(passId,deviceId)`, `listAppleSerials(deviceId,passTypeId,since?) -> {serialNumbers:string[],lastUpdated:string}|null`, `getAppleDevices(passId)->{deviceId,pushToken}[]`, `removeAppleDevice(passId,deviceId,pushToken)`. Export `enqueueMembershipWalletUpdates(tx,membershipId)` and `enqueueShopWalletUpdates(tx,shopId)`. Lease 60 seconds; claim limit 1–20; no network.

- [x] Write/run failing ownership, idempotency/rollback, lease/concurrency/new-revision, deletion and native-registration tests.
- [x] Append migration 4 for wallet_passes and wallet_devices; use a globally monotonic bigserial revision allocator.
- [x] Implement store and atomic mutation hooks. Closed cards remain available only for scoped refresh/inactivation.
- [x] Run focused tests and report actual evidence; do not edit root API/adapter/package/UI files.

### Task 4: Integration, UI and release verification

**Owner:** root. Shared contracts, delivery orchestration, catch-all browser issuance API/public options, branding hook, customer Wallet component/assets, CLI/docs, integration/browser verification.

- [x] Write failing ownership/API and customer Wallet-save/scanner journeys.
- [x] Implement configured options and authenticated POST `wallet/google` or `wallet/apple` `{membershipId}`; both respond `{url}`. Apple uses a cookie-owned GET for an already issued pass with native PKPass MIME so Safari opens the Add screen without Blob transport.
- [x] Add native Wallet actions, mobile guidance and honest failure states without exposing provider implementation details to customers.
- [x] Deliver claimed updates after commit/response with retries on normal traffic and private CLI; never turn provider failures into purchase failures.
- [x] Run full tests, types/build, isolated browser checks and independent review; document real activation and deployment evidence.

## Execution rulings

The founder explicitly instructed implementation now and gave access to complete it. Proceed with reversible local work and delegated tasks without another design/plan approval gate. Work from clean commit `ae657f9` on `feat/wallet-cards`; preserve the existing deployment and private configuration. Provider/account activation requires genuine credentials; the earlier zero-budget requirement does not authorize a paid purchase.

## Verified local release

Final source passed 350 unit/integration tests, strict TypeScript and production build. Wallet browser journeys passed with official Google artwork at 390px and 360px. The complete PostgreSQL drill passed 169 checks before the last device-row fix; a fresh Wallet-only drill passed 46 checks including that fix and encrypted restoration. Independent source and brand review found no remaining material blockers.

Google Console signup and Wallet issuer creation are complete as Nqta after explicit owner approval. Issuer **3388000000023200992** remains in Demo Mode, and an initial Nqta Loyalty publishing class is saved as a draft. The owner completed Google Cloud re-authentication directly on Google's page; the earlier password blocker is resolved. Project creation displayed separate Google Cloud terms and is awaiting explicit owner approval; no project or billing was created. API/service-account credentials, legal business profile details and publishing approval remain pending. Apple account certificate access and actual native phone installation/update checks remain pending.

The authenticated owner browser session published the source on remote `feat/native-wallet-cards`; a branch-only import workflow succeeded, and independent verification matched all 179 source blobs/modes to local snapshot `cf46718266071e6d077982cc9d6ecf3bef95b006`. Remote main and the existing protected test project remain unchanged. Netlify Free deploy `6ac7b389ce5f7f64d4296f5e` is published at **https://nqta-hamza.netlify.app**, using real password/key accounts, demo/test modes off and isolated Neon production storage. Live sign-in/readiness checks passed; the normal app migration path and a direct TLS check confirm all four migrations and 25 tables. A subsequent real production core API journey passed 14 checks, including signed-out earning, purchase deduplication and private-code redemption exactly once. Independent SQL confirmed five purchases/one redemption/five ledger stamps; all owned verification records were cleaned, restoring 23 business/authentication tables to zero while preserving migration history and shared rate limits. Physical-phone, cross-device recovery/staff operation and operational backup checks remain pending. Provider actions remain disabled without genuine credentials/approval; no native phone installation is claimed. See [production deployment status](../../production-deployment-status.md) for current evidence and remaining steps.
