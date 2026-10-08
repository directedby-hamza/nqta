'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { api, ApiError, message } from '@/lib/api';
import { ErrorNotice } from '@/components/ui/primitives';
import { SaveRecoveryKey } from '@/features/auth/save-recovery-key';

export type CustomerAccountMode = 'create' | 'sign-in' | 'recover';
type SavedDetails = { accountId: string; recoveryKey: string };
const pendingKeyStorage = 'nqta.customer-key-save';

async function rotateAccountKey(accountId: string, password: string): Promise<SavedDetails> {
  try {
    return await api<SavedDetails>('auth/customer/rotate-recovery-key', {
      method: 'POST',
      body: { accountId, password },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error(
        'We could not confirm this account on this device. Sign in with the account ID shown here, or use its saved recovery key.',
      );
    }
    throw error;
  }
}

export function PasswordAccount({
  initialMode = 'create',
  name,
  onNameChange,
  onAuthenticated,
}: {
  initialMode?: CustomerAccountMode;
  name: string;
  onNameChange: (name: string) => void;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<CustomerAccountMode | 'replace-key'>(initialMode);
  const [accountId, setAccountId] = useState('');
  const [pendingAccountId, setPendingAccountId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [details, setDetails] = useState<SavedDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(pendingKeyStorage);
      if (pending) {
        setAccountId(pending);
        setPendingAccountId(pending);
        setMode('replace-key');
      }
    } catch {
      // Only a public account identifier is kept for interrupted-flow guidance.
    }
  }, []);

  function showKey(value: SavedDetails) {
    setPassword('');
    setConfirmPassword('');
    setRecoveryKey('');
    setAccountId(value.accountId);
    setPendingAccountId(value.accountId);
    setDetails(value);
    try {
      sessionStorage.setItem(pendingKeyStorage, value.accountId);
    } catch {
      // The raw key stays in this component's memory, regardless of storage availability.
    }
  }

  function clearPending() {
    setPendingAccountId('');
    try {
      sessionStorage.removeItem(pendingKeyStorage);
    } catch {
      // Acknowledgement remains usable when browser storage is unavailable.
    }
  }

  async function continueToCard() {
    setBusy(true);
    setError('');
    try {
      await onAuthenticated();
      clearPending();
      setDetails(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'recover' && password !== confirmPassword) {
      setError('Your passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        showKey(
          await api<SavedDetails>('auth/customer/register', {
            method: 'POST',
            body: { password },
          }),
        );
      } else if (mode === 'recover') {
        showKey(
          await api<SavedDetails>('auth/customer/recover', {
            method: 'POST',
            body: { accountId: accountId.trim(), recoveryKey: recoveryKey.trim(), password },
          }),
        );
      } else if (mode === 'replace-key') {
        showKey(await rotateAccountKey(accountId.trim(), password));
      } else {
        await api('auth/customer/sign-in', {
          method: 'POST',
          body: { accountId: accountId.trim(), password },
        });
        if (pendingAccountId && pendingAccountId.toLowerCase() === accountId.trim().toLowerCase()) {
          showKey(await rotateAccountKey(accountId.trim(), password));
        } else {
          setPassword('');
          await onAuthenticated();
          clearPending();
        }
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: CustomerAccountMode) {
    setMode(next);
    setPassword('');
    setConfirmPassword('');
    setRecoveryKey('');
    setError('');
  }

  if (details) {
    return (
      <div className="stack">
        <h3>Keep your little progress safe.</h3>
        <SaveRecoveryKey
          accountId={details.accountId}
          recoveryKey={details.recoveryKey}
          busy={busy}
          continueLabel={busy ? 'Opening your card…' : 'Open my card'}
          onContinue={() => void continueToCard()}
        />
        <ErrorNotice error={error} />
      </div>
    );
  }

  return (
    <div className="stack">
      <form onSubmit={submit}>
        {mode === 'replace-key' ? (
          <div className="stack" style={{ marginBottom: 20 }}>
            <h3>Your recovery key was shown once.</h3>
            <p className="subtle">
              This page cannot show it again after a reload. Confirm your password to make a
              replacement key, then save it before opening your card. Your previous key will stop
              working.
            </p>
            <p className="subtle">
              If this device is signed out, sign in with your account ID and password below first.
            </p>
          </div>
        ) : (
          <div className="join-recovery" style={{ marginBottom: 20 }}>
            {mode === 'create'
              ? 'Choose a password. We’ll give you an account ID and a recovery key to save.'
              : mode === 'sign-in'
                ? 'Use your saved account ID and password to open the same card and rewards.'
                : 'Use your saved account ID and recovery key to choose a new password. This replaces your recovery key and signs out your other devices.'}
          </div>
        )}
        {mode === 'create' && (
          <div className="field">
            <label htmlFor="first-name">
              First name <span className="muted">(optional)</span>
            </label>
            <input
              id="first-name"
              autoComplete="given-name"
              placeholder="How should we say hello?"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={100}
            />
          </div>
        )}
        {mode !== 'create' && (
          <div className="field">
            <label htmlFor="customer-account-id">Account ID</label>
            <input
              id="customer-account-id"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={accountId}
              readOnly={mode === 'replace-key'}
              onChange={(event) => setAccountId(event.target.value)}
              maxLength={200}
              required
            />
            <small>
              This is in your saved recovery details. Your card’s checkout code is separate.
            </small>
          </div>
        )}
        {mode === 'recover' && (
          <div className="field">
            <label htmlFor="customer-recovery-key">Recovery key</label>
            <input
              id="customer-recovery-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={recoveryKey}
              onChange={(event) => setRecoveryKey(event.target.value)}
              maxLength={200}
              required
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="customer-password">
            {mode === 'recover' ? 'New password' : 'Password'}
          </label>
          <input
            id="customer-password"
            type="password"
            autoComplete={
              mode === 'create' || mode === 'recover' ? 'new-password' : 'current-password'
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={10}
            maxLength={200}
            required
          />
          <small>Use 10–200 characters.</small>
        </div>
        {mode === 'recover' && (
          <div className="field">
            <label htmlFor="customer-confirm-password">Confirm password</label>
            <input
              id="customer-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={10}
              maxLength={200}
              required
            />
          </div>
        )}
        <ErrorNotice error={error} />
        <button className="button primary wide" disabled={busy}>
          {busy
            ? 'One little moment…'
            : mode === 'create'
              ? 'Create my account'
              : mode === 'sign-in'
                ? 'Sign in and open my card'
                : mode === 'recover'
                  ? 'Reset password'
                  : 'Make a replacement recovery key'}
          <ArrowRight size={15} />
        </button>
      </form>
      <div>
        {mode !== 'sign-in' && (
          <button
            type="button"
            className="button quiet wide"
            disabled={busy}
            onClick={() => switchMode('sign-in')}
          >
            Sign in to my account
          </button>
        )}
        {mode !== 'recover' && (
          <button
            type="button"
            className="button quiet wide"
            disabled={busy}
            onClick={() => switchMode('recover')}
          >
            Use a recovery key
          </button>
        )}
        {mode !== 'create' && (
          <button
            type="button"
            className="button quiet wide"
            disabled={busy}
            onClick={() => switchMode('create')}
          >
            Create a new account
          </button>
        )}
      </div>
      <p className="subtle">
        Keep your account ID and recovery key somewhere private. If you lose both your password and
        key, ask the shop team for assistance.
      </p>
    </div>
  );
}
