# Simple customer access — approved 9 October 2026

The customer signs up once using a phone number and a password. First name and email are optional. Creating the account immediately opens the shop's browser card, without an account-ID screen, recovery-key download or acknowledgement. Returning to the same shop link on a signed-in browser opens the same existing card. A customer visiting another shop explicitly chooses to create its card; recognition never enrols them automatically.

The checkout QR comes before progress. A branded PNG containing only the shop name and opaque checkout code can be saved to Photos. It allows authenticated staff to award qualifying purchases even when the customer's browser is signed out. It grants no customer sign-in or reward-redemption authority. Progress requires the live card. Manual iPhone Safari and Android Chrome instructions explain adding a shortcut to the home screen; an independently opened browser may require one sign-in.

Phone numbers are unverified usernames, not proof of phone ownership. Signup accepts Moroccan 06/07 numbers and international numbers, normalising them before enforcing uniqueness. Signing in always requires the password. Shop contact details remain separate declarations with no promotional consent. Never merge an existing account by matching its declared contact number. An already authenticated legacy customer can add a sign-in number only after confirming their existing password. Legacy account IDs and previously issued recovery keys continue working through their existing backend paths.

New password sessions last at most 90 days, with HttpOnly, Secure production cookies and server-side expiry/revocation. Existing sessions are preserved. Signing out revokes the current session. No passwords, keys or session tokens enter QR payloads, URLs or browser storage. New accounts have no recovery key; there is no automatic reset via an unverified phone number. Wallet remains disabled, with no provider, SMS, email or new paid infrastructure involved. Hosting retains its current free-plan limits.

## Implementation and verification ledger

- Backend: additive migration 6 for nullable unique login_phone and nullable legacy recovery_key_hash; normalised password sign-in; explicit password-confirmed legacy alias adoption; readonly shop/card recognition. Workers own these independent modules and focused integration tests.
- Interface: remove mandatory recovery step; account-aware join retries without creating a second account; QR-first card, PNG saving and home-screen instructions; optional email; existing-account adoption in settings.
- Verify: real database authentication and API tests, legacy regressions, actual-browser signup/revisit/separate-session/failed-enrolment tests, actual PNG decoding and cashier earning without customer cookies. Run full Vitest suite, typecheck and production build, then independent review.
- Publish: preserve the GitHub main branch and existing customers, use the already authorised feature-branch deployment on the current free Netlify host, verify the published runtime and an isolated live signup. Record results below as they become available.

Decision: fixed 90-day sessions, without a new session-renewal subsystem. This keeps expiry and sign-out predictable while the saved QR remains usable for earning independently of a customer login.

Implementation checks: the combined password/customer/staff browser configuration passed 15/15, including actual downloaded PNG decoding and cashier earning with no customer login. The original real verified-contact customer journey also passed, including five purchases and single-use reward redemption. Focused API regression tests passed 15/15. Independent review found two customer-facing defects; both were reproduced by browser tests and fixed (2/2 RED→GREEN): auth-mode-specific settings/copy, and public shop context in saved links.

The first full Vitest run passed 398/400. One existing assertion still required an email (updated for the approved optional-email behavior); another existing privacy fixture exceeded its 30-second setup timeout. The fresh full run passed 400/400 across 41 files, using 60-second test/setup limits for this host without changing product behavior. Strict typecheck and the Webpack production build passed, including the generated home-screen icon. All final local checks are green.

Before deployment, the published migration-5 implementation created an encrypted backup of all 25 tables / 61 rows. It remains private with mode600; no database migration or restore was executed by that backup step.

Status: implementation complete and independently reviewed, with 400/400 tests, 15/15 combined browser checks plus the original verified-contact journey, typecheck and production build passing. Publication follows on the current free Netlify host; its exact deployed commit and live verification are recorded in the production deployment ledger.

Shortcut instructions were checked against the current [Apple iPhone guide](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios) and [Google Chrome help](https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&hl=en). This does not claim physical-device installation verification.
