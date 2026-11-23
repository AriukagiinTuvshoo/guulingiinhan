'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Sun } from 'lucide-react';

export type AppTheme = 'light' | 'dark';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  subtitle: string;
  swatchClass: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    name: 'Цайвар',
    subtitle: 'Илгэн цагаан ба ойн ногоон',
    swatchClass: 'theme-swatch--light',
  },
  {
    id: 'dark',
    name: 'Бараан',
    subtitle: 'Шөнийн ой ба эртний алт',
    swatchClass: 'theme-swatch--dark',
  },
];

export function normalizeStoredTheme(raw: string | null): AppTheme {
  if (raw === 'dark' || raw === 'obsidian' || raw === 'deep-purple' || raw === 'emerald') {
    return 'dark';
  }
  return 'light';
}

export function ThemePicker() {
  const [currentTheme, setCurrentTheme] = useState<AppTheme>('light');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('guulin-theme');
      const resolved = normalizeStoredTheme(raw);
      setCurrentTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
      if (raw && raw !== resolved) {
        localStorage.setItem('guulin-theme', resolved);
      }
    } catch {
      document.documentElement.setAttribute('data-theme', 'light');
    }
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
      // Ignore localStorage errors
    }
  }

  const activeOption = THEME_OPTIONS.find((opt) => opt.id === currentTheme) ?? THEME_OPTIONS[0];

  return (
    <div className="app-shell__theme-picker" ref={containerRef}>
      <button
        type="button"
        className="app-shell__theme-button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Дэвсгэр өнгөний сэдэв солих"
        aria-label="Өнгөний сэдэв сонгох"
      >
        {currentTheme === 'dark' ? (
          <Moon size={15} aria-hidden="true" />
        ) : (
          <Sun size={15} aria-hidden="true" />
        )}
        <span
          className={`app-shell__theme-swatch ${activeOption.swatchClass}`}
          aria-hidden="true"
        />
        <span className="app-shell__theme-label">{activeOption.name}</span>
      </button>

      {isOpen && (
        <div className="app-shell__theme-menu" role="dialog" aria-label="Өнгөний сонголт">
          <div className="app-shell__theme-menu-head">
            <strong>Дэвсгэр өнгөний сэдэв</strong>
            <small>Цайвар эсвэл бараан горим сонгоно уу</small>
          </div>

          <div className="app-shell__theme-grid">
            {THEME_OPTIONS.map((opt) => {
              const isSelected = opt.id === currentTheme;
              return (
                <button
                  type="button"
                  key={opt.id}
                  className={`app-shell__theme-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => changeTheme(opt.id)}
                >
                  <span className={`app-shell__theme-preview ${opt.swatchClass}`}>
                    {isSelected && <Check size={14} />}
                  </span>
                  <div className="app-shell__theme-info">
                    <strong>{opt.name}</strong>
                    <small>{opt.subtitle}</small>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
