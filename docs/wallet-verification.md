# Wallet implementation verification — 8 October 2026

The implementation is on `feat/wallet-cards`, based on the password/recovery-key release `ae657f9`. Real provider activation and source publication remain pending; the existing protected Netlify test site and its database were preserved.

## Automated evidence

| Check                              | Result                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Full unit/integration suite        | 350/350 passed, 35 files, exit 0; fresh final source                                                   |
| Strict TypeScript                  | Passed, exit 0                                                                                         |
| Production Webpack build           | Passed on final source, Next.js 16.3.8 Webpack, exit 0                                                 |
| Production asset tracing           | All six Wallet PNG assets included in both API route bundles                                           |
| Contact-mode browser regression    | 21 passed, 5 mode-specific skips, fresh database                                                       |
| Password/key browser regression    | 7/7 passed, fresh database, exit 0                                                                     |
| Wallet browser journeys            | 2/2 passed in fresh final run, exit 0; official badge loading/aspect ratio at 390px and 360px verified |
| Fresh PostgreSQL Wallet-only drill | 46 checks, 25 tables, 32 synthetic rows, exit 0; final device-lock overlap included                    |
| Fresh complete PostgreSQL drill    | 169 checks, 25 tables, 198 synthetic rows, encrypted restore and owned-schema cleanup, exit 0          |
| Independent review                 | Five material security/protocol findings fixed and reviewed; official Google artwork/layout reviewed   |

PostgreSQL runtime statement/lock timeouts stayed at 30/15 seconds. An initial full drill failed with SQLSTATE `55P03` in the existing threshold-purchase stage. The complete fresh retry passed that stage and all subsequent stages with unchanged timeouts. No performance workaround was introduced. The Wallet-only and full drills include real concurrent pool sessions, revision allocation ordering, preference/issuance overlap, token rotation during a lease and restored sequence/device/queue checks.

The complete 169-check drill preceded the final device-row lock; the newer 46-check Wallet-only drill verifies that fix alongside encrypted restoration and cleanup.

The new Google tests verify actual RS256 JWT signatures, fixed OAuth/REST endpoints, stable opaque resources, minimal Save payloads, approval/configuration gates, privacy and bounded timeouts. Apple tests create isolated synthetic certificate fixtures, verify detached PKCS#7 signatures independently with OpenSSL, verify actual PNG manifest digests, and exercise native registration/listing/download/closure/caching and APNs failure handling. Synthetic trust roots are explicitly supplied only to test helpers; the default provider rejects them.

Browser save-provider responses are mocked only in the UI test. The signed-out cashier journey uses real local account sessions, real membership records and the real transactional loyalty engine with the public payload encoded by native passes. It verifies customer login is unnecessary for earning and is required for reward confirmation. It does not claim a physical native Wallet install or camera scan.

## Findings resolved

1. Apple browser download GET could create a pass outside the POST Origin boundary. It now reads only an existing, customer-owned active pass; the initial creation remains in the authenticated POST.
2. Changing an existing Apple device push token during delivery could clear pending notification work. Changed tokens now allocate a new revision; same-token registration remains idempotent.
3. Database waits could consume a delivery lease before provider deadlines began. Delivery now checks the current lock token and a conservative monotonic budget measured before claiming, leaving provider headroom. Stale claims do not send updates.
4. Wallet issuance locked customer/membership in the opposite order to preferences. It now locks the shop first, then customer/membership and rechecks ownership/status. A deterministic independent PostgreSQL overlap verifies no deadlock.
5. Concurrent Apple device removal could delete the registration between its lookup and same-token upsert, recreating it without a new revision. The lookup now holds a device row lock until commit. The focused regression failed before the fix and passed afterward. A fresh deterministic PostgreSQL overlap verifies DELETE waits for registration, then the next registration advances beyond the other card's watermark.

The Google Add action was also changed from a custom button to the official, unchanged primary/condensed assets. Configuration visibility wording was corrected: local validation does not establish Google's issuer approval.

The node-forge verification advisory and its unreachable verification path in this signing integration are documented in [Wallet setup](wallet-setup.md). Joi is pinned through an override to patched 17.13.8.

## Actual activation and publication state

- After the founder's approval, Google Pay & Wallet Console signup completed as **Nqta**, business type **Merchant**, country **Morocco**. The console dashboard confirmed the new business. Optional campaign/product email subscriptions were left unchecked. The initial Console Additional Terms were accepted; no paid service or billing account was opened.
- The founder explicitly approved the separate **Google Wallet API Terms of Service**, and the normal Console submission created Nqta's numeric Wallet issuer. The dashboard confirms Demo Mode with publishing tasks still incomplete. The actual issuer ID is saved only in the ignored private production-pending environment; no production publishing approval or service-account credential has been obtained. The earlier terms approval rejection is resolved by the explicit approval and successful account creation. The Console Merchant ID must not be used as the Wallet issuer ID.
- Google Cloud still requires the organization's password re-authentication even when navigated normally with the already signed-in Wallet account. The correct Cloud tab is now verified active. Chrome reports no normal password autofill; no password value was read, exported, guessed or reset. Dedicated Cloud project/API/service-account/key creation remains pending actual authentication. An unnecessary full authentication-window screenshot was rejected by automatic review; subsequent inspection uses only safe DOM metadata.
- The current [Apple certificates portal](https://developer.apple.com/account/resources/certificates/list) displays **Access Unavailable** and requires program membership or access to an enrolled organization's team. No genuine Pass Type certificate/private key is configured. No enrollment or paid purchase was made.
- Project-specific private environment files contain no Wallet provider credentials. The default options therefore stay disabled rather than exposing nonfunctional Add actions.
- A fresh connected directedby-hamza GitHub check again returned HTTP 403 `Resource not accessible by integration` for the authorized disposable feature-branch probe, despite metadata reporting push access. No branch was created. Remote main remains the older hosted-test source, and GitHub confirms Wallet commit `bb7b9ef` is unpublished. An independent CLI dry run previously found no GitHub login credential. After correctly focusing the repository tab, Chrome confirmed the authenticated directedby-hamza account with repository controls. Dedicated Wallet branch publication is now in progress through that normal browser session; main has not been updated.
- The retained remote `import-source` workflow was checked read-only. It has no inputs, accepts only the old 96-file archive/hash, checks out main and pushes directly to main. It was not rerun for Wallet's 179-file release. Connected tools cannot dispatch a replacement branch/archive; a new branch-specific import or ordinary authenticated source publication is still needed. Render's earlier actual Free-plan creation returned HTTP 402 requiring payment information, so its connector's Free option does not establish a deployable zero-budget route.
- No live deployment, production database migration, native pass installation or real APNs/Google delivery has been claimed. Use the concrete setup steps in [Wallet setup](wallet-setup.md), then verify the public production origin on Android and iPhone.
