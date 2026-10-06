import type { Actor, MembershipCard } from '@/server/loyalty/types';
export type { MembershipCard };
export type Shop = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  location: string;
  theme: string;
  status: string;
  currency: string;
  subscription_status: string;
};
export type Programme = {
  id: string;
  threshold: number;
  reward_description: string;
  eligibility: string;
  terms: string;
  status: string;
  version: number;
  revision: number;
};
export type Workspace = {
  actor: Actor;
  shop: Shop;
  programme: Programme | null;
  isDemo: boolean;
  development: boolean;
  hostedTest: boolean;
};
export type Member = {
  id: string;
  name: string;
  phone: string;
  memberCode: string;
  totalStamps: number;
  progress: number;
  threshold: number;
  availableRewards: number;
  visits: number;
  joinedAt: string;
  lastVisit: string | null;
};
export type Activity = {
  id: string;
  membershipId: string;
  name: string;
  memberCode: string;
  kind: string;
  amountMinor: number | null;
  qualifies: boolean;
  reversed: boolean;
  reason: string | null;
  at: string;
  staffName: string;
};
