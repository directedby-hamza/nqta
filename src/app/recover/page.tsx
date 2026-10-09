'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/layout/merchant-shell';
import { useResource } from '@/lib/use-resource';
import { ErrorNotice } from '@/components/ui/primitives';
export default function Page() {
  const config = useResource<{ authMode: 'verified-contact' | 'recovery-key' }>('public/config');
  const keyMode = config.data?.authMode === 'recovery-key';
  const [slug, setSlug] = useState('');
  const router = useRouter();
  function submit(e: FormEvent) {
    e.preventDefault();
    router.push(
      `/join/${encodeURIComponent(slug.trim().toLowerCase())}${keyMode ? '?auth=sign-in' : ''}`,
    );
  }
  return (
    <main className="customer-page">
      <div className="customer-top">
        <Logo />
      </div>
      <div className="join-form panel">
        <div className="panel-body">
          <div className="eyebrow">Pick up where you left off</div>
          <h1>Find your card.</h1>
          <p className="subtle" style={{ margin: '16px 0' }}>
            Enter your shop’s URL name, or scan its enrolment QR again.{' '}
            {keyMode
              ? 'On this browser, your saved card opens directly while you’re signed in. On another device, use your phone number and password. Previous account IDs also work.'
              : config.data
                ? 'Verify the same phone to restore your saved card and rewards.'
                : 'Sign in through your shop to restore your saved card and rewards.'}
          </p>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="recover-shop">Shop URL name</label>
              <input
                id="recover-shop"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="For example, morrow"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </div>
            <ErrorNotice error={config.error} />
            <button className="button primary wide" disabled={config.loading || !!config.error}>
              Find my shop
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
