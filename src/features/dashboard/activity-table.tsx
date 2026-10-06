'use client';
import Link from 'next/link';
import { ArrowUpRight, Plus, Gift, RotateCcw } from 'lucide-react';
import type { Activity } from '@/lib/types';
import { initials, money, dateLabel } from '@/lib/api';
export function ActivityTable({
  items,
  onReverse,
}: {
  items: Activity[];
  onReverse?: (item: Activity) => void;
}) {
  if (!items.length)
    return (
      <div className="empty">
        The first visit is the start of something good.
        <br />
        <Link href="/cashier" className="button quiet">
          Record a purchase <ArrowUpRight size={14} />
        </Link>
      </div>
    );
  return (
    <div className="table-wrap activity-table">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Activity</th>
            <th>Amount</th>
            <th>When</th>
            <th>Recorded by</th>
            {onReverse && (
              <th>
                <span className="sr-only">Correction</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/cashier?member=${item.memberCode}`} className="row">
                  <span className="avatar">{initials(item.name)}</span>
                  <span className="table-name">{item.name}</span>
                </Link>
              </td>
              <td>
                <span
                  className={`badge ${item.reversed || item.kind === 'reversal' ? 'warm' : item.kind === 'redemption' ? '' : 'neutral'}`}
                >
                  {item.kind === 'redemption' ? (
                    <Gift size={11} />
                  ) : item.kind === 'reversal' || item.reversed ? (
                    <RotateCcw size={11} />
                  ) : (
                    <Plus size={11} />
                  )}
                  {item.reversed
                    ? 'Reversed purchase'
                    : item.kind === 'purchase'
                      ? item.qualifies
                        ? 'Stamp earned'
                        : 'Receipt · no stamp'
                      : item.kind === 'redemption'
                        ? 'Reward enjoyed'
                        : 'Purchase reversed'}
                </span>
              </td>
              <td>
                {item.amountMinor == null ? (
                  <span className="muted">—</span>
                ) : (
                  money(item.amountMinor)
                )}
              </td>
              <td className="muted">{dateLabel(item.at)}</td>
              <td className="muted">{item.staffName}</td>
              {onReverse && (
                <td>
                  {item.kind === 'purchase' && !item.reversed && (
                    <button className="button quiet" onClick={() => onReverse(item)}>
                      Correct
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
