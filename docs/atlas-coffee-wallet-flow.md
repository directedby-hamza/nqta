# Atlas Coffee enrollment and Wallet journey

Atlas Coffee — Marrakech is the founder-authorized imaginary shop for this walkthrough. It is stored through the ordinary production application, with demo/test modes disabled. It is not an operating café and no real coffee is owed. Its privacy contact is explicitly a non-deliverable showcase placeholder; replace it with the merchant’s actual contact before commercial use.

- Join: https://nqta-hamza.netlify.app/join/atlas-coffee
- Printable/scannable QR: https://nqta-hamza.netlify.app/shops/atlas-coffee-join-qr.png
- Cashier: https://nqta-hamza.netlify.app/cashier

The shop is retained for the founder’s phone/computer walkthrough. Its owner credentials and recovery key are kept only in the gitignored `.env.showcase.private`, with private file permissions. They are not published in this document. Do not delete this shop during disposable verification cleanup.

## Customer steps

1. Scan the shop poster or open the join link on the phone.
2. Enter a phone number with its country code, an email address, and a private password of at least ten characters. The password is the customer’s private access code. First name is optional.
3. Choose **Save my card**. The application creates the account and displays its account ID and one-time recovery key. Save both, then confirm the acknowledgement. Passwords/recovery keys are not added to URLs or browser storage.
4. If Apple signing is genuinely configured, choose **Save to Apple Wallet**. Nqta saves the membership, requests its authenticated pass, and navigates to the same-origin native download. iPhone shows Apple’s own Add confirmation; the customer must confirm it.
5. When Apple signing is unavailable, the screen states **Apple Wallet is not available for this shop yet** and opens the actual saved browser card. This does not install a Wallet pass.
6. On repeat earning visits, an installed Wallet pass exposes the existing member QR without customer login. The authenticated cashier scans it, reviews the paid receipt and confirms the purchase. One qualifying paid receipt earns one point/stamp; five earn the illustrative next coffee reward. A duplicated purchase request does not grant another point.
7. The native card displays **Hey, welcome back!**, total points earned, progress toward the next reward and the member QR. Total points and the repeating five-point reward cycle are separate values. Committed purchases queue a signed update; an offline device can retain older progress until it reconnects.
8. To spend an earned reward, open the private Nqta card and obtain the protected confirmation code. A public member QR alone cannot spend rewards.

If issuance fails, the account/recovery-key step remains available, retry uses the same saved membership, and **Open my saved card** opens the browser card. If enrollment is interrupted by reloading before the key is saved, the existing key-replacement flow requires the password and a new recovery key; contact details must be entered again rather than silently discarded.

## Contact data and activation

Migration 5 stores declared contact details on the shop membership. Phone/email are normalized and validated before enrollment. They are not verified identities, do not populate `customers.phone`, do not merge accounts, and do not enable marketing consent. Fulfilled shop deletion clears both declared values. The native pass excludes name, phone, email, password, account ID and recovery key.

The founder’s current Apple certificates portal reports **Access Unavailable**; a targeted certificate-only check found no existing Pass Type certificate. No Apple signing credential or paid membership has been added. Native installation and physical-phone point updates remain unverified. See [Wallet setup](wallet-setup.md) for activation and [Wallet verification](wallet-verification.md) for automated evidence.
