import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/server/db/client';
import { testAccessResponse } from '@/server/test-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const denied = testAccessResponse(request);
  if (denied) return denied;
  try {
    await (await getDatabase()).query('SELECT 1');
    return NextResponse.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
