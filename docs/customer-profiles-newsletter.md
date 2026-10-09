# Customer profiles and newsletter preparation — 9 October 2026

New customer signup collects a full name, phone number, email address and password in one visible form. All profile fields are required, with browser autocomplete for name/email and the existing phone normalisation and password-manager support. Names may contain one or several words; the application does not invent a first-name/last-name requirement. Returning signed-in customers still go directly to their original QR card without completing the form again.

The optional checkbox names the shop and asks whether the customer wants its email news and offers. It starts unchecked and is independent of saving a loyalty card. Email permission can be changed in the card's settings without changing the QR or points. No email or other message is sent by this feature, and no provider, native Wallet or paid service is activated.

## Stored data and compatibility

The modern `/api/join` request supplies `profile: { fullName, phone, email }`; the server validates all three fields and stores the declared contacts on that membership. Phone remains an unverified sign-in identifier; neither contact field establishes identity or enables a password reset. Existing name/contacts requests and existing accounts remain compatible. Rejoining an existing membership never overwrites its contacts or grants new permission.

Email choices use the existing append-only `consents` table, channel `email`, wording version `email-newsletter-1.0`, database timestamp and sequence. Missing historical email consent means false. Legacy preference updates that omit email preserve the email choice. Changes require the owning customer session and an active card; opting in requires a saved email. Fulfilled deletion clears contact information and appends an email withdrawal. Before clearing its address, it also withdraws that address from matching active cards at the same shop using wording version `email-newsletter-deletion-1.0`, so deletion cannot revive an older duplicate opt-in. A later explicit opt-in remains possible without retaining the deleted account's contact data. No migration or historical backfill is needed.

Full names use the existing customer profile; contacts and permissions are scoped to shop memberships. A future feature for independently editable shop-specific names would need its own data model and migration.

## Merchant access and export

The validated shop owner sees full names, declared phone/email and the latest email preference with its update time on Customers. Cashiers receive a masked phone and no raw email, phone or newsletter metadata. Server permission checks use the staff member's actual database role.

`GET /api/customers/newsletter-export` is owner-only, uncached and returns a CSV with full_name, email, phone and consent_updated_at. Only active memberships with valid saved email and a current explicit opt-in can be included. Addresses are normalised and deduplicated, and a more recent withdrawal for an address at that shop takes precedence. Spreadsheet cells are escaped against formulas; the audit records a recipient count without contacts. Export activity remains a separate action.

This is a current permission snapshot, not a mailing service. When adding campaigns later, refresh permission before each send and integrate recipient email confirmation, unsubscribe links and sending-domain authentication. Google's [email sender guidelines](https://support.google.com/mail/answer/81126?hl=en) recommend explicit subscription, email confirmation and easy unsubscription; bulk messages have additional sender requirements. An unchecked checkbox never means the mailbox has been confirmed.

## Proposed next priorities

1. A merchant view of customers who have not returned for a chosen period, based on real qualifying purchase dates. Show the count, last visit and current permission, without automatically messaging anyone.
2. A “bring a friend” programme with a bonus only after the referred customer's first qualifying purchase, with a per-customer cap and duplicate/fraud controls.
3. French, Arabic and Darija customer copy, with shop-branded rewards and a clear “one visit left” milestone on the existing card.

These are proposed additions, not features included in this release. Validate the first two with a few Marrakech shop owners before expanding the product.

## Verification and publication

The new behavior was reproduced before implementation: missing required profile fields, missing merchant contact/export fields, and duplicate-address withdrawal/deletion cases. Focused backend checks passed 27/27 across profile consent, reporting and deletion; authenticated CSV API coverage passed 16/16 with real hashed staff sessions. The combined customer/password/staff browser suite passed 17/17; a further owner contact/CSV download/withdrawal browser check passed, for 18 covered browser scenarios. The original verified-contact five-purchase/reward journey also passed. Its first owner-check run omitted the required Origin header in a test-only PATCH and correctly received 403; the corrected request passed without weakening application protection.

Independent review identified the deletion/duplicate-address issue; it was reproduced RED and fixed GREEN, with later explicit re-opt-in retained. The production backup before publication contains 25 tables / 76 rows, encrypted and private. The first full-suite run passed 421/422; the disposable database drill still expected only two marketing channels after deletion. Its assertion now checks all three channels are withdrawn. The final full-suite run passed 423/423 across 43 files, with two isolated workers and 60-second test/setup limits. Typecheck, formatting, diff checks and the production Webpack build passed. Published source/deployment evidence will be recorded once complete.
