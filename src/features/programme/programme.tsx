'use client';
import { useState, type FormEvent } from 'react';
import { Gift, LockKeyhole, ArrowUpRight, Download, Check, Coffee, ScanLine } from 'lucide-react';
import { useWorkspace } from '@/components/layout/merchant-shell';
import { api, message } from '@/lib/api';
import { ErrorNotice, Modal, QR, Toast } from '@/components/ui/primitives';
export function ProgrammePage() {
  const { workspace, refresh } = useWorkspace();
  const p = workspace.programme;
  const [threshold, setThreshold] = useState(p?.threshold || 5);
  const [reward, setReward] = useState(p?.reward_description || '');
  const [eligibility, setEligibility] = useState(
    p?.eligibility || 'One qualifying paid receipt earns one stamp.',
  );
  const [terms, setTerms] = useState(
    p?.terms ||
      'No automatic reward expiry. Reward-only receipts earn no stamp. Rewards are confirmed by staff.',
  );
  const [draftId, setDraftId] = useState(p?.status === 'draft' ? p.id : '');
  const [revision, setRevision] = useState(p?.revision || 0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const published = p?.status === 'published';
  const owner = workspace.actor.role === 'owner';
  const url =
    typeof window !== 'undefined' ? `${window.location.origin}/join/${workspace.shop.slug}` : '';
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string; revision: number }>('programme/draft', {
        method: 'POST',
        body: {
          id: draftId || undefined,
          threshold,
          rewardDescription: reward,
          eligibility,
          terms,
        },
      });
      setDraftId(result.id);
      setRevision(result.revision);
      setDirty(false);
      setToast('Draft saved');
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    setError('');
    try {
      await api('programme/publish', { method: 'POST', body: { id: draftId, revision } });
      setPublishing(false);
      setToast('Your programme is published');
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function poster() {
    setDownloadBusy(true);
    try {
      const qr = await import('qrcode');
      const data = await qr.toDataURL(url, { width: 640, margin: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1600;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Poster generation unavailable');
      ctx.fillStyle = '#f7f8f5';
      ctx.fillRect(0, 0, 1200, 1600);
      ctx.fillStyle = workspace.shop.theme;
      ctx.fillRect(0, 0, 1200, 480);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText(workspace.shop.name.slice(0, 30), 600, 160, 1080);
      ctx.font = '36px sans-serif';
      ctx.fillText('A little loyalty goes a long way.', 600, 245);
      ctx.fillStyle = '#183e30';
      ctx.font = 'bold 65px sans-serif';
      ctx.fillText('Scan. Join. Come back.', 600, 595);
      const image = new Image();
      image.src = data;
      await image.decode();
      ctx.drawImage(image, 280, 670, 640, 640);
      ctx.font = '28px sans-serif';
      ctx.fillText(url, 600, 1380, 1080);
      ctx.font = '24px sans-serif';
      ctx.fillText('No app needed. Verify your phone. Keep your rewards.', 600, 1450);
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('nqta.', 600, 1530);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${workspace.shop.slug}-loyalty-poster.png`;
      link.click();
    } catch (e) {
      setError(message(e));
    } finally {
      setDownloadBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A reason to come back</div>
          <h1>
            Little stamps. Lasting habits<span className="accent-period">.</span>
          </h1>
          <p>Your shop’s thank you, made simple.</p>
        </div>
        <span className={`badge ${published ? '' : 'warm'}`}>
          {published ? <Check size={12} /> : <Gift size={12} />}{' '}
          {published ? 'Published programme' : 'Your first programme'}
        </span>
      </div>
      <ErrorNotice error={error} />
      <div className="programme-layout">
        <div className="panel">
          <div className="panel-head">
            <h2>{published ? 'Your published rules' : 'Shape your first programme'}</h2>
            {published && <LockKeyhole size={17} className="muted" />}
          </div>
          <form className="panel-body" onSubmit={save}>
            {published && (
              <div className="notice programme-lock">
                <LockKeyhole size={16} />
                Published earning and reward rules are locked to preserve what customers have
                earned.
              </div>
            )}
            <div className="field">
              <label htmlFor="threshold">Qualifying receipts to earn a reward</label>
              <input
                id="threshold"
                type="number"
                min={1}
                max={100}
                value={threshold}
                onChange={(e) => {
                  setThreshold(Number(e.target.value));
                  setDirty(true);
                }}
                disabled={published || !owner || busy}
                required
              />
              <small>
                One qualifying paid receipt earns one stamp, regardless of item quantity.
              </small>
            </div>
            <div className="field">
              <label htmlFor="reward-description">The little reward</label>
              <input
                id="reward-description"
                placeholder="For example, one standard coffee on us"
                value={reward}
                onChange={(e) => {
                  setReward(e.target.value);
                  setDirty(true);
                }}
                disabled={published || !owner || busy}
                required
                maxLength={250}
              />
              <small>Be clear about the item, service, or discount you will honour.</small>
            </div>
            <div className="field">
              <label htmlFor="eligibility">What counts as a qualifying purchase?</label>
              <textarea
                id="eligibility"
                value={eligibility}
                onChange={(e) => {
                  setEligibility(e.target.value);
                  setDirty(true);
                }}
                disabled={published || !owner || busy}
                required
                maxLength={1000}
              />
            </div>
            <div className="field">
              <label htmlFor="terms">Programme terms</label>
              <textarea
                id="terms"
                value={terms}
                onChange={(e) => {
                  setTerms(e.target.value);
                  setDirty(true);
                }}
                disabled={published || !owner || busy}
                required
                maxLength={2000}
              />
            </div>
            {!published && owner && (
              <div className="row">
                <button className="button secondary" disabled={busy}>
                  Save draft
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !draftId || dirty}
                  onClick={() => {
                    setError('');
                    setPublishing(true);
                  }}
                >
                  Review & publish <ArrowUpRight size={15} />
                </button>
              </div>
            )}
            {published && (
              <p className="subtle">
                Need different rules? Request an assisted transition in Settings. Existing balances
                and exact reward promises must be preserved.
              </p>
            )}
          </form>
        </div>
        <div className="stack">
          <div className="programme-preview" style={{ background: workspace.shop.theme }}>
            <div className="between">
              <strong>{workspace.shop.name}</strong>
              <Coffee size={24} />
            </div>
            <h2>
              A little thank you.
              <br />
              Every time you return.
            </h2>
            <div className="preview-stamps">
              {Array.from({ length: Math.min(threshold, 8) }, (_, i) => (
                <span key={i}>{i === Math.min(threshold, 8) - 1 ? <Gift size={19} /> : i + 1}</span>
              ))}
            </div>
            <p>{threshold} qualifying paid receipts</p>
            <strong>{reward || 'Your little reward goes here'}</strong>
            <span className="preview-label">Customer card preview</span>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Your shop QR</h2>
              <ScanLine size={19} />
            </div>
            <div className="programme-qr">
              <QR value={url} size={145} />
              <p>
                One scan starts a new connection.
                <br />
                <small>This QR enrols customers; only staff can issue stamps.</small>
              </p>
              <a href={`/join/${workspace.shop.slug}`} target="_blank" className="button quiet">
                Preview customer page <ArrowUpRight size={14} />
              </a>
              <button
                className="button secondary wide"
                disabled={!published || downloadBusy}
                onClick={() => void poster()}
              >
                <Download size={14} />
                {downloadBusy ? 'Preparing poster…' : 'Download enrolment poster'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Modal
        open={publishing}
        onOpenChange={setPublishing}
        title="Ready for your first regular?"
        description="Publishing locks the economic rules and opens customer enrolment. Check your promise before confirming."
      >
        <div className="stack">
          <div className="notice">
            {threshold} qualifying paid receipts earn: <strong>{reward}</strong>
          </div>
          <p className="subtle">
            {eligibility}
            <br />
            {terms}
          </p>
          <ErrorNotice error={error} />
          <button className="button primary wide" disabled={busy} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish programme'}
            <Check size={15} />
          </button>
        </div>
      </Modal>
      <Toast text={toast} onClose={() => setToast('')} />
    </>
  );
}
