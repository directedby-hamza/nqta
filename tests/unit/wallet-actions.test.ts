import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WalletActions, walletDestination } from '../../src/features/card/wallet-actions';
it('shows only configured providers for an active card', () => {
  const render = (google: boolean, apple: boolean, active = true) =>
    renderToStaticMarkup(
      createElement(WalletActions, { membershipId: 'member', options: { google, apple }, active }),
    );
  expect(render(false, false)).toBe('');
  expect(render(true, true, false)).toBe('');
  expect(render(true, false)).toContain('Add to Google Wallet');
  expect(render(true, false)).not.toContain('Add to Apple Wallet');
  expect(render(false, true)).toContain('Add to Apple Wallet');
});
it('accepts only the fixed provider save destination or the owned same-origin download', () => {
  expect(
    walletDestination('google', 'https://pay.google.com/gp/v/save/signed.token', 'member'),
  ).toBe('https://pay.google.com/gp/v/save/signed.token');
  expect(walletDestination('apple', '/api/wallet/download/apple/member', 'member')).toBe(
    '/api/wallet/download/apple/member',
  );
  for (const value of [
    'https://evil.example/save',
    'https://pay.google.com.evil.example/gp/v/save/x',
    'javascript:alert(1)',
    'https://pay.google.com@gp.example/gp/v/save/x',
  ])
    expect(() => walletDestination('google', value, 'member')).toThrow();
  for (const value of [
    '/api/wallet/download/apple/other',
    '//evil.example/download',
    '/api/wallet/download/apple/member?secret=x',
  ])
    expect(() => walletDestination('apple', value, 'member')).toThrow();
});
