# Apple Wallet without the founder's Developer membership

**Paused on 9 October 2026.** The founder removed native Wallet from the current product because provider credits could create future costs. These findings are retained as research. No external signer is connected to Nqta customer memberships; no provider runtime or additional database migration was activated.

Verified on 8 October 2026. The founder's requirement is genuine Apple Wallet storage, a greeting, actual Nqta point totals and a cashier QR, without purchasing Apple Developer membership or introducing paid services. An authorized provider can sign with its own Apple certificate. The founder does not have to own that certificate. This changes who signs the pass; it does not remove Apple's signature requirement.

The public Nqta application has not yet been switched to an external signer. The existing native actions remain unavailable until a suitable provider has been configured and the complete membership journey verified. Existing Atlas memberships and receipts are preserved.

## A real signed-pass probe succeeded

A disposable, explicitly labeled integration-validation pass was issued through [WalletMCP's documented REST API](https://walletmcppass.com/llms-full.txt). It contains no customer data, Nqta account credentials or real membership. Its QR is `NQTA-VALIDATION-NOT-A-CUSTOMER` and cannot earn or redeem Nqta rewards.

| Check                          | Actual result                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial issuance               | HTTP 200; genuine `application/vnd.apple.pkpass`; 15,094 bytes                                                                                    |
| Field update                   | HTTP 200; the same pass identifier and serial; validation points changed from 0 to 1                                                              |
| Updated download               | HTTP 200; native MIME; 15,099 bytes                                                                                                               |
| Archive manifest               | Every packaged payload SHA-1 digest matched; no duplicate or unexpected entries                                                                   |
| Detached CMS signature         | OpenSSL verified integrity against the exact manifest bytes; independent review also verified CMS with Apple certificate-chain validation enabled |
| Certificate trust and identity | The actual CMS signer chains to Nqta's pinned Apple roots; certificate UID/OU match each pass's Pass Type ID and Team ID                          |
| Certificate purpose            | Apple Pass Type ID OID `1.2.840.113635.100.6.1.16` present                                                                                        |
| Certificate dates              | 28 August 2026 through 27 September 2027                                                                                                          |
| Provider update service        | Present in the actual signed pass                                                                                                                 |
| Money or identity disclosure   | No payment credentials, Google sign-in, customer contact information or provider account used                                                     |
| Physical iPhone/APNs           | Not yet verified; no device had installed this validation pass, so the update response reported zero notified devices                             |

The probe proves that a free third-party Apple signing path is operational. It does not establish that the founder installed the pass, that the cashier enrollment integration is complete, or that the service supports permanent commercial use.

WalletMCP permits updates for at most 720 hours from creation. This probe's update window ends **7 November 2026, 17:30:25 UTC**. Installed passes then retain their last state while the provider deletes stored update content. The download links last one hour. Its free limit is 30 issuance/update calls per IP per day within a shared 500-call pool. Plain HTTP requests receive `402` when free capacity is exhausted; the probe uses no payment SDK or payment-signature header. These constraints make this a technical validation route, not a verified ongoing commercial backend.

## Smartix LIVE signing and updating also succeeded

The approved free Smartix account issued one LIVE validation pass, `TDZH-MKJD-QWCN-U4Q2`, from the custom generic validation template. Its QR is `NQTA-SMARTIX-VALIDATION-NOT-A-CUSTOMER`; it is not connected to a customer membership and cannot earn or redeem Nqta rewards.

| Check                            | Actual result                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| LIVE issuance                    | HTTP 200, `mode: live`, 10 free credits consumed                                                                                                 |
| Initial native download          | HTTP 200, `application/vnd.apple.pkpass`, 9,940 bytes                                                                                            |
| Greeting, points, barcode        | `Hey, welcome to Nqta!`, `POINTS: 0`, expected validation QR                                                                                     |
| Point update                     | One PATCH returned HTTP 200; the same pass downloaded with `POINTS: 1`                                                                           |
| Update credit charge             | Quote: 1 credit; actual response: 0, using an included engagement; no unlimited allowance inferred                                               |
| Integrity and Apple trust        | Both archives' manifest hashes and actual CMS signatures verified against pinned Apple roots; independently reviewed                             |
| Signing identity                 | `pass.uk.smartix.client.65`, Apple team `37MPX49VX9`; actual signer UID/OU match the payload                                                     |
| Signer purpose and validity      | Apple Pass Type ID OID present, leaf `CA:FALSE`, digital-signature usage; 8 October 2026–7 November 2027 UTC                                     |
| Existing-card refresh credential | The original native token successfully fetched the updated, verified pass through the Apple web-service endpoint; token values are not published |
| Remaining free balance           | 90 credits; paid balance and overdraft 0; auto top-up disabled; no card                                                                          |
| Physical iPhone and delivery     | Installation and APNs delivery remain unverified                                                                                                 |

The initial native download failed with the provider's `S3 - coding error?` after external branding URLs were supplied through the dynamic-value editor. Uploading the existing public Nqta Apple images through Smartix's normal image library resolved the download. Use provider-hosted image assets for this integration; ordinary URL syntax validation did not guarantee native image retrieval.

This proved an operational Apple-trusted signing and update path without the founder buying Apple Developer membership. It never activated native Wallet in the public Nqta app. On 9 October the founder deferred this integration because of the daily refresh cap and limited credits. The Nqta ledger continues to record every valid purchase immediately.

## Provider choices

| Provider    | Shared Apple signing                               | Free allowance                                                                                                                | Suitability                                                                                                                        |
| ----------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| WalletMCP   | Actual signed pass and update verified             | 30 calls per IP per day, within 500 globally; update retention at most 30 days                                                | Account-free technical validation; permanent commercial use not established                                                        |
| Smartix     | Actual Apple-trusted LIVE pass and update verified | Actual billing: 100 monthly credits; this template issue 10, patch quote 1; first update charged 0 from an included allowance | Real free validation path; daily refresh and monthly capacity limit commercial suitability; future API-fee terms remain unresolved |
| Pass Studio | Its own certificate is the documented default      | Free API; 50 non-expiring welcome credits; publishing 10, issuance 1, push 1                                                  | Documented agency/client programs and a finite commercial pilot; the welcome balance is not a recurring allowance                  |

[Smartix pricing](https://www.smartix.uk/pricing/) advertises 200 free monthly credits and free API access. The actual newly created account instead shows **100 recurring monthly free credits**, with the next allowance date **8 November 2026**. Use the account's observed allowance for capacity planning; the 200-credit marketing claim has not been reconciled. The account has zero paid credits, zero overdraft, automatic top-up disabled and no payment card. No paid plan or credit purchase was activated.

The custom generic validation template's actual LIVE quotes were **10 free credits to issue one pass** and **1 credit to patch one pass**. The first quotes showed 100 available credits; immediately before the PATCH, the quote showed 90. Actual issuance used 10; the first PATCH used 0 from an included engagement allowance, leaving 90. These differ from the public pricing table's custom-pass costs of 4 for issuance and 2 for an individual patch. Use live quotes and actual charges; these observations do not establish general pricing or identify an account plan.

Its [PAYG terms](https://docs.smartix.uk/terms/payg-terms/) still describe an unspecified monthly API credit fee and recommend own certificates for production. A real authenticated pass API read now succeeds without paid activation, but that does not resolve future monthly billing or establish permanent commercial eligibility. Paid API activation, credit purchases, overdrafts, automatic top-ups and card entry remain outside the authorized zero-MAD scope.

Smartix's [notification instructions](https://docs.smartix.uk/studio/notifications/) describe a shared-signing limit of **one update or notification per pass per day**, including API actions. Its current pricing confirms shared-credential daily limits without the exact number. Even within the actual 100-credit monthly allowance, this restriction would prevent a second same-day purchase from immediately refreshing its Wallet balance. The exact enforced limit remains unverified on the new account. Successful API authentication and free credits alone do not establish the required update behavior.

[Pass Studio certificate documentation](https://www.thepassstudio.com/docs/certificates), [free billing allowance](https://www.thepassstudio.com/docs/billing) and [agency partner terms](https://www.thepassstudio.com/agencies/partner-terms) expressly support provider signing and managed client programs. One published design and one issued card leave 39 welcome credits for individual pushes. This must not be described as unlimited or permanently renewable free operation.

PassSlot and PassThru shared demonstration certificates have evaluation restrictions; AddToWallet's commercial instructions and Passcreator signup require own certificates. Passinstance's Free pricing explicitly describes evaluation. Their attractive free quotas do not establish the required production rights.

## Historical integration acceptance criteria

1. Keep the existing customer enrollment, recovery-key acknowledgement and owner-bound pass download.
2. Issue one stable external pass per membership and preserve its provider identity across retries and updates.
3. Send the provider only shop branding, generic greeting, opaque cashier QR, current actual point total, reward-cycle progress and ordinary card link. Do not send contact information, account IDs, password, recovery key or session.
4. Store API/update credentials privately on the server and bind external pass IDs to the customer-owned membership. Provider failures must not lose or duplicate a saved purchase.
5. Synchronize actual purchases, reversals, rewards, shop pauses and card closure through the existing revision/retry mechanism. A successful provider API update is distinct from an iPhone receiving it.
6. Keep free allowance checks and operator status visible. Pause unavailable Wallet work without buying anything automatically or pretending points were delivered.
7. Verify a physical iPhone Add screen, a real membership QR scan and automatic point refresh before reporting the complete native flow as working.

## Smartix account and API checkpoint

The founder approved creating the free Smartix account and accepting its linked terms. That permission request is resolved. Ordinary account signup and personal onboarding completed, and the shared Smartix Wallet credential option was configured. No customer data was supplied.

A custom API key was created for pass operations only; client/account functions were not enabled. An authenticated request to `GET https://api.smartix.uk/passes-0103/getActivePassesCount` returned HTTP 200 with `{"ok":true,"total":0}` before validation issuance. One LIVE validation pass now exists. This verifies that the account and key can access that pass API endpoint without purchasing API access. Private account and API credentials remain outside these documents.

A custom generic validation template, `other_g_RG3_696_03E_1N7_49V`, was created through normal Studio UI. `getTemplateVariables` returned HTTP 200 with ordinary nested `barcode`, `custom`, `pass`, `colours` and `images` values, including `custom.status` set to `"0"`. LIVE `quoteCredits/<templateId>/issue/1` and `quoteCredits/<templateId>/patch/1` returned the 10-credit and 1-credit quotes above.

At this checkpoint, Smartix LIVE issuance, signed `.pkpass` downloads, the point update and refresh with the original native credential are verified. Physical iPhone installation and APNs delivery remain unverified. The public Nqta app remains on its existing adapter; native enrollment and real membership synchronization have not been activated.
