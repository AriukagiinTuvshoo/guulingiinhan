'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useFocusTrap } from '../lib/use-focus-trap';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Батлах',
  cancelLabel = 'Болих',
  variant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(isOpen, dialogRef, {
    onEscape: onCancel,
    initialFocusRef: confirmBtnRef,
    disabled: busy,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', 'true');
        }
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        width: '100vw',
        height: '100vh',
        maxWidth: 'none',
        maxHeight: 'none',
        margin: 0,
        border: 'none',
        backgroundColor: 'var(--ui-backdrop)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--ui-surface)',
          color: 'var(--ui-text)',
          border: '1px solid var(--ui-border)',
          borderRadius: '16px',
          padding: '22px 24px',
          boxShadow: 'var(--ui-shadow-modal)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isDanger ? 'var(--ui-danger-bg)' : 'var(--ui-warning-bg)',
                color: isDanger ? 'var(--ui-danger-text)' : 'var(--ui-warning-text)',
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <AlertTriangle size={18} />
            </span>
            <h3
              id="confirm-dialog-title"
              style={{ margin: 0, font: '600 17px Georgia, serif', color: 'var(--ui-text)' }}
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Хаах"
            style={{
              background: 'none',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              color: 'var(--ui-text-muted)',
              padding: '4px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <p
          id="confirm-dialog-desc"
          style={{
            margin: '0 0 20px',
            fontSize: '13.5px',
            lineHeight: 1.55,
            color: 'var(--ui-text-secondary)',
            whiteSpace: 'pre-line',
          }}
        >
          {message}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="homev2-button homev2-button--light"
            style={{ fontSize: '12.5px', padding: '8px 16px' }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              fontSize: '12.5px',
              padding: '8px 18px',
              borderRadius: '999px',
              border: 'none',
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              background: isDanger ? '#dc2626' : '#0f766e',
              color: '#ffffff',
            }}
          >
            {busy ? 'Гүйцэтгэж байна…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
