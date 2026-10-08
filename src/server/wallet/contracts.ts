import type { MembershipCard } from '../loyalty/types';

export type WalletProvider = 'google' | 'apple';
export type WalletPass = {
  id: string;
  membershipId: string;
  provider: WalletProvider;
  externalId: string;
  revision: string;
  syncedRevision: string;
  updatedAt?: string;
  lockToken?: string;
};
export type WalletCard = { pass: WalletPass; card: MembershipCard };

export class WalletUnavailableError extends Error {
  readonly status = 503;
  constructor() {
    super('Wallet is unavailable right now. Please try again later.');
  }
}
