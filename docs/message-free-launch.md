# Password and recovery-key launch

The founder selected customer passwords and saved recovery keys on 8 October 2026. `AUTH_MODE=recovery-key` enables real password accounts for customers and shop staff without outbound authentication messages. This configuration is now published at [nqta-hamza.netlify.app](https://nqta-hamza.netlify.app), using a separate production database with demo/test modes disabled. The protected test site remains unchanged. [Production deployment status](production-deployment-status.md) records the live checks and outstanding work.

## Account ownership

Customers receive a generated account ID, set a password and save a recovery key. Neither a phone number nor the public member QR proves ownership in this mode. Sign-in restores the same customer identity and saved memberships. Recovery rotates the key, replaces the password and revokes previous sessions atomically. Customers without verified contact information cannot enable phone contact preferences.

Shop owners and directly invited staff continue to use email as a login identifier. In this mode it is **not a verified mailbox**: their row explicitly records `auth_method=recovery-key` and `email_verified=false`. Their key replaces email password-reset delivery. Existing unverified contact-mode accounts are not converted or granted access. Owners share expiring invitation links directly with their intended worker.

Save the key when it is first displayed. It is stored in PostgreSQL only as a hash and cannot be displayed again. Lost key + working password can generate a replacement customer key through the interrupted-save flow. Losing both password and key has no automatic recovery path; never authenticate someone from a member QR or display an OTP as a workaround. Account merges and assisted recovery require a separately reviewed ownership process.

## Configuration and release

1. Preserve the existing hosted test database, access gate and configuration.
2. Select a separate production HTTPS origin and database. Use `docs/production-environment.example` privately with `AUTH_MODE=recovery-key`, `HOSTED_TEST_MODE=false`, `DEMO_MODE=false`, TLS PostgreSQL and a strong session secret. Delivery provider settings can remain unset in this mode.
3. Apply all four immutable migrations with the existing migration command, then run the launch preflight. Do not seed production. Migration 3 keeps old phone accounts/data while permitting accounts without phone; migration 4 adds the native Wallet records and durable update queue.
4. Test a clean owner signup, saved key, owner sign-in/reset, worker invitation/acceptance/revocation and cross-shop restrictions.
5. On actual phones and a cashier device, join a shop, save the account bundle, add a qualifying receipt, redeem with customer confirmation, sign in on another device and recover with the key. Confirm the original activity and that old sessions/keys fail.
6. Confirm camera permissions/manual-code entry, persistence, private support contact, reward/refund terms and backup/restore ownership before onboarding a paying merchant.

The public production deployment and readiness check are confirmed. Its readiness request applied migrations 3 and 4 through the normal application migration path; a direct TLS database check confirmed four migration entries, 25 tables and zero business rows at that point. A subsequent real production API journey passed 14 checks: clean owner/customer signup, privacy-complete programme publication, signed-out customer earning, purchase retry deduplication, exactly one reward after five purchases, rejection of unauthenticated redemption and single-use private-code redemption across a retry. Direct SQL confirmed five purchase events, one redemption and five ledger stamps. All owned verification records were removed, restoring all 23 business/authentication tables to zero rows while preserving the four migrations and four shared rate-limit rows. No physical-device compatibility or native Wallet installation is claimed. Operational restore ownership, merchant privacy/contact/reward terms and actual phone/recovery/staff checks remain onboarding requirements. Free hosting/database allowances constrain capacity; this removes authentication message dependency but does not guarantee unlimited operation at zero cost. Subscription collection stays manual, and rewards are funded by the merchant.

## Development checks

Run the normal full unit/integration suite and type/build checks. The existing main Playwright suite verifies contact-mode compatibility. The separate `playwright.password.config.ts` uses an isolated local PGlite directory and `AUTH_MODE=recovery-key` to verify the customer password/recovery journey. Run the two browser configurations sequentially; only one local Next server may own `.next/dev`.

Never run test fixtures or recovery drills against the hosted test or live production database. Final verification evidence is recorded separately after execution.

## Verification on 8 October 2026

| Check                                                          | Result                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Full Vitest suite                                              | 26 files, 258 tests passed                                                                      |
| Strict TypeScript and Webpack production build                 | Both exited 0                                                                                   |
| Recovery-key browser configuration                             | 7 passed: 3 real customer/API journeys and 4 mocked staff UI journeys                           |
| Existing contact-mode browser configuration                    | 21 passed, 3 key-mode customer journeys intentionally skipped                                   |
| Independent code review                                        | Two findings fixed and regression-tested; no remaining actionable P1/P2                         |
| Separate PostgreSQL recovery/concurrency and encrypted restore | Passed, exit 0: 126 checks, 23 tables / 169 synthetic rows restored; both owned schemas removed |
| Initial GitHub integration attempt                             | Creating a feature branch returned HTTP 403, `Resource not accessible by integration`; later published through the authenticated owner browser |
| Public production deployment                                   | Published on `feat/native-wallet-cards`; live HTTPS sign-in/readiness checks passed; see [deployment status](production-deployment-status.md) |
| Real production core journey                                   | 14 checks passed, zero errors, exit 0; real signup, earning, retries/redemption and independent SQL; owned records cleaned |
| Physical phones and native Wallet installation                 | Pending; current Netlify test site is unchanged                                                 |

The interrupted-save regression binds key rotation to the account ID displayed in the form. A different account signed in from another tab cannot have its key replaced by that form, even when both accounts share the same password. Staff can reopen the recovery form after interrupting the replacement-key acknowledgement step.

The earlier GitHub integration restriction was resolved for publication through the owner's authenticated browser session. The deployed Wallet release includes the password/key implementation; its later full suite passed 350 tests, with the password/key browser configuration still passing 7/7. Those automated results are recorded local verification results, separate from the 14 real production checks above. The production origin and all four migrations are in place. Operational ownership, live cross-device recovery/staff checks and physical-device verification are tracked in [production deployment status](production-deployment-status.md).
