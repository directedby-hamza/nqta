'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/layout/merchant-shell';
import { ErrorNotice } from '@/components/ui/primitives';
import { api, message } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { SaveRecoveryKey } from './save-recovery-key';

export function RecoveryScreen({ mode }: { mode: 'verify' | 'forgot' | 'reset' }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [developmentUrl, setDevelopmentUrl] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [replacementKey, setReplacementKey] = useState('');
  const [interruptedKeySave, setInterruptedKeySave] = useState(false);
  const config = useResource<{ authMode: 'verified-contact' | 'recovery-key' }>('public/config');
  const keyMode = config.data?.authMode === 'recovery-key';
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
    try {
      if (mode !== 'verify' && sessionStorage.getItem('nqta.staff-key-save') === 'recovery') {
        setInterruptedKeySave(true);
        setComplete(true);
      }
    } catch {
      /* Raw recovery keys are never persisted. */
    }
  }, [mode]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!config.data) throw new Error('Wait for the account configuration, then try again.');
      if (keyMode) {
        if (mode === 'verify')
          throw new Error('Email verification is unavailable for saved-key accounts.');
        if (password !== confirmation) throw new Error('The passwords do not match.');
        const result = await api<{ ok: true; recoveryKey: string }>('auth/staff/recover-key', {
          method: 'POST',
          body: { email, recoveryKey, password },
        });
        try {
          sessionStorage.setItem('nqta.staff-key-save', 'recovery');
        } catch {
          /* Only a non-secret flow marker is stored. */
        }
        setReplacementKey(result.recoveryKey);
        setRecoveryKey('');
        setPassword('');
        setConfirmation('');
        setComplete(true);
        window.history.replaceState(
          null,
          '',
          mode === 'reset' ? '/reset-password' : '/forgot-password',
        );
        return;
      }
      if (mode === 'verify' && token) {
        await api('auth/staff/verify-email', { method: 'POST', body: { token } });
        window.history.replaceState(null, '', '/verify-email');
        router.replace('/overview');
        return;
      }
      if (mode === 'reset') {
        if (password !== confirmation) throw new Error('The passwords do not match.');
        if (!token) throw new Error('Open the password-reset link from your email.');
        await api('auth/staff/reset-password', { method: 'POST', body: { token, password } });
        window.history.replaceState(null, '', '/reset-password');
      } else {
        const result = await api<{ ok: true; developmentUrl?: string }>(
          mode === 'forgot' ? 'auth/staff/request-reset' : 'auth/staff/request-verification',
          { method: 'POST', body: { email } },
        );
        setDevelopmentUrl(result.developmentUrl || '');
      }
      setComplete(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function continueAfterKeySave() {
    try {
      sessionStorage.removeItem('nqta.staff-key-save');
    } catch {
      /* Navigation does not depend on storage. */
    }
    setReplacementKey('');
    router.push('/sign-in');
  }
  return (
    <main className="customer-page">
      <div className="customer-top">
        <Logo />
        <Link href="/sign-in">Merchant sign in</Link>
      </div>
      <div className="join-form panel">
        <div className="panel-body stack">
          <span className="eyebrow">Your workspace, securely</span>
          <h1>
            {keyMode && mode !== 'verify'
              ? 'Recover your workspace.'
              : mode === 'forgot'
                ? 'Forgot your password?'
                : mode === 'reset'
                  ? 'Choose a new password.'
                  : 'Verify your email.'}
          </h1>
          {config.loading ? (
            <p className="subtle">Loading your account options…</p>
          ) : keyMode && mode === 'verify' ? (
            <>
              <div className="notice">
                Saved-key accounts use a password and recovery key. Email verification is
                unavailable in this mode.
              </div>
              <Link href="/sign-in" className="button primary wide">
                Go to sign in
              </Link>
            </>
          ) : replacementKey ? (
            <SaveRecoveryKey
              recoveryKey={replacementKey}
              email={email}
              onContinue={continueAfterKeySave}
              continueLabel="Go to sign in"
            />
          ) : complete ? (
            <>
              <div className="notice" role="status">
                {interruptedKeySave
                  ? 'Your password is updated, but this page cannot show the replacement recovery key again. Sign in with your new password. Keep the key you saved; if you lost both, ask for assistance.'
                  : mode === 'reset'
                    ? 'Your password is updated. Sign in again with your new password.'
                    : 'If an eligible account uses that email, look for a link in your inbox or spam folder. If it does not arrive, try again later.'}
              </div>
              {developmentUrl && (
                <div className="notice warm">
                  Local/test email simulation · no email was sent.{' '}
                  <Link href={developmentUrl}>Open simulated email link</Link>
                </div>
              )}
              <Link href="/sign-in" className="button primary wide">
                Go to sign in
              </Link>
              {keyMode && interruptedKeySave && (
                <button
                  className="button quiet"
                  onClick={() => {
                    try {
                      sessionStorage.removeItem('nqta.staff-key-save');
                    } catch {
                      /* No credential is stored. */
                    }
                    setInterruptedKeySave(false);
                    setComplete(false);
                  }}
                >
                  Recover with my saved key
                </button>
              )}
              {mode !== 'reset' && !keyMode && (
                <button className="button quiet" onClick={() => setComplete(false)}>
                  Request another link
                </button>
              )}
            </>
          ) : (
            <form onSubmit={submit}>
              {keyMode ? (
                <>
                  <p className="subtle">
                    Use your staff email and saved recovery key. This replaces your password and key
                    and signs out every previous session.
                  </p>
                  <div className="field">
                    <label htmlFor="recovery-email">Email address</label>
                    <input
                      id="recovery-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="recovery-key">Recovery key</label>
                    <textarea
                      id="recovery-key"
                      autoComplete="off"
                      value={recoveryKey}
                      onChange={(event) => setRecoveryKey(event.target.value.trim())}
                      minLength={64}
                      maxLength={64}
                      required
                      rows={3}
                      spellCheck={false}
                    />
                  </div>
                </>
              ) : mode === 'verify' && token ? (
                <p className="subtle" style={{ marginBottom: 20 }}>
                  Confirm your email to open your shop workspace. This link can be used once.
                </p>
              ) : mode === 'reset' ? null : (
                <div className="field">
                  <label htmlFor="recovery-email">Email address</label>
                  <input
                    id="recovery-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={200}
                    required
                  />
                  <small>Use the email address for your staff account.</small>
                </div>
              )}
              {(keyMode || mode === 'reset') && (
                <>
                  <div className="field">
                    <label htmlFor="new-password">New password</label>
                    <input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={10}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="confirm-password">Confirm password</label>
                    <input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      minLength={10}
                      maxLength={200}
                      required
                    />
                  </div>
                </>
              )}
              <ErrorNotice error={error || config.error} />
              <button className="button primary wide" disabled={busy || !config.data}>
                {busy
                  ? 'Just a moment…'
                  : keyMode
                    ? 'Recover my workspace'
                    : mode === 'reset'
                      ? 'Save new password'
                      : mode === 'verify' && token
                        ? 'Verify and open workspace'
                        : 'Send email link'}
              </button>
              {!keyMode && mode === 'verify' && token && (
                <button
                  type="button"
                  className="button quiet wide"
                  disabled={busy}
                  onClick={() => {
                    window.history.replaceState(null, '', '/verify-email');
                    setToken('');
                    setError('');
                    setComplete(false);
                    setDevelopmentUrl('');
                  }}
                >
                  Request a new verification link
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
