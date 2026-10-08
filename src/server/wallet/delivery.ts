import type { Database } from '../db/client';
import type { WalletProvider } from './contracts';
import { createWalletStore } from './store';
import { walletOptions } from './options';
import { syncGoogleWalletPass } from './google';
import { applePassTypeIdentifier, pushAppleWalletUpdates } from './apple';

// The lease is acquired in a short transaction; all network I/O happens after it
// commits. A captured revision is acknowledged, never a newer concurrent change.
export async function flushWalletUpdates(
  db: Database,
  options: { passId?: string; membershipId?: string; limit?: number } = {},
) {
  const available = walletOptions();
  const providers = (['google', 'apple'] as const).filter((p) => available[p]) as WalletProvider[];
  if (!providers.length) return { delivered: 0, failed: 0 };
  const store = createWalletStore(db);
  // Start before claiming: even waiting for a database connection consumes
  // this conservative budget. Leave 35 seconds for Google and lease headroom.
  const claimStarted = performance.now();
  const claimed = await store.claimPendingPasses({
    ...options,
    limit: options.limit ?? 1,
    providers,
  });
  const results = await Promise.all(
    claimed.map(async (pass) => {
      try {
        const latest = await store.getPassBySerial(pass.provider, pass.id);
        if (
          !latest ||
          latest.pass.externalId !== pass.externalId ||
          latest.pass.lockToken !== pass.lockToken ||
          performance.now() - claimStarted > 15000
        )
          throw new Error('Wallet pass unavailable.');
        if (pass.provider === 'google') {
          await syncGoogleWalletPass(pass, latest.card);
        } else {
          if (pass.externalId !== applePassTypeIdentifier())
            throw new Error('Wallet issuer changed.');
          const devices = await store.getAppleDevices(pass.id);
          const tokens = [...new Set(devices.map((device) => device.pushToken))];
          if (performance.now() - claimStarted > 15000)
            throw new Error('Wallet delivery lease needs a retry.');
          const outcomes = await pushAppleWalletUpdates(tokens);
          const statuses = new Map(outcomes.map((result) => [result.token, result.status]));
          for (const device of devices) {
            if (statuses.get(device.pushToken) === 'remove')
              await store.removeAppleDevice(pass.id, device.deviceId, device.pushToken);
          }
          if (tokens.some((token) => !['sent', 'remove'].includes(statuses.get(token) || 'retry')))
            throw new Error('Wallet delivery needs a retry.');
        }
        await store.markSynced(pass);
        return true;
      } catch {
        // Preserve the queued change without logging pass IDs, tokens or credentials.
        await store.markFailed(pass);
        return false;
      }
    }),
  );
  return {
    delivered: results.filter(Boolean).length,
    failed: results.filter((result) => !result).length,
  };
}
