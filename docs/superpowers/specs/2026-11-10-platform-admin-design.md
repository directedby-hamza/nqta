# Nqta platform administration

The founder needs a private platform dashboard because shops can currently use Nqta without any recorded subscription payment. Existing owner/cashier accounts are shop-scoped and must never gain platform access.

## Approach and decisions

Add a separate administrator identity, session cookie and `/admin` dashboard to the existing Next.js application. Reuse the existing database, password hashing, durable limits and UI primitives. A separate hosted administration app adds deployment and cross-origin complexity; adding a merchant role would weaken tenant separation. These are implementation choices made under the user's request to implement and deliver directly.

- One initial administrator is provisioned from a private CLI, with a random temporary password and mandatory password change. No public administrator registration or seeded production credential.
- Show all shops, owner contact, member/visit counts, recorded payments and access status. Do not expose customer contact databases or provide impersonation.
- Existing shops are **unreviewed**, with existing access preserved until the founder decides. Missing historic payment data is not evidence of nonpayment.
- New production shops require activation. Development/demo shops remain usable for existing local testing.
- Administrator can suspend or activate a shop with a required reason and optional last-valid access date. A dated active subscription expires after that Casablanca calendar day.
- Record actual received MAD payments manually, with amount, reference, access-through date and duplicate-submission protection. Recording payment activates/extends access. Payments can be voided with a reason; voiding adjusts totals only, and access changes are explicit and separately audited.
- Suspension/expiry blocks authenticated merchant operations and new customer enrolment at server/service boundaries. Existing customer cards, preferences and privacy requests remain accessible; no data is deleted. Owners can still sign in and view the subscription notice.
- Status changes and loyalty operations serialize on the shop row. Payment/access actions require admin authorization inside the transaction and retain an audit trail.
- No automatic bank charging, invented historical payments, mass suspension or new paid infrastructure.

## Delivery

Migrate additively, preserve the user edit in `docs/wallet-setup.md`, test admin isolation/session rotation/billing effects, run existing checks, back up the live database, publish through the established deployment path, provision the administrator and return the live link and credentials privately. Do not suspend real shops on the user's behalf without a shop-specific decision.
