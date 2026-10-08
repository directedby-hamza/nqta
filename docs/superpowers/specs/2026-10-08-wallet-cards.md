# Native loyalty Wallet cards

The founder explicitly requested and authorized implementation of Apple Wallet and Google Wallet cards on 8 October 2026. The outcome is registration and installation once, then presenting the saved Wallet QR at repeat earning visits without opening Nqta or signing in. This extends the existing application; it does not change the public member code into an account credential.

## Customer and cashier experience

The customer card offers Add to Google Wallet and Add to Apple Wallet actions when the corresponding real provider is configured. Authenticated issuance checks the membership belongs to the customer and is active. Each pass contains the shop name/theme, the existing member QR, current stamp progress, available rewards, eligibility/terms and a link to the ordinary customer card. Passwords, recovery keys, account IDs, contact details and account session tokens never appear in Wallet data or barcodes. The cashier scanner accepts the existing member code unchanged, including when the customer browser has signed out.

Purchase, reward redemption, reversal, deletion and shop branding/pause changes enqueue Wallet updates in the same database transaction as the corresponding saved change. Wallet data is a display of Nqta's authoritative ledger; delayed/offline updates cannot create rewards. Provider failures never change a saved purchase result, its idempotency key or its economic effect. Reward redemption keeps the existing customer-confirmation boundary; a copied public QR is insufficient to spend a reward.

## Providers

Google uses genuine LoyaltyClass/LoyaltyObject resources, server-side RS256 service-account credentials, deterministic per-shop/per-membership resource IDs and a short Save JWT referring only to an existing object ID. Service-account OAuth and REST requests go to fixed Google endpoints with bounded timeouts. The object is created/updated before the save link is returned. Production availability requires explicitly confirmed issuer publishing access; developer demo access is not presented as production activation.

Apple returns a genuinely signed storeCard .pkpass with required PNG assets, a manifest and detached PKCS#7 signature using the supplied Pass Type ID certificate/key and WWDR intermediate. Serial number is the Wallet pass ID; the barcode remains the member code. A separate pass-scoped authentication token, derived from a dedicated strong secret, permits only native Wallet refresh/registration, never account access or redemption. The pass uses a canonical HTTPS webServiceURL.

Dedicated native Route Handlers implement Apple device registration/unregistration, updated-serial listing, authenticated latest-pass download and bounded logging. Native machine requests use pass-scoped authorization rather than browser Origin/cookie authentication. The existing browser-origin checks and protected hosted-test gate remain intact. Updated serial listing uses a global monotonic revision, including concurrent updates across multiple cards. APNs signals request a refresh; actual delivery is not guaranteed. Invalid/unregistered device tokens are removed without logging their values.

## Persistence and delivery

Append migration 4; applied migrations 1–3 remain unchanged. Wallet pass rows are unique per membership/provider and retain external IDs, global revisions, synced revisions, bounded retry state and expiring delivery leases. Apple device registrations are scoped to a pass. No network request executes inside a business transaction. Delivery claims pending work under a short transaction, performs provider requests after commit, then acknowledges only its lease/revision; changes made during delivery stay pending. Stale lease holders are rejected before provider delivery, and acknowledgements cannot consume a newer revision. Repeated issuance returns the same pass identity.

Mutations schedule bounded post-response delivery and ordinary card/cashier reads retry pending work. A private CLI can flush retryable work without introducing a paid worker. Background execution remains host-dependent; production operations must arrange and verify ongoing retries. Closed memberships update to inactive/voided passes, stop new issuance, and never leak removed identity. Pausing a shop retains cards and earned rewards while displaying that new earning is paused.

## Honest activation

No provider is enabled by fake certificates, unsigned JSON, arbitrary save URLs or development keys shipped to customers. Missing/malformed credentials produce safe unavailable responses; the core app keeps working. Secrets stay server-side and out of logs, URLs, Git and browser storage. Read only relevant configured credential locations; never search unrelated personal files. No paid enrollment, upgrade or billing action is authorized by the request to implement a previously believed-free feature. Real issuer accounts/certificates, public deployment and physical-phone installation require separate evidence. The current protected Netlify site is preserved.

## Verification

Tests cover customer ownership, no sensitive pass fields, cryptographic signatures/JWTs, provider timeouts, real scanner acceptance after customer sign-out, update transaction rollback/idempotency, concurrent leases/newer revisions, revocation/deletion, native callbacks without weakening browser-origin security, and disabled-provider UI. Mocked transport and locally signed fixtures verify code, not provider publishing approval or native device trust. Run full unit/integration, strict types, production build and relevant browser journeys, then obtain independent review.
