# Public deployment status — 8 October 2026

The real account version of Nqta is published at **[https://nqta-hamza.netlify.app](https://nqta-hamza.netlify.app)**. It uses customer/staff passwords and saved recovery keys, with demo/test modes disabled and a separate production database. Live readiness and 14 real production account/loyalty checks passed. Temporary verification records were cleaned. Native Google/Apple Wallet activation and physical-phone verification remain incomplete; this deployment does not establish that all SaaS launch requirements are finished.

## Latest Atlas enrollment upgrade

The current published deployment is **`6ac7ca5ebd1cae000827e761`**, from **`feat/native-wallet-cards@aa3afd9e3db0e37ac30e54668ece4318b8bf4887`**. It imports local snapshot **`175b3dad6d3c52443645e74a27a3a7ad41447a18`**. Workflow run **`37812192893`** succeeded; independent Git tree comparison matched all **184 source blobs and modes**, preserved the reviewed import helper and confirmed the source ZIP was removed. Main remains `19a5730a4f17eb80df358edf9851948b53326f05`. Intermediate archive/helper commits used Netlify’s documented `[skip netlify]` marker; the final source commit deployed normally.

[Atlas Coffee — Marrakech](https://nqta-hamza.netlify.app/join/atlas-coffee) is the founder-authorized imaginary shop retained for phone/computer testing. [Its public QR](https://nqta-hamza.netlify.app/shops/atlas-coffee-join-qr.png) returned HTTP 200 and exactly matched the local 7,877-byte PNG, SHA-256 `abca84a1abd8b775adce7a6977974f75315a4fb4cfd49542ceeb1770a340fb74`. The public mobile page exposes required phone/email/private-password fields and **Save my card** without horizontal overflow. The shop is explicitly fictional and its privacy email is an identified, non-deliverable placeholder; it is not a commercial merchant launch.

A real production journey on 8 October, 16:57:16–16:58:00 UTC, passed **11/11 checks**, exit 0, with no errors. Actual registration/enrollment stored normalized declared contacts on the membership while `customers.phone` remained NULL. The saved card returned zero points, the saved greeting name and the member QR. Signed-out/fresh callers received 401; password sign-in restored the same card. Production migrations are now **1–5**. Both native Wallet providers remain false in the public configuration, with demo/test modes disabled.

Cleanup removed only this run’s disposable customer, membership, two consent rows, audit row, password credentials and owned sign-in limit. Atlas’s owner, published programme, existing memberships and economic records were preserved. No purchase/reward/ledger record was added to Atlas. Evidence is retained locally in `nqta-atlas-live-verification-report.json`, `nqta-atlas-deployment-guard-report.json` and the public-only 390px screenshot `nqta-atlas-live-public-join-mobile.png`. No private authentication/recovery screenshot was taken. The founder’s actual browser was signed into Atlas’s owner account and left on **/cashier** for the requested computer-side walkthrough; credentials remain private and gitignored.

The final source passed **364/364 unit/integration tests**, **11 local browser checks** (three password/recovery, seven Wallet, one verified-contact journey), strict TypeScript and the production Webpack build. Independent review cleared the interrupted enrollment and same-page pass download fixes. Browser provider mocks verify handoff/completion behavior; they do not establish native installation. The current Apple account still reports Access Unavailable, and the targeted public-certificate-only check found zero existing Pass Type certificates. No paid enrollment, card or service was added. See [the complete Atlas steps](atlas-coffee-wallet-flow.md).

## Original publication evidence

| Evidence                | Result                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Host                    | New Netlify Free project `nqta-hamza`                                                                                    |
| Netlify site ID         | `34d83fd2-ea28-4209-927c-38a1bb441918`                                                                                   |
| Production deployment   | `6ac7b389ce5f7f64d4296f5e`, Published                                                                                    |
| Deployed Git source     | `feat/native-wallet-cards@e946dcd8e89276e3e1a7dadf9e4190bd3ea92e65`                                                      |
| Host build              | Build, function and edge deployment completed in 71 seconds                                                              |
| Imported local snapshot | `cf46718266071e6d077982cc9d6ecf3bef95b006`; 179 source blobs and modes independently matched                             |
| Branch-only import      | GitHub workflow run `37798381595`, success in 12 seconds                                                                 |
| Remote main preserved   | `19a5730a4f17eb80df358edf9851948b53326f05`                                                                               |
| Earlier test preserved  | [nqta-hamza-test.netlify.app](https://nqta-hamza-test.netlify.app), original protected synthetic site/database unchanged |
| Spending                | No paid service, payment card, subscription or Apple enrollment added                                                    |

Production is public; deployment previews are private. The new project is separate from the protected test project and deploys the dedicated Wallet feature branch. The optional Powered by Netlify badge was disabled; the saved project settings confirm that the badge is not shown.

## Production configuration and initial live checks

Twelve key entries are stored in Netlify's production-only environment. Configuration includes `AUTH_MODE=recovery-key`, `NODE_ENV=production`, `HOSTED_TEST_MODE=false`, `DEMO_MODE=false`, the exact HTTPS `APP_URL`, TLS database access, a session secret, backup encryption key and Nqta's Google issuer ID. Private values are not recorded in this document or source control. No Google service-account key, approved-publishing flag or Apple signing credential is configured.

Netlify's actual secret-scan result reported **No Secrets Detected**, with zero errors. Public build/configuration values are excluded by key name: `APP_URL`, `NODE_ENV`, `NODE_VERSION`, `NPM_FLAGS`, `HOSTED_TEST_MODE`, `DEMO_MODE`, `AUTH_MODE` and `GOOGLE_WALLET_ISSUER_ID`. Database, session, backup and provider secrets remain subject to scanning.

| Live check                               | Result                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public sign-in                           | HTTP 200; no demo action or synthetic-test access gate                                                                                                  |
| Public logo                              | HTTP 200, PNG                                                                                                                                           |
| Production `/api/ready`                  | HTTP 200                                                                                                                                                |
| Isolated Neon database                   | Direct TLS check confirmed the dedicated `nqta_production` database                                                                                     |
| Migrations                               | Before initial app readiness: migrations 1/2; readiness applied 3/4 through the normal app path; subsequent direct check confirmed four history entries |
| Database after readiness                 | 25 tables, zero business rows; no demo seed imported                                                                                                    |
| Live account/loyalty core journey        | 14 real production checks passed, zero errors, exit 0                                                                                                   |
| Independent economic records             | Five purchases, one redemption event, five ledger stamps confirmed through direct PostgreSQL                                                            |
| Verification cleanup                     | All 23 business/authentication tables restored to zero rows; four migrations and four shared rate-limit rows preserved                                  |
| Mobile viewport                          | Fresh 390px public sign-in screenshot visually inspected; no horizontal overflow or Netlify badge                                                       |
| Physical phone, camera and native Wallet | Pending; no installation or physical-device outcome claimed                                                                                             |

The initial zero-row statement describes readiness before the authorized live journey; the cleanup result confirms the database returned to empty business/authentication tables afterward. Automated local results are recorded in [Wallet verification](wallet-verification.md): 350/350 tests, strict TypeScript, the production build and browser/PostgreSQL checks passed for this source. Those automated suites were not rerun against the live production database.

## Real production core journey

The successful run used Node 24 fetch against the actual production API, with one disposable owner/customer/shop and normal application sessions. It completed from 15:46:18 to 15:47:47 UTC on 8 October 2026. Evidence is retained locally in `nqta-production-core-report.json` and `nqta-production-core.log`; neither artifact contains account credentials.

The 14 checks covered empty initial business storage, owner signup and a one-time recovery key, publication of a privacy-complete five-stamp programme, phone-free customer signup with a private account ID/key, enrolment with zero stamps, and customer sign-out before earning. The authenticated merchant then resolved the public member QR and recorded five qualifying purchases. A repeated purchase key returned the original event instead of adding a duplicate; exactly one reward was issued. Public QR/signed-out access could not authorize redemption. After customer sign-in, the private confirmation code redeemed the reward exactly once across a repeated request. Direct PostgreSQL inspection confirmed five purchase events, one redemption and five ledger stamps.

Cleanup removed only this run's owned shop/customer/authentication records. It left zero owned verification rows, zero rows in all 23 business/authentication tables, the four migration entries and four shared global rate-limit rows. The temporary credential artifact was deleted.

Earlier browser checks verified owner/signup privacy gating and cashier invitation UI before a short assertion timeout and Playwright API transport interruption prevented that harness from finishing the customer flow. The later reliable API run above completed the core functionality. These harness interruptions are not presented as a reproduced application defect. The 390px visual check is a browser viewport check; actual phones, recovery across devices, live staff acceptance/revocation and native Wallet delivery still need verification.

## Native Wallet activation

- Google issuer **3388000000023200992** was created after explicit acceptance of the Google Wallet API terms. It remains in **Demo Mode**. An initial Nqta Loyalty class exists as a draft; it is separate from runtime per-shop classes.
- The owner completed Google Cloud password re-authentication directly in Google's browser page; the authenticated Cloud console is now accessible. The earlier authentication blocker is resolved. No password was read, exported, guessed or reset by the agent. Project creation displayed separate [Google Cloud terms](https://cloud.google.com/terms), for which explicit owner approval has been requested. Those terms have not been accepted and no Cloud project has been created yet. API/service-account/key setup remains pending; no billing or Free Trial was enabled. The issuer business profile has no existing identity profile and needs the actual account type, legal name and address. Those facts have been requested from the founder; a partial profile editor was cancelled without saving. The actual class logo and public website do not establish a completed business profile. Publishing has not been requested or approved.
- Apple certificate access currently reports **Access Unavailable**. No usable Pass Type certificate/private key is configured, and no paid enrollment was made.
- Wallet actions remain disabled on the public app while genuine provider configuration is absent. Native installation, signed-out earning from an installed card and real update delivery still need Android/iPhone checks after activation.

Use [Wallet setup](wallet-setup.md) for the provider configuration and [message-free launch](message-free-launch.md) for account and recovery operation.

## Remaining launch work

1. Complete live cross-device recovery and staff invitation acceptance/revocation checks. The core owner/customer earning/redemption journey and cleanup have passed.
2. Complete Google project/API/service-account setup, the truthful business profile and publishing approval; obtain Apple signing access if an eligible existing team is available.
3. Verify actual phone enrolment, account recovery, camera/manual member entry, earning and reward confirmation. After provider activation, verify native installation and progress refresh.
4. Assign operational backup/restore ownership and verify the production restore procedure without replacing active customer data. Complete each merchant's actual privacy contact, location and reward/refund operating terms before onboarding.

The free host/database allowances still bound capacity. Existing isolated encrypted-restore checks prove the implementation's restore path, but they do not substitute for assigned production operations. Merchant subscription collection remains manual; the app does not charge billing automatically.
