'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Coffee, ArrowRight, ShieldCheck, Leaf, MapPin } from 'lucide-react';
import { api, message } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import type { Shop, Programme } from '@/lib/types';
import { ErrorNotice, Loading, Reveal } from '@/components/ui/primitives';
import { Logo } from '@/components/layout/merchant-shell';
import { PasswordAccount, type CustomerAccountMode } from './password-account';
import { walletDestination } from './wallet-actions';
export function Join({
  slug,
  initialAccountMode,
}: {
  slug: string;
  initialAccountMode?: CustomerAccountMode;
}) {
  const config = useResource<{
    authMode: 'verified-contact' | 'recovery-key';
    wallet?: { apple: boolean; google: boolean };
  }>('public/config');
  const keyMode = config.data?.authMode === 'recovery-key';
  const { data, error, loading } = useResource<{
    shop: Shop;
    programme: Programme | null;
    isDemo: boolean;
    hostedTest: boolean;
  }>(`public/shop/${encodeURIComponent(slug)}`);
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sms, setSms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    developmentCode?: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [savedMembershipId, setSavedMembershipId] = useState('');
  const [walletDownloadStarted, setWalletDownloadStarted] = useState(false);
  const savedCardHref = savedMembershipId
    ? `/card/${savedMembershipId}?shop=${encodeURIComponent(slug)}`
    : undefined;
  async function openCard(saveToAppleWallet?: boolean) {
    let membershipId = savedMembershipId;
    if (!membershipId) {
      const member = await api<{ id: string }>('join', {
        method: 'POST',
        body: {
          programmeId: data?.programme?.id,
          name,
          ...(saveToAppleWallet !== undefined && phone && email
            ? { contacts: { phone: phone.trim(), email: email.trim() } }
            : {}),
          consents: { sms: false, whatsapp: false },
        },
      });
      membershipId = member.id;
      setSavedMembershipId(membershipId);
    }
    if (saveToAppleWallet && config.data?.wallet?.apple) {
      const pass = await api<{ url: string }>('wallet/apple', {
        method: 'POST',
        body: { membershipId },
      });
      const destination = walletDestination('apple', pass.url, membershipId);
      setWalletDownloadStarted(true);
      try {
        window.location.assign(destination);
      } catch (error) {
        setWalletDownloadStarted(false);
        throw error;
      }
      return;
    }
    router.push(`/card/${membershipId}?shop=${encodeURIComponent(slug)}`);
  }
  async function request(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      setChallenge(await api('auth/customer/request', { method: 'POST', body: { phone } }));
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api('auth/customer/verify', {
        method: 'POST',
        body: { challengeId: challenge?.challengeId, code },
      });
      const member = await api<{ id: string }>('join', {
        method: 'POST',
        body: { programmeId: data?.programme?.id, name, consents: { sms, whatsapp } },
      });
      router.push(`/card/${member.id}?shop=${slug}`);
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="customer-page">
      <div className="customer-top">
        <Logo />
        <span className="subtle">Small gestures. Good company.</span>
      </div>
      {data?.hostedTest && (
        <div className="notice warm">
          {keyMode
            ? 'Hosted testing · use sample account details. Save your recovery key; no messages are sent.'
            : 'Hosted testing · use sample names and phone numbers. Verification is simulated; no SMS is sent.'}
        </div>
      )}
      {loading || config.loading ? (
        <Loading />
      ) : error || config.error ? (
        <div className="join-form panel">
          <ErrorNotice error={error || config.error} />
          <Link href="/recover" className="button quiet">
            Find your shop
          </Link>
        </div>
      ) : (
        data && (
          <Reveal className="join-form">
            <div className="join-shop-hero" style={{ background: data.shop.theme }}>
              <div className="shop-emblem">
                <Coffee size={29} strokeWidth={1.2} />
              </div>
              <span className="eyebrow">A little thank you from</span>
              <h1>{data.shop.name}</h1>
              <p>{data.shop.description}</p>
              <span className="row">
                <MapPin size={12} />
                {data.shop.location}
              </span>
            </div>
            <div className="join-form-body">
              <div className="eyebrow">Your next good habit</div>
              <h2>
                Come for the moment.
                <br />
                Stay for the little rewards.
              </h2>
              {data.programme && (
                <div className="join-rule">
                  <div className="rule-number">
                    {data.programme.threshold}
                    <span>stamps</span>
                  </div>
                  <div>
                    <strong>{data.programme.reward_description}</strong>
                    <small>{data.programme.eligibility}</small>
                  </div>
                </div>
              )}
              {data.programme && data.shop.status !== 'active' && (
                <div className="notice warm">
                  New enrolments and earning are paused. Existing cards can still be recovered and
                  earned rewards used.
                </div>
              )}
              {!data.programme ? (
                <div className="notice warm">
                  This shop is not accepting enrolments right now. Please check with the team.
                </div>
              ) : keyMode ? (
                walletDownloadStarted && savedCardHref ? (
                  <div className="stack" role="status">
                    <h3>Your card is ready.</h3>
                    <p className="subtle">On iPhone, confirm Add in Apple Wallet.</p>
                    <p className="subtle">
                      Your loyalty membership is saved. You can also open your card here to see your
                      points and show its QR at checkout.
                    </p>
                    <Link href={savedCardHref} className="button primary wide">
                      Open my saved card
                      <ArrowRight size={15} />
                    </Link>
                  </div>
                ) : (
                  <PasswordAccount
                    initialMode={initialAccountMode}
                    name={name}
                    onNameChange={setName}
                    onAuthenticated={openCard}
                    contacts={{ phone, email, onPhoneChange: setPhone, onEmailChange: setEmail }}
                    enrollmentShop={slug}
                    saveToAppleWallet={config.data?.wallet?.apple === true}
                    savedCardHref={savedCardHref}
                  />
                )
              ) : !challenge ? (
                <form onSubmit={request}>
                  <div className="field">
                    <label htmlFor="first-name">
                      First name <span className="muted">(optional)</span>
                    </label>
                    <input
                      id="first-name"
                      autoComplete="given-name"
                      placeholder="How should we say hello?"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Phone number</label>
                    <input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+212 6 00 00 00 00"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                    <small>
                      Include your country code. Your phone helps you recover the same card.
                    </small>
                  </div>
                  <div className="consent-box">
                    <strong>Stay in the loop, if you’d like.</strong>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={sms}
                        onChange={(e) => setSms(e.target.checked)}
                      />
                      I’d like promotional SMS from {data.shop.name}.
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.checked)}
                      />
                      I’d like promotional WhatsApp messages from {data.shop.name}.
                    </label>
                    <small>
                      Optional. Your card works either way. Change these choices any time.
                    </small>
                  </div>
                  <ErrorNotice error={formError} />
                  <button className="button primary wide" disabled={busy}>
                    {busy
                      ? 'Preparing verification…'
                      : data.shop.status === 'active'
                        ? 'Get my card'
                        : 'Recover my card'}
                    <ArrowRight size={15} />
                  </button>
                  <div className="join-recovery">
                    Already a regular? Use the same phone to recover your card.
                  </div>
                </form>
              ) : (
                <form onSubmit={verify}>
                  <h3>One little check.</h3>
                  <p className="subtle">Verify {phone} to join or recover your saved card.</p>
                  {challenge.developmentCode ? (
                    <div className="notice warm dev-code">
                      Test verification simulation · no SMS was sent.
                      <br />
                      Test code:{' '}
                      <strong data-testid="development-code">{challenge.developmentCode}</strong>
                    </div>
                  ) : (
                    <div className="notice">
                      Check your phone for the SMS code. Delivery can take a moment.
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="verification-code">Verification code</label>
                    <input
                      id="verification-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </div>
                  <ErrorNotice error={formError} />
                  <button className="button primary wide" disabled={busy}>
                    {busy
                      ? 'Opening your card…'
                      : data.shop.status === 'active'
                        ? 'Verify and join'
                        : 'Verify and recover'}
                    <ArrowRight size={15} />
                  </button>
                  <button
                    className="button quiet wide"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setChallenge(null);
                      setCode('');
                      setFormError('');
                    }}
                  >
                    Change number or request a new code
                  </button>
                </form>
              )}
              {data.programme && (
                <details className="join-terms">
                  <summary>Programme terms & privacy</summary>
                  <p>{data.programme.terms}</p>
                  {data.shop.privacy_notice && <p>{data.shop.privacy_notice}</p>}
                  {data.shop.privacy_contact && (
                    <p>
                      Privacy contact:{' '}
                      <a href={`mailto:${data.shop.privacy_contact}`}>
                        {data.shop.privacy_contact}
                      </a>
                    </p>
                  )}
                  <p>
                    {keyMode
                      ? 'We keep your account identifier, optional name, declared phone and email, and loyalty activity to run this shop’s programme. Your contact details are not verified, and do not authorize promotional messages. You can request deletion from your card settings.'
                      : 'We keep your verified phone, optional name, and loyalty activity to run this shop’s programme. Promotional choices are separate. You can withdraw them or request deletion from your card settings.'}{' '}
                    A shop owner reviews deletion requests and any records that need retention.
                  </p>
                </details>
              )}
              <div className="join-trust">
                <ShieldCheck size={13} />
                Your progress is saved. No app to download.
              </div>
            </div>
          </Reveal>
        )
      )}
      <div className="customer-footer">
        <Leaf size={13} />A little loyalty goes a long way.
      </div>
    </main>
  );
}
