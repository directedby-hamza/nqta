'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X, CircleCheck, AlertCircle } from 'lucide-react';
import { motion, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={className}
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) previousFocus.current = document.activeElement as HTMLElement;
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current?.focus();
          }}
        >
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description className="modal-description">{description}</Dialog.Description>
          <Dialog.Close className="modal-close" aria-label="Close dialog">
            <X size={19} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <div className="spinner" />
      <span className="sr-only">Loading your workspace</span>
    </div>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <div className="notice error" role="alert">
      <AlertCircle
        size={15}
        style={{ display: 'inline', marginRight: 7, verticalAlign: 'middle' }}
      />
      {error}
    </div>
  ) : null;
}
export function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    if (text) {
      const timer = setTimeout(onClose, 6000);
      return () => clearTimeout(timer);
    }
  }, [text, onClose]);
  return text ? (
    <div className="toast" role="status">
      <CircleCheck size={18} />
      <span>{text}</span>
      <button onClick={onClose} aria-label="Dismiss notification">
        <X size={15} />
      </button>
    </div>
  ) : null;
}
export function QR({ value, size = 180 }: { value: string; size?: number }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    import('qrcode')
      .then((qr) =>
        qr.toDataURL(value, {
          width: size * 2,
          margin: 2,
          color: { dark: '#183e30', light: '#ffffff' },
        }),
      )
      .then((data) => {
        if (active) setUrl(data);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [value, size]);
  return url ? (
    <img src={url} alt="Scannable QR code" width={size} height={size} />
  ) : (
    <div
      style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}
      className="subtle"
    >
      {error ? 'Use the code below' : 'Preparing QR…'}
    </div>
  );
}
