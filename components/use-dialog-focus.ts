'use client';

import { useEffect, useRef } from 'react';

// Keep keyboard focus inside an open modal and restore its triggering control.
export function useDialogFocus(open: boolean, selector: string, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!open) return;
    const dialog = document.querySelector<HTMLElement>(selector);
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button,input,select,textarea,[tabindex]',
    )).filter(element => !element.matches(':disabled,[tabindex="-1"]') && element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] || dialog).focus();
    dialog.setAttribute('tabindex', '-1');
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0], last = items.at(-1);
        if (!first || !dialog.contains(document.activeElement)) {
          event.preventDefault(); focusFirst();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, selector]);
}
