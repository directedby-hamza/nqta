'use client';
import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { Modal, ErrorNotice } from '@/components/ui/primitives';
export function Scanner({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let controls: IScannerControls | undefined;
    setError('');
    import('@zxing/browser')
      .then(async ({ BrowserQRCodeReader }) => {
        if (cancelled || !video.current) return;
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          video.current,
          (result) => {
            if (result && !cancelled) {
              cancelled = true;
              controls?.stop();
              onScan(result.getText());
              onClose();
            }
          },
        );
        if (cancelled) controls.stop();
      })
      .catch(() => {
        if (!cancelled)
          setError('Camera access is unavailable. You can enter the member code below instead.');
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title="A quick hello."
      description="Scan the member QR on the customer’s card. Camera access is used only for this scan."
    >
      <video ref={video} className="scanner-video" muted playsInline />
      <ErrorNotice error={error} />
      <button className="button secondary wide" onClick={onClose}>
        Use manual entry instead
      </button>
    </Modal>
  );
}
