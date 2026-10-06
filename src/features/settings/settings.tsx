'use client';
import { useState, type FormEvent } from 'react';
import {
  Users,
  Plus,
  ShieldCheck,
  Leaf,
  Check,
  Pause,
  Play,
  ArrowUpRight,
  Copy,
  Mail,
} from 'lucide-react';
import { useWorkspace } from '@/components/layout/merchant-shell';
import { api, initials, message, dateLabel } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { ErrorNotice, Loading, Modal, Toast } from '@/components/ui/primitives';
type Staff = { id: string; name: string; email: string; role: string; active: boolean };
type Support = {
  id: string;
  name: string | null;
  kind: string;
  message: string;
  status: string;
  created_at: string;
};
export function SettingsPage() {
  const { workspace, refresh } = useWorkspace();
  const shop = workspace.shop;
  const [name, setName] = useState(shop.name);
  const [category, setCategory] = useState(shop.category);
  const [description, setDescription] = useState(shop.description);
  const [location, setLocation] = useState(shop.location);
  const [theme, setTheme] = useState(shop.theme);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [invite, setInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('cashier');
  const [inviteURL, setInviteURL] = useState('');
  const [modalError, setModalError] = useState('');
  const [revoke, setRevoke] = useState<Staff | null>(null);
  const [pause, setPause] = useState(false);
  const [supportKind, setSupportKind] = useState<'recovery' | 'programme-transition'>('recovery');
  const [supportMessage, setSupportMessage] = useState('');
  const [request, setRequest] = useState(false);
  const staff = useResource<Staff[]>('staff');
  const support = useResource<Support[]>('support');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('shop', {
        method: 'PATCH',
        body: { name, category, description, location, theme },
      });
      await refresh();
      setToast('Your shop profile is saved');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const result = await api<{ url: string }>('staff/invite', {
        method: 'POST',
        body: { name: inviteName, email: inviteEmail, role: inviteRole },
      });
      setInviteURL(result.url);
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function revokeStaff() {
    setBusy(true);
    setModalError('');
    try {
      await api(`staff/${revoke?.id}`, { method: 'DELETE', body: {} });
      setRevoke(null);
      await staff.refresh();
      setToast('Staff access revoked');
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function pauseShop() {
    setBusy(true);
    setModalError('');
    try {
      await api('shop/pause', { method: 'POST', body: { paused: shop.status === 'active' } });
      setPause(false);
      await refresh();
      setToast(
        shop.status === 'active'
          ? 'New enrolment and earning are paused'
          : 'Your programme is active again',
      );
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function createRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      await api('support', {
        method: 'POST',
        body: { kind: supportKind, message: supportMessage },
      });
      setRequest(false);
      await support.refresh();
      setToast('Review request saved in this workspace');
    } catch (e) {
      setModalError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (workspace.actor.role !== 'owner')
    return (
      <div className="notice warm">
        Settings require owner access. Ask your shop owner for help.
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">The details behind the good moments</div>
          <h1>
            Make yourself at home<span className="accent-period">.</span>
          </h1>
          <p>Your shop, your team, your way of saying thank you.</p>
        </div>
        <span className="badge">
          <ShieldCheck size={12} />
          Owner workspace
        </span>
      </div>
      <div className="settings-layout">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Your shop, at a glance</h2>
              <Leaf size={19} className="muted" />
            </div>
            <form className="panel-body" onSubmit={save}>
              <div className="grid-two">
                <div className="field">
                  <label htmlFor="profile-name">Shop name</label>
                  <input
                    id="profile-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-category">Category</label>
                  <input
                    id="profile-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                    maxLength={100}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="profile-description">Your little welcome</label>
                <textarea
                  id="profile-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="grid-two">
                <div className="field">
                  <label htmlFor="profile-location">Location</label>
                  <input
                    id="profile-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    required
                    maxLength={200}
                  />
                </div>
                <div className="field">
                  <label htmlFor="profile-colour">Brand colour</label>
                  <select
                    id="profile-colour"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="#175c46">Neighbourhood green</option>
                    <option value="#263d38">Deep evergreen</option>
                    <option value="#a34e36">Warm terracotta</option>
                    <option value="#3d4870">Evening blue</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Customer enrolment URL</label>
                <div className="shop-url">
                  /join/{shop.slug}
                  <a
                    href={`/join/${shop.slug}`}
                    target="_blank"
                    aria-label="Open customer enrolment"
                  >
                    <ArrowUpRight size={16} />
                  </a>
                </div>
                <small>Your URL stays stable so printed QR codes keep working.</small>
              </div>
              <ErrorNotice error={error} />
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save shop profile'}
                <Check size={15} />
              </button>
            </form>
          </div>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Good people behind the counter</h2>
                <p className="subtle">Individual accounts. Clear responsibilities.</p>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  setInvite(true);
                  setInviteName('');
                  setInviteEmail('');
                  setInviteRole('cashier');
                  setInviteURL('');
                  setModalError('');
                }}
              >
                <Plus size={14} />
                Invite staff
              </button>
            </div>
            <ErrorNotice error={staff.error} />
            {staff.loading ? (
              <Loading />
            ) : (
              <div className="staff-list">
                {staff.data?.map((person) => (
                  <div className="staff-person" key={person.id}>
                    <div className="row">
                      <span className="avatar">{initials(person.name)}</span>
                      <div>
                        <strong>
                          {person.name}
                          {person.id === workspace.actor.userId ? ' (you)' : ''}
                        </strong>
                        <small>{person.email}</small>
                      </div>
                    </div>
                    <div className="row">
                      <span className={`badge ${person.active ? 'neutral' : 'warm'}`}>
                        {person.active ? person.role : 'Revoked'}
                      </span>
                      {person.active && person.id !== workspace.actor.userId && (
                        <button
                          className="button quiet"
                          onClick={() => {
                            setRevoke(person);
                            setModalError('');
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="panel-body subtle">
              Cashiers can find cards, record purchases and redeem rewards. Owners can also export
              activity, reverse purchases, manage staff, and configure the shop.
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>A careful helping hand</h2>
                <p className="subtle">Account recovery, deletion and reward reconciliation</p>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  setRequest(true);
                  setSupportMessage('');
                  setModalError('');
                }}
              >
                Create review request
              </button>
            </div>
            <ErrorNotice error={support.error} />
            {support.data?.length ? (
              <div className="support-list">
                {support.data.map((item) => (
                  <div key={item.id}>
                    <div className="between">
                      <strong>
                        {item.kind.replace('-', ' ')}
                        {item.name ? ` · ${item.name}` : ''}
                      </strong>
                      <span className="badge warm">{item.status}</span>
                    </div>
                    <p>{item.message}</p>
                    <small>{dateLabel(item.created_at)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No open requests. A little peace of mind.</div>
            )}
            <div className="panel-body subtle">
              Requests are saved locally for owner review. Identity changes need verified proof;
              accounts are never merged by name. Fulfilment and retention decisions are handled
              manually in this pilot.
            </div>
          </div>
        </div>
        <aside className="stack">
          <div className="settings-brand-preview" style={{ background: theme }}>
            <Leaf size={32} strokeWidth={1.1} />
            <h2>{name}</h2>
            <p>{description}</p>
            <span>Live profile preview</span>
          </div>
          <div className="panel">
            <div className="panel-body">
              <span className="badge">
                <Leaf size={11} />
                {shop.subscription_status}
              </span>
              <h2 style={{ margin: '18px 0 9px' }}>A thoughtful start.</h2>
              <p className="subtle">
                Your local pilot has one shop, a stamp programme, your team, and customer cards.
                Billing is managed manually; no charge is processed here.
              </p>
              <div className="divider" />
              <strong className="subtle">Next chapters</strong>
              <p className="subtle">
                Wallet passes, points, messaging campaigns, multi-location programmes, live
                subscriptions, and POS integrations belong to later rollout stages.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-body">
              <h2>Programme status</h2>
              <p className="subtle" style={{ margin: '12px 0 18px' }}>
                {shop.status === 'active'
                  ? 'Your shop is open for enrolment and earning.'
                  : 'New enrolment and earning are paused. Existing cards and earned rewards are preserved.'}
              </p>
              <button
                className="button secondary wide"
                onClick={() => {
                  setPause(true);
                  setModalError('');
                }}
              >
                {shop.status === 'active' ? <Pause size={14} /> : <Play size={14} />}{' '}
                {shop.status === 'active' ? 'Pause new earning' : 'Resume programme'}
              </button>
            </div>
          </div>
        </aside>
      </div>
      <Modal
        open={invite}
        onOpenChange={setInvite}
        title="A new face on the team."
        description="Invitation links expire after 48 hours and can be used once. Share the link privately with the person you invited."
      >
        {inviteURL ? (
          <div className="stack">
            <div className="notice">Invitation created. No email was sent in this local pilot.</div>
            <label className="field">
              <span className="subtle">Invitation link</span>
              <input readOnly value={inviteURL} aria-label="Invitation link" />
            </label>
            <button
              className="button secondary wide"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteURL);
                  setToast('Invitation link copied');
                } catch {
                  setModalError('Select and copy the invitation link above.');
                }
              }}
            >
              <Copy size={14} />
              Copy invitation link
            </button>
            <ErrorNotice error={modalError} />
          </div>
        ) : (
          <form onSubmit={sendInvite}>
            <div className="field">
              <label htmlFor="invite-name">Staff name</label>
              <input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor="invite-email">Staff email</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="cashier">Cashier</option>
                <option value="owner">Owner · full workspace access</option>
              </select>
            </div>
            <ErrorNotice error={modalError} />
            <button className="button primary wide" disabled={busy}>
              <Mail size={14} />
              {busy ? 'Creating…' : 'Create invitation'}
            </button>
          </form>
        )}
      </Modal>
      <Modal
        open={!!revoke}
        onOpenChange={(value) => {
          if (!value) setRevoke(null);
        }}
        title="Revoke staff access?"
        description={`This immediately signs out ${revoke?.name || 'this person'} and prevents further access. Existing transaction history is preserved.`}
      >
        <ErrorNotice error={modalError} />
        <button className="button danger wide" disabled={busy} onClick={() => void revokeStaff()}>
          Confirm revocation
        </button>
      </Modal>
      <Modal
        open={pause}
        onOpenChange={setPause}
        title={shop.status === 'active' ? 'Take a little pause?' : 'Ready to welcome people back?'}
        description={
          shop.status === 'active'
            ? 'New enrolment and earning will stop. Existing cards, history, and earned rewards remain available.'
            : 'Customers will be able to enrol and earn stamps again.'
        }
      >
        <ErrorNotice error={modalError} />
        <button className="button primary wide" disabled={busy} onClick={() => void pauseShop()}>
          {shop.status === 'active' ? 'Confirm pause' : 'Resume programme'}
        </button>
      </Modal>
      <Modal
        open={request}
        onOpenChange={setRequest}
        title="Handle this with care."
        description="Save the context for an owner review. This does not change customer identity, delete data, or migrate earned rewards automatically."
      >
        <form onSubmit={createRequest}>
          <div className="field">
            <label htmlFor="request-kind">Request type</label>
            <select
              id="request-kind"
              value={supportKind}
              onChange={(e) => setSupportKind(e.target.value as typeof supportKind)}
            >
              <option value="recovery">Assisted account recovery</option>
              <option value="programme-transition">Programme rule transition</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="request-message">Context and next steps</label>
            <textarea
              id="request-message"
              value={supportMessage}
              onChange={(e) => setSupportMessage(e.target.value)}
              required
              minLength={10}
              maxLength={2000}
              placeholder="Describe what needs review and how identity or earned value will be protected."
            />
          </div>
          <ErrorNotice error={modalError} />
          <button className="button primary wide" disabled={busy}>
            Save review request
          </button>
        </form>
      </Modal>
      <Toast text={toast} onClose={() => setToast('')} />
    </>
  );
}
