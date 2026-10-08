'use client';
import { useState } from 'react';

export function SaveRecoveryKey({
  recoveryKey,
  accountId,
  email,
  onContinue,
  continueLabel = 'Continue',
  busy = false,
}: {
  recoveryKey: string;
  accountId?: string;
  email?: string;
  onContinue: () => void;
  continueLabel?: string;
  busy?: boolean;
}) {
  const [saved, setSaved] = useState(false);
  function download() {
    const details = [
      'Nqta recovery details',
      accountId
        ? `Account ID: ${accountId}`
        : email
          ? `Email: ${email}`
          : 'Use the email address your shop owner invited.',
      `Recovery key: ${recoveryKey}`,
      '',
      'Keep this file private. Recovering your password replaces this key.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([details], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nqta-recovery-details.txt';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="stack">
      <div className="notice" role="status">
        Save your recovery key now. It is shown once. Keep it somewhere private; it lets you replace
        a forgotten password.
      </div>
      {accountId && (
        <div className="field">
          <label htmlFor="saved-account-id">Account ID</label>
          <input id="saved-account-id" value={accountId} readOnly />
        </div>
      )}
      {email && (
        <div className="field">
          <label htmlFor="saved-account-email">Email address</label>
          <input id="saved-account-email" value={email} readOnly />
        </div>
      )}
      <div className="field">
        <label htmlFor="saved-recovery-key">Recovery key</label>
        <textarea
          id="saved-recovery-key"
          value={recoveryKey}
          readOnly
          rows={3}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button type="button" className="button secondary wide" onClick={download}>
        Download recovery details
      </button>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        {accountId ? 'I have saved my account ID and recovery key' : 'I have saved my recovery key'}
      </label>
      <p className="subtle">
        If you lose both your password and recovery key, you will need assistance. We cannot send a
        replacement key by email or text.
      </p>
      <button
        type="button"
        className="button primary wide"
        disabled={!saved || busy}
        onClick={onContinue}
      >
        {continueLabel}
      </button>
    </div>
  );
}
