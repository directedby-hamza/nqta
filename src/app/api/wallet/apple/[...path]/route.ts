import { after, type NextRequest } from 'next/server';
import { getDatabase } from '@/server/db/client';
import { testAccessResponse } from '@/server/test-access';
import { walletOptions } from '@/server/wallet/options';
import { createAppleWebService } from '@/server/wallet/apple-web-service';
import { flushWalletUpdates } from '@/server/wallet/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const denied = testAccessResponse(request);
  if (denied) return denied;
  if (!walletOptions().apple)
    return Response.json(
      { error: 'Wallet is unavailable right now. Please try again later.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const db = await getDatabase();
    const segments = (await context.params).path;
    const response = await createAppleWebService(db)(request, segments);
    if (response.ok && request.method === 'POST' && segments[1] === 'devices') {
      try {
        after(async () => {
          await flushWalletUpdates(db, { limit: 2 }).catch(() => {});
        });
      } catch {
        /* The persisted queue remains due for normal traffic or the CLI. */
      }
    }
    return response;
  } catch {
    return Response.json(
      { error: 'Wallet is unavailable right now. Please try again later.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
