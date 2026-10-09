'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Coffee, Check, Gift, Settings, Sparkles, Leaf, ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { MembershipCard } from '@/lib/types';
import { api, ApiError, message } from '@/lib/api';
import { ErrorNotice, Loading, Modal, QR, Reveal, Toast } from '@/components/ui/primitives';
import { Logo } from '@/components/layout/merchant-shell';
import { useResource } from '@/lib/use-resource';
export function CustomerCard({ id }: { id: string }) {
  const config = useResource<{
    authMode: 'verified-contact' | 'recovery-key';
  }>('public/config');
  const keyMode = config.data?.authMode === 'recovery-key';
  const [card, setCard] = useState<MembershipCard | null>(null);
  const [error, setError] = useState('');
  const [recover, setRecover] = useState(false);
  const [settings, setSettings] = useState(false);
  const [sms, setSms] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [modalError, setModalError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  const reduced = useReducedMotion();
  async function load() {
    try {
      const value = await api<MembershipCard>(`card/${id}`);
      setCard(value);
      setError('');
      setRecover(false);
    } catch (e) {
      setError(message(e));
      const signedOut = e instanceof ApiError && e.status === 401;
      setRecover(signedOut);
      if (signedOut) setCard(null);
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    if (challenge) {
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }
  }, [challenge]);
  async function useReward(rewardId: string) {
    setBusy(true);
    setModalError('');
    try {
      setChallenge(await api('challenge', { method: 'POST', body: { rewardId } }));
      setNow(Date.now());
    } catch (e) {
      setToast(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setModalError('');
    try {
      await api('preferences', {
        method: 'PATCH',
        body: { membershipId: id, consents: { sms, whatsapp } },
      });
      setSettings(false);
      setToast('Your choices are saved');
      await load();
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function deletion() {
    setBusy(true);
    setModalError('');
    try {
      await api('deletion', { method: 'POST', body: { membershipId: id } });
      setDeleting(false);
      setSettings(false);
      setToast('Deletion request received. The shop owner will review it.');
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const seconds = challenge
    ? Math.max(0, Math.ceil((new Date(challenge.expiresAt).getTime() - now) / 1000))
    : 0;
  return (
    <main className="customer-page card-page">
      <div className="customer-top">
        <Logo />
        {card && (
          <button
            className="icon-button"
            aria-label="Card settings"
            onClick={() => {
              setSms(card.consents?.sms || false);
              setWhatsapp(card.consents?.whatsapp || false);
              setModalError('');
              setDeleting(false);
              setSettings(true);
            }}
          >
            <Settings size={18} />
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {recover && (
        <div className="join-form panel">
          <div className="panel-body">
            <h2>Your progress is still here.</h2>
            <p className="subtle">
              {keyMode
                ? 'Sign in with your account ID and password, or use your saved recovery key.'
                : config.data
                  ? 'Verify the same phone to recover your card.'
                  : 'Sign in through your shop to recover your card.'}
            </p>
            <Link className="button primary wide" href="/recover">
              Recover my card <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      )}
      {!card && !error ? (
        <Loading />
      ) : (
        card && (
          <Reveal className="card-content">
            <div className="card-welcome">
              <span className="eyebrow">A familiar face</span>
              <h1>
                Hey, {card.name?.split(' ')[0] || 'there'}
                <span className="accent-period">.</span>
              </h1>
              <p>Good to see you back.</p>
            </div>
            <div className="loyalty-card" style={{ background: card.theme }}>
              <div className="between">
                <div>
                  <strong className="card-shop-name">{card.shopName}</strong>
                  <span className="card-shop-location">{card.location}</span>
                </div>
                <Coffee size={30} strokeWidth={1.3} />
              </div>
              <div className="card-main-text">
                Your little ritual.
                <br />
                Our little thank you.
              </div>
              <div
                className={`card-stamps ${card.threshold > 10 ? 'many' : ''}`}
                data-testid="stamp-progress"
                aria-label={`${card.progress} of ${card.threshold} stamps in this cycle`}
              >
                {card.threshold <= 10 ? (
                  Array.from({ length: card.threshold }, (_, index) => (
                    <motion.div
                      key={index}
                      initial={false}
                      animate={reduced ? {} : { scale: index < card.progress ? 1 : 0.96 }}
                      className={index < card.progress ? 'collected' : ''}
                    >
                      {index < card.progress ? (
                        <Check size={24} strokeWidth={1.7} />
                      ) : index === card.threshold - 1 ? (
                        <Gift size={22} strokeWidth={1.5} />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </motion.div>
                  ))
                ) : (
                  <>
                    <strong>
                      {card.progress}
                      <small> / {card.threshold}</small>
                    </strong>
                    <div className="card-progress-track">
                      <div style={{ width: `${(card.progress / card.threshold) * 100}%` }} />
                    </div>
                  </>
                )}
              </div>
              <div className="between card-progress-label">
                <span>
                  {card.progress} of {card.threshold} stamps collected
                </span>
                <Sparkles size={17} />
              </div>
              <div className="card-divider" />
              <p>
                {card.threshold - card.progress === 1
                  ? 'Just one more qualifying purchase.'
                  : `${card.threshold - card.progress} qualifying purchases to your next reward.`}
                <br />
                <strong>{card.rewardDescription}</strong>
              </p>
            </div>
            <div className="member-qr-panel panel">
              <div>
                <span className="eyebrow">Your little passport</span>
                <h2>Show. Stamp. Repeat.</h2>
                <p>Let the team scan this at checkout.</p>
                <code>{card.memberCode}</code>
              </div>
              <QR value={card.memberCode} size={116} />
            </div>
            <div className="card-rewards">
              <div className="between">
                <h2>Your little rewards</h2>
                <span className="badge">
                  {card.rewards.filter((r) => r.state === 'available').length} ready
                </span>
              </div>
              {!card.rewards.length ? (
                <div className="reward-empty">
                  <Gift size={25} strokeWidth={1.2} />
                  <p>
                    A good thing is on its way.
                    <br />
                    <span>Keep coming back. Your first reward will appear here.</span>
                  </p>
                </div>
              ) : (
                card.rewards
                  .filter((r) => r.state !== 'revoked')
                  .map((reward) => (
                    <div
                      className={`reward-item ${reward.state === 'available' ? 'ready' : ''}`}
                      key={reward.id}
                    >
                      <span className="reward-icon">
                        <Gift size={22} strokeWidth={1.4} />
                      </span>
                      <div>
                        <strong>{reward.description}</strong>
                        <small>
                          {reward.state === 'available'
                            ? 'A little thank you, ready when you are.'
                            : 'A good moment, enjoyed.'}
                        </small>
                      </div>
                      {reward.state === 'available' ? (
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void useReward(reward.id)}
                        >
                          Use reward
                        </button>
                      ) : (
                        <span className="badge neutral">Enjoyed</span>
                      )}
                    </div>
                  ))
              )}
            </div>
            <details className="join-terms">
              <summary>The little details</summary>
              <p>{card.eligibility}</p>
              <p>{card.terms}</p>
              <p>
                Earned rewards do not expire automatically. A reward-only receipt does not earn a
                stamp.{' '}
                {keyMode
                  ? 'Lost your card? Use your account ID and password on the shop enrolment page, or use your saved recovery key.'
                  : card.phone
                    ? 'Lost your card? Verify the same phone on the shop enrolment page.'
                    : 'Lost your card? Sign in through your shop to recover your card.'}
              </p>
            </details>
            <div className="card-saved">
              <Leaf size={13} />
              {card.totalStamps} valid stamps, safely saved.
            </div>
          </Reveal>
        )
      )}
      <Modal
        open={!!challenge}
        onOpenChange={(open) => {
          if (!open) setChallenge(null);
        }}
        title="Your little treat is ready."
        description="Show this code to the team. They will confirm the reward after checking your card."
      >
        {challenge && (
          <div className="stack">
            <div
              className={`confirmation-code ${seconds === 0 ? 'expired' : ''}`}
              data-testid="redemption-code"
            >
              {seconds ? challenge.code : 'Expired'}
            </div>
            <div className="notice">
              {seconds
                ? `Valid for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. The code can be used once.`
                : 'Close this window and choose Use reward to request a new code.'}
            </div>
            <p className="subtle">
              Your reward stays available until the team confirms redemption. This does not collect
              or refund a payment.
            </p>
            <button
              className="button secondary wide"
              onClick={() => {
                setChallenge(null);
                void load();
              }}
            >
              Back to my card
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={settings}
        onOpenChange={setSettings}
        title="Your card, your choices."
        description={`Manage your card with ${card?.shopName || 'this shop'}.`}
      >
        <div className="stack">
          {card?.phone ? (
            <>
              <label className="checkbox">
                <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
                Promotional SMS from this shop
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.checked)}
                />
                Promotional WhatsApp from this shop
              </label>
              <p className="subtle">
                Optional. Your membership and rewards work without either choice.
              </p>
              <button className="button primary wide" disabled={busy} onClick={() => void save()}>
                Save my choices
              </button>
              <div className="divider" />
            </>
          ) : (
            <p className="subtle">
              Your membership and rewards are saved to your account. Keep your account ID and
              recovery key private; ask the shop team if you need assistance.
            </p>
          )}
          <ErrorNotice error={modalError} />
          {deleting ? (
            <>
              <div className="notice warm">
                The shop owner will review your request, remaining rewards, and any record-retention
                needs. This request does not delete your data immediately.
              </div>
              <button
                className="button danger wide"
                disabled={busy}
                onClick={() => void deletion()}
              >
                Confirm deletion request
              </button>
            </>
          ) : (
            <button className="button quiet" onClick={() => setDeleting(true)}>
              Request deletion of my personal data
            </button>
          )}
          <button
            className="button secondary wide"
            disabled={busy}
            onClick={async () => {
              await api('auth/sign-out', { method: 'POST', body: { kind: 'customer' } });
              window.location.href = '/recover';
            }}
          >
            Sign out of this device
          </button>
        </div>
      </Modal>
      <Toast text={toast} onClose={() => setToast('')} />
      <div className="customer-footer">
        Powered by <strong>nqta.</strong>
      </div>
    </main>
  );
}
