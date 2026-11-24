'use client';

import { useEffect, useState } from 'react';

export type AppTheme = 'mn' | 'blue' | 'ger' | 'dark' | 'paper';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  subtitle: string;
  sb: string;
  bg: string;
  primary: string;
  accent: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'mn',
    name: 'Монгол хээ',
    subtitle: 'Дулаан муутуу · хуш мод · ногоон ой',
    sb: '#4A2C19',
    bg: '#F7F0E3',
    primary: '#2F6B45',
    accent: '#B88A2E',
  },
  {
    id: 'blue',
    name: 'Хөх тэнгэр',
    subtitle: 'Мөнх хөх тэнгэр · цэвэр цайвар',
    sb: '#0F2B5B',
    bg: '#F1F5FA',
    primary: '#1B4FA0',
    accent: '#B08A3C',
  },
  {
    id: 'ger',
    name: 'Гэрийн хээ',
    subtitle: 'Гэрийн унь · дулаан улбар · ногоон',
    sb: '#1F5B3F',
    bg: '#FBF1DC',
    primary: '#C4501B',
    accent: '#D9962B',
  },
  {
    id: 'dark',
    name: 'Өлзий алтан',
    subtitle: 'Шөнийн хар-алтан тансаг горим',
    sb: '#0C0907',
    bg: '#1E1813',
    primary: '#E1B345',
    accent: '#C99A2E',
  },
  {
    id: 'paper',
    name: 'Ургийн бичиг',
    subtitle: 'Эртний муутуу цаас · улаан тамга',
    sb: '#2A1B10',
    bg: '#EFE2C4',
    primary: '#9E2A22',
    accent: '#8A6A33',
  },
];

const LEGACY_MAP: Record<string, AppTheme> = {
  light: 'mn',
  mutuu: 'mn',
  parchment: 'paper',
  kheer: 'blue',
  taiga: 'ger',
  khush: 'dark',
  obsidian: 'dark',
  'deep-purple': 'dark',
  emerald: 'ger',
};

const THEME_SYNC_EVENT = 'guulin-theme-change';

function normalizeTheme(raw: string | null): AppTheme {
  if (!raw) return 'mn';
  if (raw in LEGACY_MAP) return LEGACY_MAP[raw];
  if (THEME_OPTIONS.some((opt) => opt.id === raw)) return raw as AppTheme;
  return 'mn';
}

function applyThemeToDocument(themeId: AppTheme) {
  document.documentElement.dataset.th = themeId;
  document.documentElement.setAttribute('data-theme', themeId === 'dark' ? 'dark' : 'light');
}

export function ThemePicker({
  variant = 'topbar',
  showLabel = true,
}: {
  variant?: 'topbar' | 'compact';
  showLabel?: boolean;
}) {
  const [currentTheme, setCurrentTheme] = useState<AppTheme>('mn');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('gth') ?? localStorage.getItem('guulin-theme');
      const resolved = normalizeTheme(saved);
      setCurrentTheme(resolved);
      applyThemeToDocument(resolved);
    } catch {
      applyThemeToDocument('mn');
    }

    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<AppTheme>).detail;
      if (detail) setCurrentTheme(detail);
    };
    window.addEventListener(THEME_SYNC_EVENT, onSync);
    return () => window.removeEventListener(THEME_SYNC_EVENT, onSync);
  }, []);

  function changeTheme(themeId: AppTheme) {
    setCurrentTheme(themeId);
    applyThemeToDocument(themeId);
    try {
      localStorage.setItem('gth', themeId);
      localStorage.setItem('guulin-theme', themeId === 'dark' ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
    window.dispatchEvent(new CustomEvent<AppTheme>(THEME_SYNC_EVENT, { detail: themeId }));
  }

  return (
    <div
      className={`theme-dots ${variant === 'compact' ? 'theme-dots--compact' : ''}`}
      role="group"
      aria-label="Өнгөний сэдэв сонгох"
    >
      {showLabel && variant !== 'compact' && (
        <span className="theme-dots__label">Өнгө</span>
      )}
      {THEME_OPTIONS.map((opt) => {
        const isActive = opt.id === currentTheme;
        return (
          <button
            key={opt.id}
            type="button"
            className={`theme-dot ${isActive ? 'is-active' : ''}`}
            aria-label={`${opt.name} — ${opt.subtitle}`}
            aria-pressed={isActive}
            title={`${opt.name} (${opt.subtitle})`}
            style={{
              background: `linear-gradient(135deg, ${opt.primary} 50%, ${opt.bg} 50%)`,
            }}
            onClick={() => changeTheme(opt.id)}
          />
        );
      })}
    </div>
  );
}
