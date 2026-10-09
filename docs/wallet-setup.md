# Native Wallet cards

**Deferred on 9 October 2026 at the founder's request.** The current product uses saved web cards. Customer Wallet actions are removed; server issuance, downloads, callbacks and delivery are disabled even with valid credentials. No Smartix runtime integration or migration was activated, and no customer membership was issued through it. Existing accounts and loyalty records are preserved.

The adapter documentation below is historical implementation material for a possible later feature. It does not describe the currently available customer journey.

The implementation uses real provider formats. Provider account approval, credentials, public deployment and physical-phone installation are separate activation steps. Neither provider is currently configured in the project's private environment. The protected synthetic Netlify deployment is preserved; Wallet actions are disabled in `HOSTED_TEST_MODE`, because Google's public images and Apple's native callbacks cannot use its browser Basic password.

## Google Wallet

1. Use the founder's [Google Pay & Wallet Console](https://pay.google.com/business/console/) to establish a Wallet issuer and record its numeric issuer ID. Complete the account's business details truthfully. Follow Google's [issuer setup](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding).
2. In a dedicated Google Cloud project, enable the Google Wallet API. Create a service account and grant its email the **Developer** role on the Wallet issuer. Follow [REST authentication](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/auth/rest). Download its private JSON key into a private location; do not commit or upload it to this repository.
3. Base64-encode the complete service-account JSON into `GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64`. Set `GOOGLE_WALLET_ISSUER_ID` and the public HTTPS `APP_URL` on the app server. Keep all of these server-side, without `NEXT_PUBLIC_` prefixes.
4. Use `GOOGLE_WALLET_PUBLISHING_ACCESS=demo` only in development with the issuer's authorized test accounts. A production process requires `approved`; setting this value is an operator assertion, not a way to obtain Google's approval. Request actual [publishing access](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/request-publishing-access) before customer use.
5. Verify that `/wallet/nqta-logo.png` is public on the deployed origin. Sign in as a real customer, open their card and choose Add to Google Wallet. Confirm Google's own Add screen on Android and inspect the saved QR and stamp progress.

The service creates stable per-shop LoyaltyClass and per-membership LoyaltyObject resources before returning a short, signed Save link. Classes are submitted for review without overwriting Google's approval state. A Save link refers only to the existing opaque object ID and expires after five minutes. A delayed synchronization returns an unavailable message; it does not pretend the pass was saved.

The customer Add action uses Google's unmodified English primary SVG, with the official condensed SVG on narrow screens. The artwork keeps its proportions, minimum height and clear space; loading feedback appears separately. Sources and conditions are in [Google's brand guidelines](https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines). Apple's action uses ordinary editorial text rather than licensed badge artwork.

## Apple Wallet

The following steps describe the deferred local signing adapter. External shared-signing probes succeeded, but their limited allowances did not meet the founder's current zero-payment product requirement. The research and limits are recorded in [Apple Wallet shared signing](apple-wallet-shared-signing.md); this provider work is paused.

1. Use an existing eligible Apple Developer account to create the Nqta Pass Type ID and its certificate, following [Apple's Wallet certificate instructions](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates/). Record the exact Pass Type ID and ten-character Team ID. Account eligibility and any membership cost are external prerequisites; this implementation does not enrol or purchase a membership.
2. Keep the matching certificate and private RSA key privately, export each as PEM, and obtain the corresponding WWDR intermediate from [Apple's certificate authority](https://www.apple.com/certificateauthority/). The app validates their signature chain against embedded public Apple roots, validity dates, matching key, certificate type, Pass Type ID and Team ID. Synthetic or self-signed certificates cannot enable the production provider.
3. Configure the server with `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`, base64 PEM values for `APPLE_WALLET_SIGNER_CERT_BASE64`, `APPLE_WALLET_SIGNER_KEY_BASE64` and `APPLE_WALLET_WWDR_CERT_BASE64`. If the key is encrypted, set `APPLE_WALLET_SIGNER_KEY_PASSPHRASE` privately.
4. Generate a separate random `APPLE_WALLET_AUTH_SECRET` of at least 32 characters, different from `SESSION_SECRET`. Preserve this secret while existing passes use it. Rotation changes native pass authorization and requires an explicit replacement/recovery plan; do not rotate it casually.
5. Deploy on the canonical public HTTPS origin. On iPhone, open a signed-in Nqta card in Safari, choose Add to Apple Wallet and confirm Apple's native Add screen. The browser first requests a cookie-bound download URL and then navigates to a genuine `.pkpass` MIME response. No account token is added to the URL.
6. Check device registration, stamp updates, shop pause/resume and card closure on the physical phone. Native callbacks use `/api/wallet/apple/v1/...`, not browser cookies or Origin. APNs uses certificate authentication over a bounded connection to Apple's production push endpoint. The pass contains its own scoped authorization token; that token cannot sign in or spend a reward.

The `.pkpass` shows a generic welcome, total earned points, separate reward-cycle progress and the member QR. It contains the packaged PNG assets, manifest and detached PKCS#7 signature. Closed passes are voided and lose their barcode and customer-card link. Apple receives a refresh signal and fetches the newest signed pass; offline phones may display older progress until they reconnect.

## Data and reliability

Wallet passes contain the shop, opaque member code, progress, available reward count, terms and ordinary card link. They contain no name, phone, email, password, account ID, recovery key or Nqta session token. A public QR allows an authenticated cashier in the correct shop to find the membership and record a purchase; it does not authorize customer operations or reward redemption.

Migration 4 adds `wallet_passes` and `wallet_devices`. Migration 5 adds declared phone/email on memberships for the enrollment walkthrough; these values remain outside native passes and verified account identity. Apply normal migrations on the intended production database without seeding it. Purchase, redemption, reversal, pause/branding and fulfilled deletion changes enqueue a new Wallet revision atomically. The global revision allocator serializes allocation until commit so native watermark polling cannot skip a concurrently committed update.

Delivery runs after transactions commit and is scheduled after selected authenticated app responses. Claims have a 60-second lease; Google delivery has a 35-second total deadline, and Apple push has a five-second deadline. Delivery acknowledges only its captured lease/revision. Concurrent newer changes remain queued. Failed delivery uses bounded backoff and never cancels a saved receipt.

Normal card/cashier traffic retries due work. An operator can also flush up to 100 due passes with the private CLI:

```sh
node --env-file=.env.production --import tsx scripts/sync-wallet.ts
```

This prints aggregate delivered/failed counts only. Run it in the deployed operator environment or an approved scheduler if timely updates are required while the shop is idle. Hosts differ in post-response execution support; verify the selected host's behaviour. No paid worker is provisioned automatically. Stop the dev server before any CLI uses the same local PGlite directory.

Changing a Google issuer or Apple Pass Type ID does not silently reassign existing passes. Plan an explicit replacement. Keep certificate expiry monitoring, private backups and an operator retry process in place. Provider approval, backend host allowances and physical phone support remain external conditions; the code does not establish a perpetual zero-cost service.

## Verification and known dependency advisory

Focused and full verification evidence is recorded in `wallet-verification.md` after execution. Tests use mocked Google transport and an explicit synthetic Apple trust root only inside isolated crypto fixtures. They verify signing and protocol behaviour without asserting that a real Apple phone trusts test certificates or that Google granted publishing access.

Joi is overridden to patched `17.13.8`. The latest node-forge `1.4.0` has a [signature-verification advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) with no published patch at inspection time. Nqta verifies certificates using Node's native `X509Certificate`, and uses forge only for parsing certificate fields and creating PKCS#7 signatures. Independent review replaced forge verification entry points with throwing sentinels and verified a generated signature with OpenSSL; no vulnerable forge verification call occurred. Keep the dependency monitored and update when a verified patch is released.
