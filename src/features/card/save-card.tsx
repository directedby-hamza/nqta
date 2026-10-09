'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Link as LinkIcon, Share2, Smartphone } from 'lucide-react';
import { ErrorNotice, Modal } from '@/components/ui/primitives';

const checkoutCode = /^NQ-[A-F0-9]{16}$/;

export async function checkoutQRSource(memberCode: string): Promise<string> {
  if (!checkoutCode.test(memberCode)) throw new Error('Checkout code unavailable');
  const qr = await import('qrcode');
  return qr.toDataURL(memberCode, {
    width: 620,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#183e30', light: '#ffffff' },
  });
}

async function checkoutImage(memberCode: string, shopName: string): Promise<Blob> {
  const source = await checkoutQRSource(memberCode);
  const qr = new Image();
  await new Promise<void>((resolve, reject) => {
    qr.onload = () => resolve();
    qr.onerror = () => reject(new Error('Could not prepare your QR image. Please try again.'));
    qr.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1040;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare your QR image. Please try again.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.fillStyle = '#175c46';
  context.font = 'bold 50px sans-serif';
  context.fillText('nqta.', 400, 85);
  context.fillStyle = '#222c25';
  context.font = 'bold 34px sans-serif';
  context.fillText(shopName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100), 400, 139, 680);
  context.fillStyle = '#697363';
  context.font = '24px sans-serif';
  context.fillText('Your checkout card', 400, 178);
  context.drawImage(qr, 90, 212, 620, 620);
  context.fillStyle = '#183e30';
  context.font = '24px monospace';
  context.fillText(memberCode, 400, 879);
  context.fillStyle = '#222c25';
  context.font = 'bold 26px sans-serif';
  context.fillText('Show this QR to the team at checkout.', 400, 935, 680);
  context.fillStyle = '#697363';
  context.font = '21px sans-serif';
  context.fillText('Open your card online for points and rewards.', 400, 980, 680);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Could not prepare your QR image. Please try again.')),
      'image/png',
    );
  });
}

export function SaveCard({
  memberCode,
  shopName,
  membershipId,
  shopSlug,
  passwordAccount,
  active,
}: {
  memberCode: string;
  shopName: string;
  membershipId: string;
  shopSlug: string;
  passwordAccount: boolean;
  active: boolean;
}) {
  const [help, setHelp] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [canShare, setCanShare] = useState(false);
  const operation = useRef(0);
  const fileName = `nqta-${memberCode}.png`;
  const available = active && checkoutCode.test(memberCode);

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.url);
    };
  }, [image]);

  useEffect(() => {
    operation.current++;
    setImage(null);
    setImageOpen(false);
    setBusy(false);
    setStatus('');
    setError('');
    return () => {
      operation.current++;
    };
  }, [available, memberCode, shopName, membershipId]);

  function download(url: string) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function saveImage() {
    if (!available || busy) return;
    const attempt = operation.current;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const blob = await checkoutImage(memberCode, shopName);
      if (operation.current !== attempt) return;
      const url = URL.createObjectURL(blob);
      setImage({ url, blob });
      const file = new File([blob], fileName, { type: 'image/png' });
      setCanShare(!!navigator.canShare?.({ files: [file] }));
      download(url);
      setImageOpen(true);
    } catch (e) {
      if (operation.current === attempt) {
        setError(
          e instanceof Error ? e.message : 'Could not save your QR image. Please try again.',
        );
      }
    } finally {
      if (operation.current === attempt) setBusy(false);
    }
  }

  async function shareImage() {
    if (!image || !available) return;
    setError('');
    try {
      await navigator.share({
        files: [new File([image.blob], fileName, { type: 'image/png' })],
        title: `${shopName} checkout card`,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError('Sharing is unavailable here. Download the image or touch and hold it to save.');
    }
  }

  async function copyLink() {
    setError('');
    setStatus('');
    try {
      const link = new URL(`/card/${encodeURIComponent(membershipId)}`, window.location.origin);
      link.searchParams.set('shop', shopSlug);
      await navigator.clipboard.writeText(link.href);
      setStatus('Card link copied. Bookmark it for your next visit.');
    } catch {
      setError('Could not copy the link. You can bookmark this page from your browser menu.');
    }
  }

  return (
    <section className="save-card-actions" aria-label="Keep your card handy">
      <div className="save-card-buttons">
        <button
          className="button primary"
          disabled={!available || busy}
          onClick={() => void saveImage()}
        >
          <Download size={16} /> {busy ? 'Preparing image…' : 'Save QR image'}
        </button>
        <button className="button secondary" disabled={!available} onClick={() => setHelp(true)}>
          <Smartphone size={16} /> Add to home screen
        </button>
      </div>
      <p className="save-card-note">
        Keep the QR image in your photos for checkout. The team needs an internet connection to add
        stamps. Open your card online to see your latest progress.
      </p>
      <button
        className="button quiet card-bookmark-button"
        disabled={!available}
        onClick={() => void copyLink()}
      >
        <LinkIcon size={14} /> Copy my card link
      </button>
      {status && (
        <p className="subtle" role="status">
          {status}
        </p>
      )}
      {!imageOpen && <ErrorNotice error={error} />}
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="Your card, one tap away."
        description="Save a shortcut to this page on your own phone."
      >
        <div className="home-screen-help stack">
          <div>
            <h3>iPhone · Safari</h3>
            <ol>
              <li>Open this card in Safari.</li>
              <li>Tap Share, then Add to Home Screen.</li>
              <li>Tap Add. Your card shortcut will appear on your home screen.</li>
            </ol>
            <p className="subtle">
              If Share is hidden, open the More menu first. If Add to Home Screen is missing, choose
              Edit Actions in the share menu and add it.
            </p>
          </div>
          <div>
            <h3>Android · Chrome</h3>
            <ol>
              <li>Open this card in Chrome.</li>
              <li>Open the ⋮ menu, then Add to home screen.</li>
              <li>Choose Create shortcut if shown, then confirm Add.</li>
            </ol>
          </div>
          <p className="subtle">
            Keep this browser signed in on your own phone. The shortcut opens your online card; your
            saved QR image can be shown without opening the page. If the shortcut asks you to sign
            in,{' '}
            {passwordAccount
              ? 'use your phone number and password once.'
              : 'verify the same phone through your shop.'}
          </p>
          <button className="button primary wide" onClick={() => setHelp(false)}>
            Got it
          </button>
        </div>
      </Modal>
      <Modal
        open={imageOpen && available}
        onOpenChange={setImageOpen}
        title="Keep this QR for checkout."
        description="Your image contains the checkout code, not your password or account details."
      >
        {image && (
          <div className="stack">
            <img
              className="saved-qr-preview"
              src={image.url}
              alt={`${shopName} checkout QR card`}
            />
            <p className="subtle">
              On iPhone, touch and hold this image and choose Save to Photos. You can also use Share
              image, then Save Image. Downloads are saved in your browser’s download folder.
            </p>
            <div className="save-card-buttons">
              <button className="button primary" onClick={() => download(image.url)}>
                <Download size={16} /> Download QR image
              </button>
              {canShare && (
                <button className="button secondary" onClick={() => void shareImage()}>
                  <Share2 size={16} /> Share image
                </button>
              )}
            </div>
            <ErrorNotice error={error} />
          </div>
        )}
      </Modal>
    </section>
  );
}
