'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  History,
  KeyRound,
  LogOut,
  Search,
  ShieldCheck,
  Store,
  Users,
  Wallet,
} from 'lucide-react';
import { Logo } from '@/components/layout/merchant-shell';
import { ErrorNotice, Loading, Modal, Reveal, Toast } from '@/components/ui/primitives';
import { api, ApiError, message, money, initials } from '@/lib/api';
import type { PlatformIdentity } from '@/server/platform/auth';
import type { PaymentInput, ShopDetail, ShopList, PlatformShop } from '@/server/platform/billing';
import { AdminPasswordForm } from './admin-sign-in';

const statuses: Record<string, string> = {
  all: 'All shops',
  unreviewed: 'Needs review',
  pending: 'Awaiting activation',
  active: 'Active',
  suspended: 'Suspended',
  expired: 'Expired',
};
const day = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(v))
    : 'No end date';
const timestamp = (v: string) =>
  new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Casablanca',
  }).format(new Date(v));
function Status({ status }: { status: string }) {
  return (
    <span className={`admin-status ${status}`}>
      <i />
      {statuses[status] || status}
    </span>
  );
}
type DialogKind = 'payment' | 'access' | 'password' | 'void' | null;
export function AdminConsole() {
  const router = useRouter();
  const [admin, setAdmin] = useState<PlatformIdentity | null>(null),
    [list, setList] = useState<ShopList | null>(null);
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<ShopDetail | null>(null);
  const [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<DialogKind>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  const [accessState, setAccessState] = useState('active'),
    [until, setUntil] = useState(''),
    [reason, setReason] = useState('');
  const [amount, setAmount] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const [pending, setPending] = useState<PaymentInput | null>(null),
    [voidId, setVoidId] = useState('');
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      setList(null);
      setDetail(null);
      router.replace('/admin/sign-in');
    } else setError(message(e));
  }
  useEffect(() => {
    let live = true;
    api<PlatformIdentity>('admin/me')
      .then((a) => {
        if (!live) return;
        if (a.mustChangePassword) router.replace('/admin/sign-in');
        else setAdmin(a);
      })
      .catch((e) => {
        if (live) handleError(e);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ query: search, status, page: String(page) });
    api<ShopList>(`admin/shops?${params}`)
      .then((r) => {
        if (live) setList(r);
      })
      .catch((e) => {
        if (live) handleError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [admin, search, status, page, refresh]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    setError('');
    api<ShopDetail>(`admin/shops/${encodeURIComponent(selected)}`)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((e) => {
        if (live) handleError(e);
      });
    return () => {
      live = false;
    };
  }, [selected]);
  const draftKey = admin && selected ? `nqta-admin-payment:${admin.id}:${selected}` : '';
  function open(kind: DialogKind, paymentId = '') {
    setFormError('');
    setReason('');
    setVoidId(paymentId);
    setAccessState(
      detail?.shop.state === 'pending'
        ? 'pending'
        : detail?.shop.state === 'suspended'
          ? 'suspended'
          : 'active',
    );
    setUntil(detail?.shop.validUntil || '');
    setAmount('');
    setReference('');
    setNote('');
    setPending(null);
    if (kind === 'payment') {
      setUntil('');
      try {
        const saved = sessionStorage.getItem(draftKey);
        if (saved) {
          const draft = JSON.parse(saved) as PaymentInput;
          setPending(draft);
          setAmount((draft.amountMinor / 100).toFixed(2));
          setReference(draft.reference);
          setNote(draft.note);
          setUntil(draft.validUntil);
        }
      } catch {
        setFormError(
          'The saved payment draft could not be read. Check payment history before trying again.',
        );
      }
    }
    setDialog(kind);
  }
  async function updated(text: string) {
    setDialog(null);
    setToast(text);
    setRefresh((n) => n + 1);
    if (selected) setDetail(await api<ShopDetail>(`admin/shops/${encodeURIComponent(selected)}`));
  }
  async function savePayment(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setFormError('');
    try {
      let payload = pending;
      if (!payload) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) / 100 !== value)
          throw new Error('Enter a positive amount with at most two decimal places.');
        payload = {
          amountMinor: Math.round(value * 100),
          reference: reference.trim(),
          note: note.trim(),
          validUntil: until,
          requestKey: crypto.randomUUID(),
        };
        try {
          sessionStorage.setItem(draftKey, JSON.stringify(payload));
        } catch {
          throw new Error(
            'This browser could not safely save the payment draft. Please use another browser.',
          );
        }
        setPending(payload);
      }
      await api(`admin/shops/${encodeURIComponent(selected)}/payments`, {
        method: 'POST',
        body: payload,
      });
      sessionStorage.removeItem(draftKey);
      setPending(null);
      await updated('Payment recorded. Shop access updated.');
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveAccess(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    setFormError('');
    try {
      await api(`admin/shops/${encodeURIComponent(detail.shop.id)}/access`, {
        method: 'PATCH',
        body: {
          state: accessState,
          validUntil: until || null,
          reason,
          expectedRevision: detail.shop.revision,
        },
      });
      await updated('Shop access updated.');
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveVoid(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setFormError('');
    try {
      await api(
        `admin/shops/${encodeURIComponent(selected)}/payments/${encodeURIComponent(voidId)}/void`,
        { method: 'POST', body: { reason } },
      );
      await updated('Payment voided. Shop access is unchanged.');
    } catch (e) {
      setFormError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    try {
      await api('admin/auth/sign-out', { method: 'POST', body: {} });
      router.replace('/admin/sign-in');
    } catch (e) {
      handleError(e);
    }
  }
  if (!admin)
    return (
      <main className="startup">
        <Logo />
        <Loading />
        <ErrorNotice error={error} />
      </main>
    );
  const summary = list?.summary;
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Logo light />
        <div className="admin-sidebar-label">PLATFORM</div>
        <button className="admin-nav active" onClick={() => setSelected(null)}>
          <Store size={18} />
          Shops & payments
        </button>
        <div className="admin-side-note">
          <ShieldCheck size={22} />
          <strong>Stay in control.</strong>
          <p>Review a shop, record its payment, decide its access.</p>
        </div>
        <div className="admin-account">
          <span className="avatar">{initials(admin.name)}</span>
          <div>
            <strong>{admin.name}</strong>
            <small>Platform administrator</small>
          </div>
        </div>
        <button className="admin-nav" onClick={() => open('password')}>
          <KeyRound size={16} />
          Change password
        </button>
        <button className="admin-nav" onClick={() => void signOut()}>
          <LogOut size={16} />
          Sign out
        </button>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <span>
            <ShieldCheck size={15} /> Nqta administration
          </span>
          <button className="button secondary small" onClick={() => void signOut()}>
            <LogOut size={14} />
            Sign out
          </button>
        </header>
        <div className="admin-content">
          <ErrorNotice error={error} />
          {selected ? (
            <>
              {!detail ? (
                <Loading />
              ) : (
                <Reveal>
                  <button className="admin-back" onClick={() => setSelected(null)}>
                    <ArrowLeft size={15} />
                    All shops
                  </button>
                  <div className="admin-page-heading">
                    <div>
                      <span className="eyebrow">Shop account</span>
                      <h1>{detail.shop.name}</h1>
                      <p className="muted">
                        {detail.shop.location || 'Location not supplied'} · /{detail.shop.slug}
                      </p>
                    </div>
                    <Status status={detail.shop.status} />
                  </div>
                  <div className="admin-detail-grid">
                    <section className="admin-panel">
                      <h2>Access & account</h2>
                      <dl className="admin-facts">
                        <div>
                          <dt>Owner</dt>
                          <dd>
                            {detail.shop.ownerName || 'No owner recorded'}
                            <small>{detail.shop.ownerEmail}</small>
                          </dd>
                        </div>
                        <div>
                          <dt>Access through</dt>
                          <dd>{day(detail.shop.validUntil)}</dd>
                        </div>
                        <div>
                          <dt>Customers / purchases</dt>
                          <dd>
                            {detail.shop.members} / {detail.shop.visits}
                          </dd>
                        </div>
                        <div>
                          <dt>Recorded payments</dt>
                          <dd>{money(detail.shop.totalPaidMinor)}</dd>
                        </div>
                      </dl>
                      {detail.shop.status === 'unreviewed' && (
                        <p className="admin-hint">
                          Earlier payments have not been imported. Review this shop before deciding
                          its access.
                        </p>
                      )}
                      <div className="admin-actions">
                        <button className="button" onClick={() => open('payment')}>
                          <CreditCard size={16} />
                          Record payment
                        </button>
                        <button className="button secondary" onClick={() => open('access')}>
                          Manage access
                        </button>
                      </div>
                      <a
                        className="admin-link"
                        href={`/join/${encodeURIComponent(detail.shop.slug)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Customer page <ArrowUpRight size={14} />
                      </a>
                    </section>
                    <section className="admin-panel">
                      <div className="admin-section-heading">
                        <h2>
                          <Wallet size={18} />
                          Payment history
                        </h2>
                        <span>Latest 100</span>
                      </div>
                      {!detail.payments.length ? (
                        <div className="admin-empty">
                          <CreditCard size={25} />
                          <strong>No recorded payments</strong>
                          <p>Add payments only after you receive the money.</p>
                        </div>
                      ) : (
                        <div className="admin-payment-list">
                          {detail.payments.map((p) => (
                            <article key={p.id} className={p.voidedAt ? 'voided' : ''}>
                              <div>
                                <strong>{money(p.amountMinor)}</strong>
                                <span className="admin-status-label">
                                  {p.voidedAt ? 'Voided' : 'Received'}
                                </span>
                              </div>
                              <h3>{p.reference}</h3>
                              <p>
                                {timestamp(p.createdAt)} · {p.recordedBy}
                              </p>
                              <p>Access through {day(p.validUntil)}</p>
                              {p.note && <p>{p.note}</p>}
                              {p.voidedAt ? (
                                <p>Reason: {p.voidReason}</p>
                              ) : (
                                <button
                                  className="admin-text-button"
                                  onClick={() => open('void', p.id)}
                                >
                                  Void entry
                                </button>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                  <section className="admin-panel admin-history">
                    <div className="admin-section-heading">
                      <h2>
                        <History size={18} />
                        Admin activity
                      </h2>
                      <span>Latest 100</span>
                    </div>
                    {!detail.audit.length ? (
                      <p className="muted">Changes to this shop will appear here.</p>
                    ) : (
                      <ol>
                        {detail.audit.map((a) => (
                          <li key={a.id}>
                            <span className="admin-timeline-dot" />
                            <div>
                              <strong>
                                {{
                                  'payment.recorded': 'Payment recorded',
                                  'payment.voided': 'Payment voided',
                                  'access.changed': 'Access updated',
                                }[a.action] || a.action}
                              </strong>
                              <p>
                                {a.details.reason
                                  ? String(a.details.reason)
                                  : a.details.reference
                                    ? String(a.details.reference)
                                    : ''}
                                {a.details.state ? ` · ${statuses[String(a.details.state)]}` : ''}
                              </p>
                              <small>
                                {a.actorName} · {timestamp(a.createdAt)}
                              </small>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </Reveal>
              )}
            </>
          ) : (
            <Reveal>
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow">Platform overview</span>
                  <h1>Your shops, in one place.</h1>
                  <p className="muted">
                    See who needs your attention. Keep every payment accounted for.
                  </p>
                </div>
                <span className="admin-live">
                  <i />
                  Live records
                </span>
              </div>
              <div className="admin-stats">
                {[
                  {
                    label: 'Total shops',
                    value: summary?.total,
                    icon: Store,
                    note: 'Across your platform',
                  },
                  {
                    label: 'Needs attention',
                    value: summary
                      ? summary.unreviewed + summary.pending + summary.expired
                      : undefined,
                    icon: Clock3,
                    note: 'Review, activate or renew',
                  },
                  {
                    label: 'Suspended',
                    value: summary?.suspended,
                    icon: ShieldCheck,
                    note: 'Access paused by you',
                  },
                  {
                    label: 'Recorded payments',
                    value: summary ? money(summary.recordedTotalMinor) : undefined,
                    icon: Wallet,
                    note: 'All time · excludes voided entries',
                  },
                ].map((s) => (
                  <section className="admin-stat" key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <s.icon size={18} />
                    </div>
                    <strong>{s.value ?? '—'}</strong>
                    <small>{s.note}</small>
                  </section>
                ))}
              </div>
              <section className="admin-panel admin-directory">
                <div className="admin-section-heading">
                  <h2>Shop directory</h2>
                  <span>{list?.total ?? 0} results</span>
                </div>
                <div className="admin-toolbar">
                  <form
                    className="admin-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSearch(query);
                      setPage(1);
                    }}
                  >
                    <Search size={17} />
                    <input
                      aria-label="Search shops"
                      placeholder="Shop, slug or owner email"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      maxLength={200}
                    />
                    <button className="button secondary small">Search</button>
                  </form>
                  <select
                    aria-label="Filter by status"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    {Object.entries(statuses).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {loading && <Loading />}
                {!loading && !list?.shops.length ? (
                  <div className="admin-empty">
                    <Store size={28} />
                    <strong>No shops found</strong>
                    <p>Try another search or status.</p>
                  </div>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Shop / owner</th>
                          <th>Access</th>
                          <th>Customers</th>
                          <th>Recorded payments</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {list?.shops.map((shop: PlatformShop) => (
                          <tr key={shop.id}>
                            <td>
                              <div className="admin-shop-name">
                                <span className="admin-shop-icon">{initials(shop.name)}</span>
                                <div>
                                  <strong>{shop.name}</strong>
                                  <small>{shop.ownerEmail || shop.slug}</small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <Status status={shop.status} />
                              <small className="admin-expiry">
                                {shop.validUntil ? `Through ${day(shop.validUntil)}` : ''}
                              </small>
                            </td>
                            <td>
                              <span className="admin-count">
                                <Users size={14} />
                                {shop.members}
                              </span>
                            </td>
                            <td>{money(shop.totalPaidMinor)}</td>
                            <td>
                              <button
                                className="button secondary small"
                                aria-label={`Manage ${shop.name}`}
                                onClick={() => setSelected(shop.id)}
                              >
                                Manage
                                <ArrowUpRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="admin-pagination">
                  <span>
                    Page {page} of {Math.max(1, Math.ceil((list?.total || 0) / 25))}
                  </span>
                  <div>
                    <button
                      className="button secondary small"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="button secondary small"
                      disabled={page * 25 >= (list?.total || 0) || loading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
              <p className="admin-footnote">
                <CheckCircle2 size={14} />
                Payments are entered manually after receipt. Existing shops need review; no
                historical payments are assumed.
              </p>
            </Reveal>
          )}
        </div>
      </main>
      <Modal
        open={dialog !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setDialog(null);
        }}
        title={
          dialog === 'payment'
            ? 'Record received payment'
            : dialog === 'access'
              ? 'Manage shop access'
              : dialog === 'void'
                ? 'Void recorded payment'
                : 'Change administrator password'
        }
        description={
          dialog === 'payment'
            ? 'Record money you have received. This saves the payment and activates access through the selected date.'
            : dialog === 'void'
              ? 'This corrects recorded totals. It does not refund money or change shop access.'
              : dialog === 'access'
                ? 'Choose access and explain the decision. Shop data stays saved.'
                : 'Your other administrator sessions will be signed out.'
        }
      >
        {dialog === 'password' ? (
          <AdminPasswordForm
            onDone={() => {
              setDialog(null);
              setToast('Administrator password updated.');
            }}
          />
        ) : dialog === 'payment' ? (
          <form className="admin-form" onSubmit={savePayment}>
            {pending && (
              <p className="admin-hint">
                A payment draft is awaiting confirmation. Retry the same details safely; check
                history before starting another entry.
              </p>
            )}
            <fieldset disabled={busy || !!pending}>
              <label>
                Amount received (MAD)
                <input
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              <label>
                Payment reference
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="Transfer, receipt or cash reference"
                />
              </label>
              <label>
                Access through
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  required
                  min="2000-01-01"
                  max="2100-12-31"
                />
              </label>
              <label>
                Note (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>
            </fieldset>
            <ErrorNotice error={formError} />
            <button className="button wide" disabled={busy}>
              {busy ? 'Saving…' : pending ? 'Retry payment confirmation' : 'Save received payment'}
            </button>
            {pending && !busy && (
              <button
                type="button"
                className="admin-text-button"
                onClick={() => {
                  sessionStorage.removeItem(draftKey);
                  setPending(null);
                  setDialog(null);
                  setRefresh((n) => n + 1);
                }}
              >
                I will review payment history before continuing
              </button>
            )}
          </form>
        ) : dialog === 'access' ? (
          <form className="admin-form" onSubmit={saveAccess}>
            <label>
              Access decision
              <select value={accessState} onChange={(e) => setAccessState(e.target.value)}>
                <option value="active">Allow access</option>
                <option value="suspended">Suspend access</option>
                <option value="pending">Awaiting activation</option>
              </select>
            </label>
            <label>
              Last valid access date (optional)
              <input
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
              <small>
                A dated subscription expires after this day in Morocco. Leave blank only for an
                intentional access exception.
              </small>
            </label>
            <label>
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                maxLength={500}
              />
            </label>
            <ErrorNotice error={formError} />
            <button className="button wide" disabled={busy}>
              {busy ? 'Saving…' : 'Save access'}
            </button>
          </form>
        ) : dialog === 'void' ? (
          <form className="admin-form" onSubmit={saveVoid}>
            <label>
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                maxLength={500}
              />
            </label>
            <ErrorNotice error={formError} />
            <button className="button wide" disabled={busy}>
              {busy ? 'Saving…' : 'Confirm void'}
            </button>
          </form>
        ) : null}
      </Modal>
      <Toast text={toast} onClose={() => setToast('')} />
    </div>
  );
}
