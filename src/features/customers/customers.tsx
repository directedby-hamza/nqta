'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search, ArrowUpRight, Users, Gift, Download } from 'lucide-react';
import { useResource } from '@/lib/use-resource';
import { api, dateLabel, initials, message } from '@/lib/api';
import type { Member, MembershipCard } from '@/lib/types';
import { ErrorNotice, Loading, Modal } from '@/components/ui/primitives';
import { useWorkspace } from '@/components/layout/merchant-shell';
export function TinyStamps({ progress, threshold }: { progress: number; threshold: number }) {
  return (
    <span className="tiny-stamps">
      {threshold <= 10 &&
        Array.from({ length: threshold }, (_, index) => (
          <i key={index} className={index < progress ? 'filled' : ''} />
        ))}
      <small>
        {progress}/{threshold}
      </small>
    </span>
  );
}
export function Customers() {
  const { workspace } = useWorkspace();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<MembershipCard | null>(null);
  const [error, setError] = useState('');
  const members = useResource<Member[]>(`customers?query=${encodeURIComponent(search)}`);
  const items = (members.data || []).filter((member) =>
    filter === 'rewards'
      ? member.availableRewards > 0
      : filter === 'regulars'
        ? member.visits >= 5
        : filter === 'newsletter'
          ? member.newsletterOptedIn === true
          : true,
  );
  async function detail(id: string) {
    try {
      setSelected(await api<MembershipCard>(`membership?id=${id}`));
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">More than a name on a card</div>
          <h1>
            Your people<span className="accent-period">.</span>
          </h1>
          <p>A familiar face today. A regular tomorrow.</p>
        </div>
        {workspace.actor.role === 'owner' && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <a href="/api/export?days=30" className="button secondary">
              <Download size={15} /> Export activity
            </a>
            <a href="/api/customers/newsletter-export" className="button secondary">
              <Download size={15} /> Export newsletter list
            </a>
          </div>
        )}
      </div>
      <div className="customer-summary">
        <div className="row">
          <span className="metric-icon">
            <Users size={18} />
          </span>
          <div>
            <strong>{members.data?.length ?? '—'}</strong>
            <span>members {search ? 'matching your search' : 'in your community'}</span>
          </div>
        </div>
        <div className="row">
          <span className="metric-icon orange">
            <Gift size={18} />
          </span>
          <div>
            <strong>{members.data?.filter((m) => m.availableRewards > 0).length ?? '—'}</strong>
            <span>members with a little treat waiting</span>
          </div>
        </div>
      </div>
      <ErrorNotice error={error || members.error} />
      <div className="panel">
        <div className="customer-toolbar">
          <div className="tabs" role="group" aria-label="Customer filters">
            {[
              { value: 'all', label: 'All members' },
              { value: 'regulars', label: 'Regulars' },
              { value: 'rewards', label: 'Reward ready' },
              ...(workspace.actor.role === 'owner'
                ? [{ value: 'newsletter', label: 'Newsletter opt-in' }]
                : []),
            ].map((tab) => (
              <button
                className={filter === tab.value ? 'selected' : ''}
                key={tab.value}
                onClick={() => setFilter(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search customers"
              placeholder="Search name or member code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {members.loading && !members.data ? (
          <Loading />
        ) : !items.length ? (
          <div className="empty">
            {search || filter !== 'all'
              ? 'No members match this search or filter.'
              : 'Your community starts with one person.'}
            <br />
            <Link href={`/join/${workspace.shop.slug}`} className="button quiet" target="_blank">
              Open your enrolment page <ArrowUpRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="table-wrap customer-table">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  {workspace.actor.role === 'owner' && <th>Contact & newsletter</th>}
                  <th>Card progress</th>
                  <th>Paid receipts</th>
                  <th>Rewards</th>
                  <th>Last visit</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <button className="customer-name row" onClick={() => void detail(member.id)}>
                        <span className="avatar">{initials(member.name)}</span>
                        <span>
                          <span className="table-name">{member.name}</span>
                          <span className="table-secondary">{member.phone}</span>
                        </span>
                      </button>
                    </td>
                    {workspace.actor.role === 'owner' && (
                      <td style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>
                        <span className="table-name">
                          {member.contactEmail || 'No email saved'}
                        </span>
                        <span className="table-secondary">
                          {member.contactPhone || member.phone || 'No phone shared'}
                        </span>
                        <span className={member.newsletterOptedIn ? 'badge' : 'table-secondary'}>
                          {member.newsletterOptedIn
                            ? 'Email offers: opted in'
                            : 'Email offers: not opted in'}
                        </span>
                        {member.newsletterUpdatedAt && (
                          <span className="table-secondary">
                            Preference updated {dateLabel(member.newsletterUpdatedAt)}
                          </span>
                        )}
                      </td>
                    )}
                    <td>
                      <TinyStamps progress={member.progress} threshold={member.threshold} />
                    </td>
                    <td>{member.visits}</td>
                    <td>
                      {member.availableRewards ? (
                        <span className="badge">
                          <Gift size={11} />
                          {member.availableRewards} ready
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">
                      {member.lastVisit ? dateLabel(member.lastVisit) : 'First visit ahead'}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${member.name}`}
                        onClick={() => void detail(member.id)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          Showing {items.length} members
          {(members.data?.length || 0) >= 500 ? ' · first 500 results; narrow your search' : ''}
          <span>
            {workspace.actor.role === 'owner'
              ? 'Contacts are customer-provided. Newsletter export includes current opt-ins only.'
              : 'Contact numbers are masked for privacy.'}
          </span>
        </div>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.name || 'Member'}
        description="A little history of coming back."
      >
        {selected && (
          <div className="stack">
            <div className="detail-progress">
              <TinyStamps progress={selected.progress} threshold={selected.threshold} />
              <span>{selected.totalStamps} lifetime valid stamps</span>
            </div>
            <div className="notice">
              {selected.rewards.filter((r) => r.state === 'available').length} rewards ready ·{' '}
              {selected.phone}
              <br />
              {selected.memberCode}
            </div>
            {selected.needsReview && (
              <div className="notice warm">
                A refunded receipt affects an enjoyed reward. Owner reconciliation is needed.
              </div>
            )}
            <p className="subtle">
              {selected.eligibility}
              <br />
              Reward: {selected.rewardDescription}
            </p>
            <Link href={`/cashier?member=${selected.memberCode}`} className="button primary wide">
              Open in cashier <ArrowUpRight size={15} />
            </Link>
            <Link href={`/activity?membership=${selected.id}`} className="button secondary wide">
              View this member’s history
            </Link>
          </div>
        )}
      </Modal>
    </>
  );
}
