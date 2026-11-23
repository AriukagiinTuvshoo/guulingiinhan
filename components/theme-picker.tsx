'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check } from 'lucide-react';

export type AppTheme = 'mutuu' | 'khush' | 'taiga' | 'kheer';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  subtitle: string;
  bg: string;
  primary: string;
  accent: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'mutuu',
    name: 'Муутуу Цаас',
    subtitle: 'Ургийн бичгийн дулаан цаас',
    bg: '#F2ECE0',
    primary: '#1E3D2F',
    accent: '#9A7432',
  },
  {
    id: 'khush',
    name: 'Хуш Мод',
    subtitle: 'Сийлбэртэй хуш · хүрэл алт',
    bg: '#15120E',
    primary: '#3E644D',
    accent: '#C9A45C',
  },
  {
    id: 'taiga',
    name: 'Тайгын Ой',
    subtitle: 'Гүн шилмүүст ой · бүдэг гууль',
    bg: '#0B1D17',
    primary: '#2B614C',
    accent: '#CEAC5A',
  },
  {
    id: 'kheer',
    name: 'Хээрийн Чулуу',
    subtitle: 'Цэвэр цайвар · бэхэн хар',
    bg: '#F4F3EE',
    primary: '#234036',
    accent: '#8C6A2E',
  },
];

const LEGACY_MAP: Record<string, AppTheme> = {
  light: 'mutuu',
  dark: 'khush',
  parchment: 'mutuu',
  emerald: 'taiga',
  obsidian: 'khush',
  mauve: 'mutuu',
  'deep-purple': 'khush',
};

const THEME_SYNC_EVENT = 'guulin-theme-change';

function normalizeTheme(raw: string | null): AppTheme {
  if (!raw) return 'mutuu';
  if (raw in LEGACY_MAP) return LEGACY_MAP[raw];
  if (THEME_OPTIONS.some((opt) => opt.id === raw)) return raw as AppTheme;
  return 'mutuu';
}

export function ThemePicker({
  variant = 'topbar',
}: {
  variant?: 'topbar' | 'compact' | 'floating';
}) {
  const [currentTheme, setCurrentTheme] = useState<AppTheme>('mutuu');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const resolved = normalizeTheme(localStorage.getItem('guulin-theme'));
      setCurrentTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    } catch {
      document.documentElement.setAttribute('data-theme', 'mutuu');
    }

    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<AppTheme>).detail;
      if (detail) setCurrentTheme(detail);
    };
    window.addEventListener(THEME_SYNC_EVENT, onSync);
    return () => window.removeEventListener(THEME_SYNC_EVENT, onSync);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function changeTheme(themeId: AppTheme) {
    setCurrentTheme(themeId);
    setIsOpen(false);
    document.documentElement.setAttribute('data-theme', themeId);
    try {
      localStorage.setItem('guulin-theme', themeId);
    } catch {
      // Ignore storage errors
    }
    window.dispatchEvent(new CustomEvent<AppTheme>(THEME_SYNC_EVENT, { detail: themeId }));
  }

  const activeOption = THEME_OPTIONS.find((opt) => opt.id === currentTheme) ?? THEME_OPTIONS[0];
  const btnClass =
    variant === 'compact'
      ? 'theme-picker__btn theme-picker__btn--compact'
      : variant === 'topbar'
        ? 'theme-picker__btn theme-picker__btn--topbar'
        : 'theme-picker__btn';

  return (
    <div className="theme-picker" ref={containerRef}>
      <button
        type="button"
        className={btnClass}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Өнгөний сэдэв солих"
        aria-label="Өнгөний сэдэв сонгох"
      >
        <span
          className="theme-picker__dot"
          style={{ background: activeOption.accent, borderColor: activeOption.primary }}
          aria-hidden="true"
        />
        <span className="theme-picker__label">{activeOption.name}</span>
      </button>

      {isOpen && (
        <div
          className={`theme-picker__menu ${variant === 'floating' ? 'theme-picker__menu--up' : ''}`}
          role="dialog"
          aria-label="Өнгөний сонголт"
        >
          <div className="theme-picker__head">
            <strong>Өнгөний сэдэв</strong>
            <small>4 байгалийн уламжлалт хослол</small>
          </div>

          <div className="theme-picker__list">
            {THEME_OPTIONS.map((opt) => {
              const isSelected = opt.id === currentTheme;
              return (
                <button
                  type="button"
                  key={opt.id}
                  className={`theme-picker__option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => changeTheme(opt.id)}
                >
                  <span className="theme-picker__tri" aria-hidden="true">
                    <span style={{ background: opt.bg }} />
                    <span style={{ background: opt.primary }} />
                    <span style={{ background: opt.accent }} />
                  </span>
                  <div className="theme-picker__info">
                    <strong>{opt.name}</strong>
                    <small>{opt.subtitle}</small>
                  </div>
                  {isSelected && <Check size={14} className="theme-picker__check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact corner theme switcher rendered on standalone routes (Landing, Auth, Invite, Onboarding)
 * that do not mount AppShell or AdminShell's topbar ThemePicker.
 */
export function FloatingThemeCorner() {
  const pathname = usePathname();
  if (!pathname) return null;

  // Routes that already render ThemePicker inside their topbar
  const hasTopbarPicker =
    pathname === '/admin' ||
    pathname === '/admin/overview' ||
    pathname === '/admin/console' ||
    pathname.startsWith('/admin/ancestry') ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/tree' ||
    pathname.startsWith('/tree/') ||
    pathname === '/ancestry' ||
    pathname.startsWith('/ancestry/') ||
    pathname === '/people' ||
    pathname.startsWith('/people/') ||
    pathname === '/profile' ||
    pathname.startsWith('/profile/') ||
    pathname === '/stories' ||
    pathname.startsWith('/stories/') ||
    pathname === '/memories' ||
    pathname.startsWith('/memories/') ||
    pathname === '/archives' ||
    pathname.startsWith('/archives/') ||
    pathname === '/community' ||
    pathname.startsWith('/community/') ||
    pathname === '/news' ||
    pathname === '/activities' ||
    pathname.startsWith('/activities/') ||
    pathname === '/chat' ||
    pathname.startsWith('/chat/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/search' ||
    pathname === '/relationships' ||
    pathname === '/account/security';

  if (hasTopbarPicker) return null;

  return (
    <div className="floating-theme-corner">
      <ThemePicker variant="floating" />
    </div>
  );
}
