import type { Database } from '../db/client';
import type { MembershipCard } from '../loyalty/types';
import { reserveLimit, RateLimitError } from '../auth/rate-limit';
import { createWalletStore } from './store';
import { WalletUnavailableError, type WalletPass } from './contracts';
import {
  applePassTypeIdentifier,
  appleWalletAuthorization,
  appleWalletOptions,
  createAppleWalletPass,
} from './apple';

type AppleWebServiceDependencies = {
  available?: () => boolean;
  sign?: (pass: WalletPass, card: MembershipCard) => Promise<Buffer>;
};
class NativeRequestError extends Error {
  constructor(readonly status: number) {
    super('Invalid Wallet request.');
  }
}
function response(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const options = { status, headers: { 'Cache-Control': 'no-store', ...headers } };
  return body === undefined ? new Response(null, options) : Response.json(body, options);
}
async function json(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new NativeRequestError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new NativeRequestError(400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        throw new NativeRequestError(413);
      }
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
      throw new NativeRequestError(400);
    return parsed;
  } catch (error) {
    if (error instanceof NativeRequestError) throw error;
    throw new NativeRequestError(400);
  } finally {
    reader.releaseLock();
  }
}
function segment(value: string) {
  return value.length >= 1 && value.length <= 256 && !/[\x00-\x20/\\]/.test(value);
}
function revision(value: string) {
  return /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

// Wallet's native callbacks deliberately do not use browser cookies or Origin.
// The route still applies the existing hosted-test gate before calling this.
export function createAppleWebService(
  db: Database,
  dependencies: AppleWebServiceDependencies = {},
) {
  const store = createWalletStore(db);
  const available = dependencies.available || appleWalletOptions;
  const sign = dependencies.sign || createAppleWalletPass;
  return async (request: Request, segments: string[]): Promise<Response> => {
    try {
      if (!available()) throw new WalletUnavailableError();
      if (segments.length > 6 || segments.some((value) => !segment(value)) || segments[0] !== 'v1')
        return response(404);
      const method = request.method;
      if (segments.length === 2 && segments[1] === 'log' && method === 'POST') {
        const body = await json(request);
        if (
          !Array.isArray(body.logs) ||
          body.logs.length > 20 ||
          body.logs.some((log) => typeof log !== 'string' || log.length > 256)
        )
          return response(400);
        // Native diagnostics can contain identifiers/tokens. Accept bounded
        // messages without persisting or emitting their contents.
        return response(200);
      }
      const passTypeId = applePassTypeIdentifier();
      if (
        segments.length === 5 &&
        segments[1] === 'devices' &&
        segments[3] === 'registrations' &&
        method === 'GET'
      ) {
        const [, , deviceId, , type] = segments;
        if (type !== passTypeId) return response(404);
        const url = new URL(request.url);
        const tags = url.searchParams.getAll('passesUpdatedSince');
        if (tags.length > 1 || (tags.length === 1 && !revision(tags[0]))) return response(400);
        const listed = await store.listAppleSerials(deviceId, type, tags[0]);
        return listed ? response(200, listed) : response(204);
      }
      const registration =
        segments.length === 6 && segments[1] === 'devices' && segments[3] === 'registrations';
      const download = segments.length === 4 && segments[1] === 'passes';
      if (!registration && !download) return response(404);
      const type = segments[registration ? 4 : 2];
      const serial = segments[registration ? 5 : 3];
      if (type !== passTypeId) return response(404);
      if (!appleWalletAuthorization(serial, request.headers.get('authorization')))
        return response(401);
      const wallet = await store.getPassBySerial('apple', serial);
      if (!wallet || wallet.pass.externalId !== type) return response(404);
      await reserveLimit(db, {
        scope: 'apple-wallet-pass',
        key: serial,
        limit: 120,
        windowSeconds: 60,
      });
      if (registration && method === 'POST') {
        const body = await json(request);
        if (
          typeof body.pushToken !== 'string' ||
          !/^[a-fA-F0-9]{64,200}$/.test(body.pushToken) ||
          body.pushToken.length % 2
        )
          return response(400);
        const registered = await store.registerAppleDevice(serial, segments[2], body.pushToken);
        return response(registered.created ? 201 : 200);
      }
      if (registration && method === 'DELETE') {
        await store.unregisterAppleDevice(serial, segments[2]);
        return response(200);
      }
      if (download && method === 'GET') {
        const etag = '"' + wallet.pass.revision + '"';
        const updated = Date.parse(wallet.pass.updatedAt || '');
        const headers: Record<string, string> = {
          ETag: etag,
          'Cache-Control': 'private, no-cache',
        };
        if (Number.isFinite(updated)) headers['Last-Modified'] = new Date(updated).toUTCString();
        const match = request.headers.get('if-none-match');
        if (match && match.split(',').some((tag) => [etag, 'W/' + etag, '*'].includes(tag.trim())))
          return response(304, undefined, headers);
        // HTTP dates lose subsecond precision. Never claim an unchanged pass
        // from a same-second timestamp; revision ETags handle exact caching.
        const since = Date.parse(request.headers.get('if-modified-since') || '');
        if (
          !match &&
          Number.isFinite(updated) &&
          Number.isFinite(since) &&
          since > updated &&
          since <= Date.now()
        )
          return response(304, undefined, headers);
        const buffer = await sign(wallet.pass, wallet.card);
        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/vnd.apple.pkpass',
            'Content-Disposition': 'inline; filename="nqta.pkpass"',
          },
        });
      }
      return response(405);
    } catch (error) {
      if (error instanceof WalletUnavailableError) return response(503, { error: error.message });
      if (error instanceof NativeRequestError)
        return response(error.status, { error: error.message });
      if (error instanceof RateLimitError)
        return response(
          429,
          { error: 'Please try again later.' },
          { 'Retry-After': String(error.retryAfterSeconds) },
        );
      return response(500, { error: 'Wallet is unavailable right now. Please try again later.' });
    }
  };
}
