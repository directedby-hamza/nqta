'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, message } from '@/lib/api';
import { normaliseCustomerLoginPhone } from '@/lib/customer-phone';
import { ErrorNotice } from '@/components/ui/primitives';

type Account = { loginPhone: string | null };

export function PhoneSignIn() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    api<Account>('auth/customer/account')
      .then((value) => {
        if (active) setAccount(value);
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || account?.loginPhone !== null) return;
    setError('');
    setBusy(true);
    try {
      const loginPhone = normaliseCustomerLoginPhone(phone);
      await api('auth/customer/login-phone', {
        method: 'POST',
        body: { phone: loginPhone, password },
      });
      const confirmed = await api<Account>('auth/customer/account');
      if (!confirmed.loginPhone)
        throw new Error('Please reopen settings to check your sign-in number.');
      setAccount(confirmed);
      setPhone('');
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  if (loading)
    return (
      <p className="subtle" role="status">
        Checking sign-in options…
      </p>
    );
  if (!account) return <ErrorNotice error={error} />;
  if (account.loginPhone !== null) {
    return saved ? (
      <p className="notice" role="status">
        Phone sign-in is enabled. Use your phone number and current password on your next sign-in.
      </p>
    ) : null;
  }

  return (
    <section className="phone-sign-in" aria-labelledby="phone-sign-in-title">
      <h3 id="phone-sign-in-title">Use my phone to sign in</h3>
      <p className="subtle">
        Choose a phone number for your next sign-in and confirm with your current password. Your
        cards, stamps, and rewards stay in this account.
      </p>
      <form onSubmit={(event) => void enable(event)}>
        <div className="field">
          <label htmlFor="card-login-phone">Phone number</label>
          <input
            id="card-login-phone"
            type="tel"
            autoComplete="username"
            placeholder="0612345678"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={25}
            disabled={busy}
            required
          />
          <small>A Moroccan number such as 0612345678, or a number with its country code.</small>
        </div>
        <div className="field">
          <label htmlFor="card-current-password">Current password</label>
          <input
            id="card-current-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={200}
            disabled={busy}
            required
          />
        </div>
        <ErrorNotice error={error} />
        <button className="button primary wide" type="submit" disabled={busy}>
          {busy ? 'Enabling phone sign-in…' : 'Enable phone sign-in'}
        </button>
      </form>
    </section>
  );
}
