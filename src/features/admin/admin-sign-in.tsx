'use client';
import { useEffect, useState, useId, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { Logo } from '@/components/layout/merchant-shell';
import { ErrorNotice, Reveal } from '@/components/ui/primitives';
import { api, ApiError, message } from '@/lib/api';
import type { PlatformIdentity } from '@/server/platform/auth';

export function AdminPasswordForm({
  onDone,
  initial = false,
}: {
  onDone: () => void;
  initial?: boolean;
}) {
  const passwordHint = useId();
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('admin/auth/password', {
        method: 'POST',
        body: { currentPassword: current, password },
      });
      setCurrent('');
      setPassword('');
      setConfirm('');
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admin-form" onSubmit={submit}>
      {initial && (
        <>
          <span className="eyebrow">Secure your account</span>
          <h1>Choose your admin password</h1>
          <p className="muted">Replace your temporary password before managing shops.</p>
        </>
      )}
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          maxLength={200}
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          aria-describedby={passwordHint}
          minLength={14}
          maxLength={200}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <small id={passwordHint}>Use at least 14 characters.</small>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={200}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>
      <ErrorNotice error={error} />
      <button className="button wide" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}
export function AdminSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [change, setChange] = useState(false);
  useEffect(() => {
    let live = true;
    api<PlatformIdentity>('admin/me')
      .then((a) => {
        if (!live) return;
        if (a.mustChangePassword) setChange(true);
        else router.replace('/admin');
      })
      .catch((e) => {
        if (live && (!(e instanceof ApiError) || e.status !== 401)) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [router]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const a = await api<PlatformIdentity>('admin/auth/sign-in', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      setPassword('');
      if (a.mustChangePassword) setChange(true);
      else router.replace('/admin');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-login">
      <div className="admin-login-brand">
        <Logo />
        <span className="badge">
          <ShieldCheck size={13} />
          Platform administration
        </span>
      </div>
      <Reveal className="admin-login-card">
        {change ? (
          <AdminPasswordForm initial onDone={() => router.replace('/admin')} />
        ) : (
          <form className="admin-form" onSubmit={submit}>
            <div className="admin-lock">
              <ShieldCheck size={25} />
            </div>
            <span className="eyebrow">The Nqta control room</span>
            <h1>Nqta administration</h1>
            <p className="muted">Manage your shops, payments and access.</p>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            <ErrorNotice error={error} />
            <button className="button wide" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
      </Reveal>
      <p className="admin-login-caption">Private access for the Nqta team.</p>
    </main>
  );
}
