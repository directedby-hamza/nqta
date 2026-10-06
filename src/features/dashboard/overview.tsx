'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Users,
  Repeat2,
  Wallet,
  Gift,
  ArrowUpRight,
  ScanLine,
  Plus,
  Coffee,
  Info,
} from 'lucide-react';
import { useWorkspace } from '@/components/layout/merchant-shell';
import { ErrorNotice, Loading, QR, Reveal } from '@/components/ui/primitives';
import { useResource } from '@/lib/use-resource';
import type { DashboardData } from '@/server/reporting/metrics';
import type { Activity } from '@/lib/types';
import { money, dateLabel } from '@/lib/api';
import { ActivityTable } from './activity-table';
export function Overview() {
  const { workspace } = useWorkspace();
  const [days, setDays] = useState(30);
  const metrics = useResource<DashboardData>(`overview?days=${days}`);
  const activity = useResource<Activity[]>('activity');
  const data = metrics.data;
  const joinURL =
    typeof window !== 'undefined' ? `${window.location.origin}/join/${workspace.shop.slug}` : '';
  const chart = Array.from({ length: days === 365 ? 30 : Math.min(days, 30) }, (_, index) => {
    const date = new Date(
      Date.now() - (Math.min(days, 30) - 1 - index) * 86400000,
    ).toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
    return { date, purchases: data?.chart.find((point) => point.date === date)?.purchases || 0 };
  });
  const maximum = Math.max(1, ...chart.map((point) => point.purchases));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A little hello, a little loyalty</div>
          <h1>
            Good things grow
            <br className="desktop-break" /> with your regulars
            <span className="accent-period">.</span>
          </h1>
          <p>Here’s how {workspace.shop.name} is bringing people back.</p>
        </div>
        <div className="row">
          <select
            className="filter-select"
            aria-label="Reporting period"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <Link href="/cashier" className="button primary">
            <Plus size={15} />
            Record a purchase
          </Link>
        </div>
      </div>
      <ErrorNotice error={metrics.error} />
      {metrics.loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="metrics-grid">
              {[
                {
                  label: 'Your members',
                  value: data.totalMembers.toLocaleString(),
                  foot: `${data.newMembers} joined in this period`,
                  icon: Users,
                  type: '',
                },
                {
                  label: 'Repeat purchase share',
                  value: `${Math.round(data.repeatShare)}%`,
                  foot: 'Members with 2+ paid receipts',
                  icon: Repeat2,
                  type: 'orange',
                },
                {
                  label: 'Recorded spending',
                  value: money(data.recordedSpendingMinor),
                  foot: `${Math.round(data.amountCoverage)}% of paid receipts include amounts`,
                  icon: Wallet,
                  type: '',
                },
                {
                  label: 'Rewards enjoyed',
                  value: data.rewardsRedeemed.toLocaleString(),
                  foot: `${data.rewardsIssued} rewards issued in this period`,
                  icon: Gift,
                  type: 'orange',
                },
              ].map((metric, index) => (
                <Reveal key={metric.label} delay={index * 0.04} className="metric-card">
                  <div className="between">
                    <span>{metric.label}</span>
                    <div className={`metric-icon ${metric.type}`}>
                      <metric.icon size={17} strokeWidth={1.7} />
                    </div>
                  </div>
                  <strong>{metric.value}</strong>
                  <small>{metric.foot}</small>
                </Reveal>
              ))}
            </div>
            <div className="dashboard-middle">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>One visit becomes a habit.</h2>
                    <p className="subtle">Qualifying paid purchases · shop-local dates</p>
                  </div>
                  <span className="badge neutral">
                    <i className="status-dot" />
                    Paid receipts
                  </span>
                </div>
                <div className="chart-summary">
                  <strong>{data.paidPurchases}</strong>
                  <span>
                    paid purchases
                    <br />
                    <small>
                      {data.activeMembers} active members · {data.visitDays} recorded visit days
                    </small>
                  </span>
                </div>
                <div className="chart-container">
                  <div className="chart-grid">
                    <span>{maximum}</span>
                    <span>{Math.round(maximum / 2)}</span>
                    <span>0</span>
                  </div>
                  <div
                    className="bar-chart"
                    role="img"
                    aria-label={`Paid purchase chart. ${data.paidPurchases} purchases in the selected period.`}
                  >
                    {chart.map((point, index) => (
                      <div className="bar-slot" key={point.date}>
                        <div
                          className={`chart-bar ${index === chart.length - 1 ? 'last' : ''}`}
                          style={{
                            height: `${(point.purchases / maximum) * 100}%`,
                            minHeight: point.purchases ? 5 : 2,
                          }}
                          title={`${dateLabel(point.date)}: ${point.purchases} purchases`}
                        />
                        <span className="bar-tooltip">
                          {dateLabel(point.date)} · {point.purchases}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="chart-dates">
                  <span>{dateLabel(chart[0].date)}</span>
                  <span>{dateLabel(chart[Math.floor(chart.length / 2)].date)}</span>
                  <span>{dateLabel(chart[chart.length - 1].date)}</span>
                </div>
                {days > 30 && (
                  <p className="chart-caption">
                    Chart shows the most recent 30 days. Totals use your selected period.
                  </p>
                )}
              </div>
              <div className="join-panel">
                <div className="join-decoration">
                  <Coffee size={100} strokeWidth={0.65} />
                </div>
                <span className="eyebrow">Your next regular</span>
                <h2>
                  Make it easy
                  <br />
                  to come back.
                </h2>
                <p>
                  One scan. A digital card.
                  <br />A little thank you, every visit.
                </p>
                <div className="join-qr">
                  <QR value={joinURL} size={100} />
                  <div>
                    <strong>Scan & join</strong>
                    <small>{workspace.shop.name}</small>
                  </div>
                </div>
                <Link href="/programme" className="button">
                  Get your shop QR <ArrowUpRight size={15} />
                </Link>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>The latest little moments</h2>
                  <p className="subtle">Recent purchases, rewards, and corrections</p>
                </div>
                <Link href="/activity" className="button quiet">
                  View all activity <ArrowUpRight size={14} />
                </Link>
              </div>
              <ErrorNotice error={activity.error} />
              <ActivityTable items={activity.data?.slice(0, 5) || []} />
            </div>
            <details className="metric-definitions">
              <summary>
                <Info size={13} />
                What these numbers mean
              </summary>
              <p>
                Repeat share is the proportion of purchasing members with at least two qualifying
                paid receipts in the period. A visit day groups a member’s purchases and redemptions
                on the same shop-local date. Recorded spending includes only captured amounts on
                valid qualifying receipts; it is not total shop revenue. Reversed receipts are
                excluded from purchase totals. An active member made a paid purchase or redeemed a
                reward.
              </p>
            </details>
          </>
        )
      )}
    </>
  );
}
