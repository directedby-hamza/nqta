'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useWorkspace } from '@/components/layout/merchant-shell';
import { ErrorNotice, Loading, Modal, Toast } from '@/components/ui/primitives';
import { api, message } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import type { Activity } from '@/lib/types';
import { ActivityTable } from './activity-table';
export function ActivityPage() {
  const { workspace } = useWorkspace();
  const [membership, setMembership] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Activity | null>(null);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  useEffect(() => {
    setMembership(new URLSearchParams(window.location.search).get('membership') || '');
  }, []);
  const activity = useResource<Activity[]>(
    `activity${membership ? `?membership=${membership}` : ''}`,
  );
  const items = (activity.data || []).filter(
    (item) =>
      filter === 'all' ||
      (filter === 'corrections' ? item.reversed || item.kind === 'reversal' : item.kind === filter),
  );
  async function reverse() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ needsReview: boolean }>('reversals', {
        method: 'POST',
        body: { eventId: selected?.id, reason, idempotencyKey: key },
      });
      setSelected(null);
      setToast(
        result.needsReview
          ? 'Purchase reversed · owner reconciliation required'
          : 'Purchase reversed',
      );
      await activity.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Every little moment, accounted for</div>
          <h1>
            A story in every visit<span className="accent-period">.</span>
          </h1>
          <p>
            {membership
              ? 'History for the selected customer.'
              : 'Confirmed purchases, rewards, and a clear trail of corrections.'}
          </p>
        </div>
        {workspace.actor.role === 'owner' && (
          <a className="button secondary" href="/api/export?days=30">
            <Download size={15} />
            Export last 30 days
          </a>
        )}
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>{membership ? 'Member history' : 'Recent activity'}</h2>
          <select
            className="filter-select"
            value={filter}
            aria-label="Activity type"
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All activity</option>
            <option value="purchase">Purchases</option>
            <option value="redemption">Rewards</option>
            <option value="corrections">Corrections</option>
          </select>
        </div>
        <ErrorNotice error={activity.error} />
        {activity.loading ? (
          <Loading />
        ) : (
          <ActivityTable
            items={items}
            onReverse={
              workspace.actor.role === 'owner'
                ? (item) => {
                    setSelected(item);
                    setReason('');
                    setError('');
                    setKey(crypto.randomUUID());
                  }
                : undefined
            }
          />
        )}
        <div className="table-footer">
          {items.length} entries · most recent 150
          <span>Economic records are kept in the audit trail.</span>
        </div>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(value) => {
          if (!value && !busy) setSelected(null);
        }}
        title="Correct this purchase"
        description="This reverses the recorded purchase and its stamp. Available rewards may be revoked; enjoyed rewards require owner review. It does not refund a payment."
      >
        <div className="field">
          <label htmlFor="correction">Correction reason</label>
          <textarea
            id="correction"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example, the receipt was refunded"
            maxLength={500}
          />
        </div>
        <ErrorNotice error={error} />
        <button
          className="button danger wide"
          disabled={busy || !reason.trim()}
          onClick={() => void reverse()}
        >
          {busy ? 'Saving correction…' : 'Confirm reversal'}
        </button>
      </Modal>
      <Toast text={toast} onClose={() => setToast('')} />
    </>
  );
}
