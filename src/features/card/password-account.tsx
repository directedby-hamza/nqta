'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { api, ApiError, message } from '@/lib/api';
import { normaliseCustomerLoginPhone } from '@/lib/customer-phone';
import { ErrorNotice } from '@/components/ui/primitives';

export type CustomerAccountMode = 'create' | 'sign-in' | 'recover';
type ShopContacts = {
  phone: string;
  email: string;
  onPhoneChange: (phone: string) => void;
  onEmailChange: (email: string) => void;
};

export function PasswordAccount({
  initialMode = 'create',
  name,
  onNameChange,
  onAuthenticated,
  contacts,
  authenticated = false,
  enrolmentAvailable = true,
}: {
  initialMode?: CustomerAccountMode;
  name: string;
  onNameChange: (name: string) => void;
  onAuthenticated: (saveContacts?: boolean) => Promise<void>;
  contacts: ShopContacts;
  authenticated?: boolean;
  enrolmentAvailable?: boolean;
}) {
  const [mode, setMode] = useState<'create' | 'sign-in'>(
    initialMode === 'create' ? 'create' : 'sign-in',
  );
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [hasSession, setHasSession] = useState(authenticated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(initialMode === 'recover');

  useEffect(() => {
    if (authenticated) setHasSession(true);
  }, [authenticated]);
  useEffect(() => {
    try {
      // Retire old pending-step markers. No secrets or account data are stored here.
      sessionStorage.removeItem('nqta.customer-key-save');
      sessionStorage.removeItem('nqta.customer-shop-enrollment');
    } catch {
      /* Browser storage is optional. */
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (hasSession || mode === 'create') {
        if (!enrolmentAvailable) throw new Error('This shop is not accepting new cards right now.');
        const phone = normaliseCustomerLoginPhone(contacts.phone);
        if (contacts.email.trim() && !z.email().max(200).safeParse(contacts.email.trim()).success)
          throw new Error('Enter a valid email address or leave it empty.');
        if (!hasSession) {
          await api('auth/customer/register', { method: 'POST', body: { phone, password } });
          // Keep the authenticated account if enrolment or navigation needs a retry.
          setHasSession(true);
          setPassword('');
        }
        await onAuthenticated(true);
      } else {
        const value = identifier.trim();
        const body = /^NA-/i.test(value)
          ? { accountId: value, password }
          : { phone: value, password };
        await api('auth/customer/sign-in', { method: 'POST', body });
        setHasSession(true);
        setPassword('');
        await onAuthenticated();
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && hasSession) setHasSession(false);
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: 'create' | 'sign-in') {
    setMode(next);
    setPassword('');
    setVisible(false);
    setError('');
    setHelp(false);
  }

  return (
    <div className="stack">
      <p className="join-recovery">
        {hasSession
          ? 'You’re signed in. Save a card for this shop with the same account.'
          : mode === 'create'
            ? 'Join once. Next time, open this link to show your QR straight away on this browser.'
            : 'Use your phone number and password to open your saved card.'}
      </p>
      {!enrolmentAvailable && (hasSession || mode === 'create') ? (
        <div className="notice warm">
          This shop is not accepting new cards right now. Existing customers can still sign in to
          their cards.
        </div>
      ) : (
        <form onSubmit={submit}>
          {hasSession || mode === 'create' ? (
            <>
              <div className="field">
                <label htmlFor="customer-phone">Phone number</label>
                <input
                  id="customer-phone"
                  type="tel"
                  autoComplete="username"
                  placeholder="06 12 34 56 78"
                  value={contacts.phone}
                  onChange={(e) => contacts.onPhoneChange(e.target.value)}
                  maxLength={100}
                  required
                />
                <small>
                  {hasSession
                    ? 'Shared with this shop as an unverified contact number.'
                    : 'Use 06 / 07, or an international number. Your password protects your account.'}
                </small>
              </div>
              {!hasSession && (
                <div className="field">
                  <label htmlFor="customer-password">Password</label>
                  <div className="row">
                    <input
                      id="customer-password"
                      type={visible ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={10}
                      maxLength={200}
                      required
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="button quiet"
                      aria-label={visible ? 'Hide password' : 'Show password'}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <small>At least 10 characters. Save it in your phone’s password manager.</small>
                </div>
              )}
              <details className="join-terms" style={{ marginBottom: 18 }}>
                <summary>Your details (optional)</summary>
                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="first-name">
                    First name <span className="muted">(optional)</span>
                  </label>
                  <input
                    id="first-name"
                    autoComplete="given-name"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    maxLength={100}
                    placeholder="How should we say hello?"
                  />
                </div>
                <div className="field">
                  <label htmlFor="customer-email">
                    Email address <span className="muted">(optional)</span>
                  </label>
                  <input
                    id="customer-email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={contacts.email}
                    onChange={(e) => contacts.onEmailChange(e.target.value)}
                    maxLength={200}
                    placeholder="you@example.com"
                  />
                </div>
                <small>
                  Your details are shared with this shop. No promotional messages are enabled.
                </small>
              </details>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="customer-login">Phone number or account ID</label>
                <input
                  id="customer-login"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="06 12 34 56 78"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  maxLength={100}
                  required
                />
                <small>Previously issued account IDs also work.</small>
              </div>
              <div className="field">
                <label htmlFor="customer-password">Password</label>
                <input
                  id="customer-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={200}
                  required
                />
              </div>
            </>
          )}
          <ErrorNotice error={error} />
          <button className="button primary wide" disabled={busy}>
            {busy
              ? 'Opening your card…'
              : hasSession || mode === 'create'
                ? 'Save my card'
                : 'Sign in and open my card'}
            <ArrowRight size={15} />
          </button>
        </form>
      )}
      {!hasSession && (
        <button
          className="button quiet wide"
          type="button"
          disabled={busy}
          onClick={() => switchMode(mode === 'create' ? 'sign-in' : 'create')}
        >
          {mode === 'create' ? 'Sign in to my account' : 'Create a new account'}
        </button>
      )}
      {!hasSession && mode === 'sign-in' && (
        <button className="button quiet wide" type="button" onClick={() => setHelp(!help)}>
          Forgot your password?
        </button>
      )}
      {help && (
        <div className="notice">
          Check your phone’s saved passwords or another device where you’re signed in. Phone numbers
          are not verified, so they cannot be used to reset a password. Your saved QR image still
          works for earning at checkout.
        </div>
      )}
    </div>
  );
}
