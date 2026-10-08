import { assertRuntimeConfiguration } from '../src/server/environment';
import { getDatabase } from '../src/server/db/client';
import { walletOptions } from '../src/server/wallet/options';
import { flushWalletUpdates } from '../src/server/wallet/delivery';

async function main() {
  let db: Awaited<ReturnType<typeof getDatabase>> | undefined;
  try {
    assertRuntimeConfiguration();
    const providers = walletOptions();
    if (!providers.google && !providers.apple) throw new Error('No configured Wallet provider.');
    db = await getDatabase();
    let delivered = 0,
      failed = 0;
    for (let batch = 0; batch < 20; batch++) {
      const result = await flushWalletUpdates(db, { limit: 5 });
      delivered += result.delivered;
      failed += result.failed;
      if (result.delivered + result.failed === 0) break;
    }
    console.log(JSON.stringify({ delivered, failed }));
    if (failed) process.exitCode = 1;
  } catch {
    console.error(
      'Wallet synchronization could not finish. Check private configuration and retry; no credentials are printed.',
    );
    process.exitCode = 1;
  } finally {
    await db?.close().catch(() => {
      process.exitCode = 1;
    });
  }
}
void main();
