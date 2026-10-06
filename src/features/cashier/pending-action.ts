import type { PurchaseInput, RedemptionInput } from '@/server/loyalty/types';

export type PendingAction = {
  membershipId: string;
  customerName: string;
} & ({ kind: 'purchase'; input: PurchaseInput } | { kind: 'redemption'; input: RedemptionInput });

// Keep the original confirmed payload across dialog closure, navigation and reload.
// Scope storage to the individual staff account and shop. No phone number is stored.
export const pendingActionKey = (shopId: string, userId: string) =>
  `nqta.pending.${shopId}.${userId}`;

export function readPendingAction(key: string): PendingAction | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const saved = JSON.parse(raw) as PendingAction;
  if (
    !saved.membershipId ||
    !saved.input?.idempotencyKey ||
    !['purchase', 'redemption'].includes(saved.kind)
  )
    throw new Error(
      'The pending confirmation could not be read. Ask the owner to reconcile this device before recording another receipt.',
    );
  return saved;
}

export function savePendingAction(key: string, action: PendingAction) {
  try {
    localStorage.setItem(key, JSON.stringify(action));
  } catch {
    throw new Error(
      'Allow browser storage so this confirmation can be recovered before recording the receipt.',
    );
  }
}
