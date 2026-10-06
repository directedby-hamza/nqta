export type Actor = { userId: string; shopId: string; role: 'owner' | 'cashier'; name?: string };
export type Reward = {
  id: string;
  description: string;
  state: 'available' | 'redeemed' | 'revoked';
  createdAt: string;
  redeemedAt?: string;
};
export type MembershipCard = {
  id: string;
  memberCode: string;
  name: string;
  phone?: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  theme: string;
  location: string;
  programmeId: string;
  threshold: number;
  rewardDescription: string;
  eligibility: string;
  terms: string;
  progress: number;
  totalStamps: number;
  rewards: Reward[];
  needsReview: boolean;
  status: string;
  consents?: { sms: boolean; whatsapp: boolean };
};
export type PurchaseInput = {
  membershipId: string;
  idempotencyKey: string;
  qualifies: boolean;
  amountMinor?: number | null;
  receiptReference?: string;
};
export type PurchaseResult = {
  eventId: string;
  progress: number;
  totalStamps: number;
  availableRewards: number;
  newlyIssuedRewardId?: string;
};
export type RedemptionInput = {
  rewardId: string;
  challengeId?: string;
  code: string;
  idempotencyKey: string;
};
export type RedemptionResult = { eventId: string; rewardId: string; state: 'redeemed' };
export type ReversalInput = { eventId: string; reason: string; idempotencyKey: string };
export type ReversalResult = { eventId: string; needsReview: boolean };
