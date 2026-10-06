'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ScanLine,
  Search,
  Coffee,
  Gift,
  Plus,
  Check,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { useWorkspace } from '@/components/layout/merchant-shell';
import { api, ApiError, initials, message, money } from '@/lib/api';
import type { MembershipCard } from '@/lib/types';
import type { PurchaseInput } from '@/server/loyalty/types';
import { ErrorNotice, Modal, Toast } from '@/components/ui/primitives';
import { TinyStamps } from '@/features/customers/customers';
import { Scanner } from './scanner';
import {
  pendingActionKey,
  readPendingAction,
  savePendingAction,
  type PendingAction,
} from './pending-action';
export function Cashier() {
  const { workspace } = useWorkspace();
  const [code, setCode] = useState('');
  const [card, setCard] = useState<MembershipCard | null>(null);
  const [lookup, setLookup] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [qualifies, setQualifies] = useState(true);
  const [purchase, setPurchase] = useState<PurchaseInput | null>(null);
  const [rewardId, setRewardId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [redemptionKey, setRedemptionKey] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const storageKey = pendingActionKey(workspace.shop.id, workspace.actor.userId);
  async function find(value: string) {
    setLookup(true);
    setError('');
    setCard(null);
    try {
      const member = await api<MembershipCard>(`membership?code=${encodeURIComponent(value)}`);
      setCard(member);
      setCode(member.memberCode);
      setAmount('');
      setReference('');
      setQualifies(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setLookup(false);
    }
  }
  useEffect(() => {
    try {
      const saved = readPendingAction(storageKey);
      if (saved) {
        setPending(saved);
        void api<MembershipCard>(`membership?id=${encodeURIComponent(saved.membershipId)}`)
          .then(setCard)
          .catch((e) => setError(message(e)));
        return;
      }
    } catch (e) {
      setStorageBlocked(true);
      setError(message(e));
      return;
    }
    const member = new URLSearchParams(window.location.search).get('member');
    if (member) {
      setCode(member);
      void find(member);
    }
  }, [storageKey]);
  function review(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!card || pending || storageBlocked) return;
    if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError('Use a positive amount with up to two decimal places.');
      return;
    }
    const parts = amount.split('.');
    const minor = amount ? Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0')) : null;
    if (
      minor !== null &&
      (!Number.isSafeInteger(minor) || minor > 100000000 || (qualifies && minor === 0))
    ) {
      setError('A qualifying paid receipt needs a positive amount, or leave the amount blank.');
      return;
    }
    setPurchase({
      membershipId: card.id,
      idempotencyKey: crypto.randomUUID(),
      qualifies,
      amountMinor: minor,
      receiptReference: reference,
    });
    setModalError('');
  }
  async function confirmPurchase() {
    if (!purchase) return;
    setBusy(true);
    setModalError('');
    const action: PendingAction = {
      kind: 'purchase',
      membershipId: purchase.membershipId,
      customerName: card?.name || pending?.customerName || 'Member',
      input: purchase,
    };
    try {
      savePendingAction(storageKey, action);
      setPending(action);
      await api('purchases', { method: 'POST', body: purchase });
      localStorage.removeItem(storageKey);
      setPending(null);
      setPurchase(null);
      setAmount('');
      setReference('');
      setToast('Purchase recorded');
      try {
        setCard(await api(`membership?id=${purchase.membershipId}`));
      } catch {
        setError('Purchase recorded. Reload the card to see the latest balance.');
      }
    } catch (e) {
      // A business rejection confirms no operation was committed. Network/5xx
      // responses remain uncertain and retain the original payload and key.
      if (e instanceof ApiError && e.status === 400 && e.operationRejected) {
        localStorage.removeItem(storageKey);
        setPending(null);
      }
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function redeem() {
    if (!card && pending?.kind !== 'redemption') return;
    setBusy(true);
    setModalError('');
    const action: PendingAction =
      pending?.kind === 'redemption'
        ? pending
        : {
            kind: 'redemption',
            membershipId: card!.id,
            customerName: card!.name,
            input: { rewardId, code: confirmation, idempotencyKey: redemptionKey },
          };
    try {
      savePendingAction(storageKey, action);
      setPending(action);
      await api('rewards/redeem', {
        method: 'POST',
        body: action.input,
      });
      localStorage.removeItem(storageKey);
      setPending(null);
      setRewardId('');
      setToast('Reward redeemed');
      try {
        setCard(await api(`membership?id=${action.membershipId}`));
      } catch {
        setError('Reward redeemed. Reload the card to see its latest state.');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.operationRejected) {
        localStorage.removeItem(storageKey);
        setPending(null);
      }
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const available = card?.rewards.filter((reward) => reward.state === 'available') || [];
  function resume() {
    if (!pending) return;
    setModalError(
      'Retry this saved confirmation to resolve its status. It keeps the original receipt and action identifier.',
    );
    if (pending.kind === 'purchase') setPurchase(pending.input);
    else {
      setRewardId(pending.input.rewardId);
      setConfirmation(pending.input.code);
      setRedemptionKey(pending.input.idempotencyKey);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A familiar face at the counter</div>
          <h1>
            Make this visit count<span className="accent-period">.</span>
          </h1>
          <p>Find a card, confirm a paid receipt, add a little thank you.</p>
        </div>
        <span className="badge neutral">
          <ShieldCheck size={12} />
          Authorised {workspace.actor.role}
        </span>
      </div>
      {pending && (
        <div className="notice warm between" role="status">
          <span>
            A previous {pending.kind === 'purchase' ? 'purchase' : 'redemption'} confirmation needs
            a response. Resolve it before recording another receipt.
          </span>
          <button className="button secondary" onClick={resume}>
            Resume pending confirmation
          </button>
        </div>
      )}
      <div className="cashier-layout">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Say hello to a regular</h2>
              <ScanLine size={20} className="muted" />
            </div>
            <div className="panel-body">
              <button
                className="scan-button"
                onClick={() => setScanner(true)}
                disabled={!!pending || storageBlocked}
              >
                <span className="scan-corners">
                  <ScanLine size={28} strokeWidth={1.4} />
                </span>
                <div>
                  <strong>Scan customer card</strong>
                  <small>Use your camera to find their membership</small>
                </div>
                <ArrowRight size={18} />
              </button>
              <div className="or-separator">or enter their member code</div>
              <form
                className="member-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void find(code);
                }}
              >
                <label className="search-input">
                  <Search size={16} />
                  <input
                    aria-label="Member code"
                    placeholder="NQ-…"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    maxLength={40}
                    disabled={!!pending || storageBlocked}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={lookup || !!pending || storageBlocked}
                >
                  {lookup ? 'Finding…' : 'Find card'}
                </button>
              </form>
              <ErrorNotice error={error} />
            </div>
          </div>
          {card ? (
            <>
              <div className="cashier-member panel">
                <div className="between">
                  <div className="row">
                    <span className="avatar large">{initials(card.name || 'New regular')}</span>
                    <div>
                      <h2>{card.name || 'A new regular'}</h2>
                      <p>{card.phone}</p>
                    </div>
                  </div>
                  <span className="badge">Member</span>
                </div>
                <div className="cashier-member-stats">
                  <div>
                    <span className="eyebrow">This card</span>
                    <TinyStamps progress={card.progress} threshold={card.threshold} />
                  </div>
                  <div>
                    <span className="eyebrow">A little treat</span>
                    <strong>
                      {available.length} <small>rewards ready</small>
                    </strong>
                  </div>
                </div>
                {card.needsReview && (
                  <div className="notice warm">
                    A previous correction needs owner reconciliation.
                  </div>
                )}
              </div>
              <div className="panel">
                <div className="panel-head">
                  <h2>Record this purchase</h2>
                  <span className="badge neutral">
                    <Plus size={11} />
                    One paid receipt · one stamp
                  </span>
                </div>
                <form className="panel-body" onSubmit={review}>
                  <div className="notice eligibility">
                    <Coffee size={18} />
                    <span>
                      <strong>Qualifying receipt</strong>
                      <br />
                      {card.eligibility}
                    </span>
                  </div>
                  <div className="grid-two">
                    <div className="field">
                      <label htmlFor="amount">Purchase amount (MAD)</label>
                      <input
                        id="amount"
                        inputMode="decimal"
                        placeholder="For example, 25.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        maxLength={12}
                      />
                      <small>Optional. Record the actual paid amount.</small>
                    </div>
                    <div className="field">
                      <label htmlFor="receipt">Receipt reference</label>
                      <input
                        id="receipt"
                        placeholder="Optional unique reference"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        maxLength={100}
                      />
                      <small>Helps prevent recording the same receipt twice.</small>
                    </div>
                  </div>
                  <label className="checkbox qualifies">
                    <input
                      type="checkbox"
                      checked={qualifies}
                      onChange={(e) => setQualifies(e.target.checked)}
                    />
                    This receipt includes a qualifying paid purchase. Reward-only receipts do not
                    qualify.
                  </label>
                  <button
                    className="button primary wide"
                    disabled={workspace.shop.status !== 'active' || !!pending || storageBlocked}
                  >
                    Review purchase <ArrowRight size={15} />
                  </button>
                  {workspace.shop.status !== 'active' && (
                    <p className="subtle">The owner has paused new earning.</p>
                  )}
                </form>
              </div>
            </>
          ) : (
            <div className="cashier-empty">
              <div className="empty-card-icon">
                <Coffee size={47} strokeWidth={0.9} />
              </div>
              <h2>A little loyalty starts here.</h2>
              <p>
                Scan a card or enter a member code.
                <br />
                We’ll pull up their progress and ready rewards.
              </p>
              <span>
                <ShieldCheck size={13} />
                Only cards from {workspace.shop.name} can be used here.
              </span>
            </div>
          )}
        </div>
        <aside className="cashier-right">
          <div className="panel">
            <div className="panel-head">
              <h2>A little treat, ready?</h2>
              <Gift size={20} className="muted" />
            </div>
            <div className="panel-body">
              {available.length ? (
                available.map((reward) => (
                  <div className="cashier-reward" key={reward.id}>
                    <span className="reward-icon">
                      <Gift size={25} strokeWidth={1.3} />
                    </span>
                    <span className="badge">Reward ready</span>
                    <h3>{reward.description}</h3>
                    <p>
                      Ask the customer to choose “Use reward” on their card. Enter their two-minute
                      code.
                    </p>
                    <button
                      className="button primary wide"
                      disabled={!!pending || storageBlocked}
                      onClick={() => {
                        setRewardId(reward.id);
                        setConfirmation('');
                        setRedemptionKey(crypto.randomUUID());
                        setModalError('');
                      }}
                    >
                      Redeem reward
                    </button>
                  </div>
                ))
              ) : (
                <div className="reward-not-yet">
                  <Gift size={37} strokeWidth={1} />
                  <h3>
                    {card ? 'Good things take a few visits.' : 'Their next little thank you.'}
                  </h3>
                  <p>
                    {card
                      ? `${card.threshold - card.progress} more qualifying purchases unlock the next reward.`
                      : 'Ready rewards appear when you open a customer’s card.'}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="counter-guide">
            <span className="eyebrow">A good checkout habit</span>
            <div>
              <i>1</i>
              <span>Take payment with your usual checkout.</span>
            </div>
            <div>
              <i>2</i>
              <span>Confirm the qualifying receipt once.</span>
            </div>
            <div>
              <i>3</i>
              <span>Let the customer see their stamp arrive.</span>
            </div>
            <p>
              <RotateCcw size={12} />
              Corrections are available to owners in Activity.
            </p>
          </div>
        </aside>
      </div>
      <Scanner
        open={scanner}
        onClose={() => setScanner(false)}
        onScan={(value) => {
          if (/^NQ-[A-Z0-9]+$/i.test(value)) {
            setCode(value);
            void find(value);
          } else
            setError('This QR is not a member card. Ask for the QR inside the customer’s card.');
        }}
      />
      <Modal
        open={!!purchase}
        onOpenChange={(open) => {
          if (!open && !busy) setPurchase(null);
        }}
        title="A little stamp, confirmed."
        description="Review the receipt before saving. If a request is interrupted, retrying this confirmation keeps the same action identifier."
      >
        {purchase && (
          <div className="stack">
            <div className="review-receipt">
              <div>
                <span>Customer</span>
                <strong>{pending?.customerName || card?.name}</strong>
              </div>
              <div>
                <span>Recorded amount</span>
                <strong>
                  {purchase.amountMinor == null ? 'Not captured' : money(purchase.amountMinor)}
                </strong>
              </div>
              <div>
                <span>Receipt reference</span>
                <strong>{purchase.receiptReference || 'Not provided'}</strong>
              </div>
              <div>
                <span>Stamp to add</span>
                <strong>
                  {purchase.qualifies ? '1 qualifying paid receipt' : '0 · non-qualifying receipt'}
                </strong>
              </div>
            </div>
            <p className="subtle">
              Confirm that payment is complete and eligibility is correct. This action only records
              loyalty activity.
            </p>
            <ErrorNotice error={modalError} />
            <button
              className="button primary wide"
              disabled={busy}
              onClick={() => void confirmPurchase()}
            >
              {busy ? 'Saving purchase…' : 'Confirm purchase'}
              <Check size={15} />
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={!!rewardId}
        onOpenChange={(open) => {
          if (!open && !busy) setRewardId('');
        }}
        title="A thank you, ready to enjoy."
        description="The customer must generate a fresh code from their card. Confirm this reward only when you are ready to honour it."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void redeem();
          }}
        >
          <div className="field">
            <label htmlFor="customer-confirmation">Customer confirmation code</label>
            <input
              id="customer-confirmation"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={confirmation}
              disabled={pending?.kind === 'redemption'}
              onChange={(e) => setConfirmation(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              required
            />
            <small>Valid for two minutes. Five incorrect attempts require a new code.</small>
          </div>
          <ErrorNotice error={modalError} />
          <button className="button primary wide" disabled={busy}>
            {busy ? 'Confirming…' : 'Confirm redemption'}
            <Gift size={15} />
          </button>
        </form>
      </Modal>
      <Toast text={toast} onClose={() => setToast('')} />
    </>
  );
}
