import { expect, it } from 'vitest';
import { trustedOrigin } from '../../src/server/auth/origin';
it('accepts the canonical local browser origin independently of Next’s internal request hostname', () => {
  expect(trustedOrigin('http://127.0.0.1:3000')).toBe(true);
});
it('rejects missing or foreign origins and honours an explicit deployment origin', () => {
  expect(trustedOrigin(null)).toBe(false);
  expect(trustedOrigin('https://foreign.example')).toBe(false);
  expect(trustedOrigin('https://loyalty.example', 'https://loyalty.example/')).toBe(true);
  expect(trustedOrigin('http://127.0.0.1:3000', 'https://loyalty.example')).toBe(false);
});
