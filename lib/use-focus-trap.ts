'use client';

import { RefObject, useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'details > summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

let activeScrollLocks = 0;
let savedBodyOverflow: string | null = null;

function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return;
  if (activeScrollLocks === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeScrollLocks += 1;
}

function releaseBodyScrollLock() {
  if (typeof document === 'undefined' || activeScrollLocks === 0) return;
  activeScrollLocks -= 1;
  if (activeScrollLocks === 0) {
    document.body.style.overflow = savedBodyOverflow ?? '';
    savedBodyOverflow = null;
  }
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    return el.offsetParent !== null || el.getClientRects().length > 0;
  });
}

export interface UseFocusTrapOptions {
  onEscape?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
  disabled?: boolean;
}

/**
 * Trap Tab navigation inside a modal dialog container, bind Escape, lock body scroll
 * safely across nested dialogs, and restore focus to the invoking trigger on close.
 */
export function useFocusTrap(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions = {},
) {
  const { initialFocusRef, lockScroll = true, onEscape, disabled = false } = options;
  const onEscapeRef = useRef(onEscape);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    onEscapeRef.current = onEscape;
    disabledRef.current = disabled;
  }, [onEscape, disabled]);

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const previousActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (lockScroll) {
      acquireBodyScrollLock();
    }

    const frameId = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current && container.contains(initialFocusRef.current)
          ? initialFocusRef.current
          : getFocusableElements(container)[0] ?? container;

      if (target === container && !container.hasAttribute('tabindex')) {
        container.tabIndex = -1;
      }
      target.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!disabledRef.current && onEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        if (!container.hasAttribute('tabindex')) {
          container.tabIndex = -1;
        }
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (lockScroll) {
        releaseBodyScrollLock();
      }
      if (previousActive && previousActive.isConnected) {
        previousActive.focus({ preventScroll: true });
      }
    };
  }, [isOpen, containerRef, initialFocusRef, lockScroll]);
}
