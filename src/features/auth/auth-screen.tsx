'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Leaf, Coffee, Check, Sparkles } from 'lucide-react';
import { Logo } from '@/components/layout/merchant-shell';
import { api, message } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { ErrorNotice } from '@/components/ui/primitives';
import { SaveRecoveryKey } from './save-recovery-key';
export function AuthScreen({ mode = 'sign-in' }: { mode?: 'sign-in' | 'create' | 'invite' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('Café & bakery');
  const [location, setLocation] = useState('');
  const [complete, setComplete] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [interruptedKeySave, setInterruptedKeySave] = useState(false);
  const config = useResource<{
    isDemo: boolean;
    hostedTest: boolean;
    authMode: 'verified-contact' | 'recovery-key';
  }>('public/config');
  useEffect(() => {
    try {
      if (mode !== 'sign-in' && sessionStorage.getItem('nqta.staff-key-save') === mode) {
        setInterruptedKeySave(true);
        setComplete(true);
      }
    } catch {
      /* Recovery details still remain only in memory if storage is unavailable. */
    }
  }, [mode]);
  function showRecoveryKey(value: string) {
    try {
      sessionStorage.setItem('nqta.staff-key-save', mode);
    } catch {
      /* Store only a flow marker, never the key. */
    }
    setRecoveryKey(value);
    setPassword('');
    setComplete(true);
    if (mode === 'invite') window.history.replaceState(null, '', '/invite');
  }
  function continueAfterKeySave() {
    try {
      sessionStorage.removeItem('nqta.staff-key-save');
    } catch {
      /* The saved-key acknowledgement does not depend on storage. */
    }
    setRecoveryKey('');
    router.push(mode === 'create' ? '/overview' : '/sign-in');
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        const result = await api<{
          verificationRequired?: boolean;
          verificationDeliveryFailed?: boolean;
          recoveryKey?: string;
        }>('auth/create-workspace', {
          method: 'POST',
          body: { name, email, password, shopName, slug, category, location },
        });
        if (result.recoveryKey) {
          showRecoveryKey(result.recoveryKey);
          return;
        }
        if (result.verificationRequired) {
          setVerificationRequired(true);
          setDeliveryFailed(result.verificationDeliveryFailed === true);
          setComplete(true);
          return;
        }
      } else if (mode === 'invite') {
        const result = await api<{
          verificationRequired?: boolean;
          verificationDeliveryFailed?: boolean;
          recoveryKey?: string;
        }>('staff/accept', {
          method: 'POST',
          body: { token: new URLSearchParams(window.location.search).get('token'), password },
        });
        if (result.recoveryKey) {
          showRecoveryKey(result.recoveryKey);
          return;
        }
        setVerificationRequired(result.verificationRequired === true);
        setDeliveryFailed(result.verificationDeliveryFailed === true);
        setComplete(true);
        return;
      } else {
        await api('auth/staff/sign-in', { method: 'POST', body: { email, password } });
        try {
          sessionStorage.removeItem('nqta.staff-key-save');
        } catch {
          /* Authentication does not depend on a saved-key flow marker. */
        }
      }
      router.push('/overview');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError('');
    try {
      await api('auth/demo', { method: 'POST', body: {} });
      router.push('/overview');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Logo light />
        <div className="auth-story-main">
          <span className="eyebrow">A little loyalty, a lot of possibility</span>
          <h1>
            Good things
            <br />
            come back.
          </h1>
          <p>
            Your customers have a story.
            <br />
            Give them a reason to make
            <br />
            your shop part of it.
          </p>
          <div className="auth-illustration">
            <Coffee size={82} strokeWidth={0.8} />
            <div className="auth-stamps">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i}>{i < 4 ? <Check size={20} /> : <Sparkles size={20} />}</span>
              ))}
            </div>
          </div>
        </div>
        <span className="auth-bottom">
          <Leaf size={14} />
          Made for your neighbourhood.
        </span>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        <div className="auth-form">
          <div className="eyebrow">
            {mode === 'create'
              ? 'Your next chapter'
              : mode === 'invite'
                ? 'You’re part of the team'
                : 'A familiar place'}
          </div>
          <h1>
            {mode === 'create'
              ? 'Let’s meet your shop.'
              : mode === 'invite'
                ? 'Make yourself at home.'
                : 'Welcome back.'}
          </h1>
          <p>
            {mode === 'create'
              ? 'Create your shop workspace. Your first loyalty programme is next.'
              : mode === 'invite'
                ? 'Choose a password for your individual staff account.'
                : 'Your people, your programme, your next little moment.'}
          </p>
          {complete && recoveryKey ? (
            <SaveRecoveryKey
              recoveryKey={recoveryKey}
              email={mode === 'create' ? email : undefined}
              onContinue={continueAfterKeySave}
              continueLabel={mode === 'create' ? 'Open my workspace' : 'Go to sign in'}
            />
          ) : complete ? (
            <div className="stack">
              <div className="notice">
                {interruptedKeySave
                  ? 'Your account is saved, but this page cannot show your recovery key again. Sign in with your password. Use your saved key to recover a forgotten password; if you lost both, ask for assistance.'
                  : verificationRequired
                    ? deliveryFailed
                      ? 'Your account is saved. We could not send its verification email yet. Request a new link below.'
                      : 'Your account is saved. Check your inbox and verify your email to open your workspace.'
                    : 'Your staff account is ready. Sign in with the email your owner invited.'}
              </div>
              <Link
                href={verificationRequired ? '/verify-email' : '/sign-in'}
                className="button primary"
              >
                {verificationRequired ? 'Request a verification link' : 'Go to sign in'}{' '}
                <ArrowUpRight size={15} />
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={submit}>
                {mode === 'create' && (
                  <>
                    <div className="field">
                      <label htmlFor="owner-name">Your name</label>
                      <input
                        id="owner-name"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="shop-name">Shop name</label>
                      <input
                        id="shop-name"
                        value={shopName}
                        onChange={(e) => {
                          setShopName(e.target.value);
                          setSlug(
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')
                              .replace(/^-|-$/g, ''),
                          );
                        }}
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="shop-location">Shop location</label>
                      <input
                        id="shop-location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="City and country"
                        required={config.data?.isDemo === false}
                        maxLength={200}
                      />
                    </div>
                    <div className="grid-two">
                      <div className="field">
                        <label htmlFor="shop-slug">Shop URL</label>
                        <input
                          id="shop-slug"
                          value={slug}
                          onChange={(e) => setSlug(e.target.value)}
                          required
                          pattern="[a-z0-9]+(-[a-z0-9]+)*"
                          minLength={3}
                          maxLength={50}
                        />
                        <small>Customers join at /join/{slug || 'your-shop'}</small>
                      </div>
                      <div className="field">
                        <label htmlFor="category">Shop category</label>
                        <select
                          id="category"
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option>Café & bakery</option>
                          <option>Beauty & wellness</option>
                          <option>Retail</option>
                          <option>Restaurant</option>
                          <option>Services</option>
                          <option>Other</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}
                {mode !== 'invite' && (
                  <div className="field">
                    <label htmlFor="email">Email address</label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@yourshop.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      maxLength={200}
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'sign-in' ? 'Your password' : 'At least 10 characters'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === 'sign-in' ? 1 : 10}
                    maxLength={200}
                  />
                </div>
                <ErrorNotice error={error} />
                {mode === 'sign-in' && (
                  <div className="between" style={{ marginBottom: 16 }}>
                    <Link href="/forgot-password">Forgot password?</Link>
                    {config.data?.authMode === 'verified-contact' && (
                      <Link href="/verify-email">Verify your email</Link>
                    )}
                  </div>
                )}
                <button className="button primary wide auth-submit" disabled={busy}>
                  {busy
                    ? 'Just a moment…'
                    : mode === 'create'
                      ? 'Create my workspace'
                      : mode === 'invite'
                        ? 'Accept invitation'
                        : 'Sign in'}
                  <ArrowUpRight size={15} />
                </button>
              </form>
              {mode === 'sign-in' && config.data?.isDemo && (
                <div className="demo-signin">
                  <div className="divider" />
                  <span className="subtle">Take a look around with synthetic customers.</span>
                  <button
                    className="button secondary wide"
                    disabled={busy}
                    onClick={() => void demo()}
                  >
                    <Sparkles size={14} />
                    Explore demo workspace
                  </button>
                  <small>
                    {config.data.hostedTest
                      ? 'Hosted test · sample data · shared across devices'
                      : 'Local demo · no account needed · changes persist'}
                  </small>
                </div>
              )}
              {mode !== 'invite' && (
                <div className="auth-switch">
                  {mode === 'create' ? 'Already have a workspace?' : 'New to Nqta?'}{' '}
                  <Link href={mode === 'create' ? '/sign-in' : '/create-shop'}>
                    {mode === 'create' ? 'Sign in' : 'Meet your new workspace'}{' '}
                    <ArrowUpRight size={12} />
                  </Link>
                </div>
              )}
              {config.data?.authMode === 'recovery-key' && mode !== 'sign-in' && (
                <p className="subtle">
                  Your email identifies your account. After choosing a password, save the recovery
                  key shown once.
                </p>
              )}
            </>
          )}
          {config.data?.isDemo && config.data.authMode !== 'recovery-key' && (
            <p className="auth-local-note">
              Test workspace. Phone codes and email links are simulated here.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
