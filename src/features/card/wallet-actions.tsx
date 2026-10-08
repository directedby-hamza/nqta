'use client';
import { useState } from 'react';
import { Wallet, ArrowUpRight } from 'lucide-react';
import { api, message } from '@/lib/api';

type Provider = 'google' | 'apple';
type Options = { google: boolean; apple: boolean };

export function walletDestination(provider: Provider, value: string, membershipId: string) {
  if (
    provider === 'apple' &&
    value === `/api/wallet/download/apple/${encodeURIComponent(membershipId)}`
  )
    return value;
  if (provider === 'google') {
    const url = new URL(value);
    if (
      url.origin === 'https://pay.google.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/gp\/v\/save\/[A-Za-z0-9._-]+$/.test(url.pathname)
    )
      return url.href;
  }
  throw new Error('We could not open your Wallet. Please try again.');
}

export function WalletActions({
  membershipId,
  options,
  active,
}: {
  membershipId: string;
  options?: Options;
  active: boolean;
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  if (!active || !options || (!options.google && !options.apple)) return null;
  async function add(provider: Provider) {
    setBusy(provider);
    setError('');
    try {
      const result = await api<{ url: string }>(`wallet/${provider}`, {
        method: 'POST',
        body: { membershipId },
      });
      window.location.assign(walletDestination(provider, result.url, membershipId));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="wallet-panel panel" aria-label="Save your loyalty card">
      <span className="wallet-icon">
        <Wallet size={22} strokeWidth={1.5} />
      </span>
      <div className="wallet-copy">
        <h2>Your card, one tap away.</h2>
        <p>Add it once. Next visit, open your Wallet and show the QR to collect a stamp.</p>
        <div className="wallet-buttons">
          {(['google', 'apple'] as const)
            .filter((provider) => options[provider])
            .map((provider) => (
              <button
                key={provider}
                className={provider === 'google' ? 'wallet-google-button' : 'button wallet-button'}
                aria-label={`Add to ${provider === 'google' ? 'Google' : 'Apple'} Wallet`}
                aria-busy={busy === provider}
                disabled={!!busy}
                onClick={() => void add(provider)}
              >
                {provider === 'google' ? (
                  <picture>
                    <source
                      media="(max-width: 380px)"
                      srcSet="/wallet/add-to-google-wallet-condensed.svg"
                    />
                    <img src="/wallet/add-to-google-wallet.svg" width={283} height={50} alt="" />
                  </picture>
                ) : (
                  <>
                    Add to Apple Wallet
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            ))}
        </div>
        {busy && (
          <p className="wallet-status" role="status">
            Preparing your card…
          </p>
        )}
        {options.apple && <small>On iPhone, open this page in Safari and confirm Add.</small>}
        <small>To use a reward, open your card and request its confirmation code.</small>
        {error && (
          <p className="wallet-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
