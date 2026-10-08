import { hostedTestMode } from '../environment';
import { appleWalletOptions } from './apple';
import { googleWalletOptions } from './google';

export function walletOptions() {
  if (hostedTestMode()) return { google: false, apple: false };
  return { google: googleWalletOptions(), apple: appleWalletOptions() };
}
