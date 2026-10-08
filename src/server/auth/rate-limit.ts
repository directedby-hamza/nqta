import type { Database } from '../db/client';
import { hashToken } from './crypto';

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Please wait before trying again.');
    this.name = 'RateLimitError';
  }
}

export async function reserveLimit(
  db: Database,
  input: { scope: string; key: string; limit: number; windowSeconds: number },
): Promise<void> {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isInteger(input.windowSeconds) ||
    input.windowSeconds < 1
  )
    throw new Error('Invalid request limit configuration.');
  const bucket = hashToken(JSON.stringify([input.scope, input.key]));
  const result = await db.query(
    `INSERT INTO request_limits(bucket) VALUES($1)
     ON CONFLICT(bucket) DO UPDATE SET
       attempts=CASE WHEN request_limits.window_started<=NOW()-($3::int * interval '1 second') THEN 1 ELSE request_limits.attempts+1 END,
       window_started=CASE WHEN request_limits.window_started<=NOW()-($3::int * interval '1 second') THEN NOW() ELSE request_limits.window_started END
     WHERE request_limits.attempts<$2 OR request_limits.window_started<=NOW()-($3::int * interval '1 second')
     RETURNING bucket`,
    [bucket, input.limit, input.windowSeconds],
  );
  if (result.rows.length) return;
  const retry = await db.query<{ remaining: number }>(
    `SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM (window_started+($2::int * interval '1 second')-NOW()))))::int AS remaining
     FROM request_limits WHERE bucket=$1`,
    [bucket, input.windowSeconds],
  );
  throw new RateLimitError(
    Math.min(input.windowSeconds, retry.rows[0]?.remaining || input.windowSeconds),
  );
}
