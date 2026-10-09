export function walletOptions() {
  // Native Wallet is deferred. Credentials cannot activate issuance or delivery.
  return { google: false, apple: false };
}
