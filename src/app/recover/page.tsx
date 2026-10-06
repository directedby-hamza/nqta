'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/layout/merchant-shell';
export default function Page() {
  const [slug, setSlug] = useState('');
  const router = useRouter();
  function submit(e: FormEvent) {
    e.preventDefault();
    router.push(`/join/${encodeURIComponent(slug.trim().toLowerCase())}`);
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
            Enter your shop’s URL name, or scan its enrolment QR again. Verify the same phone to
            restore your saved card and rewards.
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
            <button className="button primary wide">Find my shop</button>
          </form>
        </div>
      </div>
    </main>
  );
}
