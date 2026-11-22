'use client';

import { useEffect, useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';

export type AppTheme = 'parchment' | 'mauve' | 'deep-purple' | 'emerald' | 'obsidian';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  subtitle: string;
  color: string;
  accent: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'parchment',
    name: 'Нарлаг шаазан',
    subtitle: 'Дулаан гэр бүлийн өнгө',
    color: '#FBF9F4',
    accent: '#D97706',
  },
  {
    id: 'mauve',
    name: 'Бараавтар ягаан',
    subtitle: 'Бараавтар талдаа / Mauve',
    color: '#8E6F8E',
    accent: '#B088B0',
  },
  {
    id: 'deep-purple',
    name: 'Гүн ягаан',
    subtitle: 'Гүн ягаан / Deep Purple',
    color: '#533457',
    accent: '#C084FC',
  },
  {
    id: 'emerald',
    name: 'Номин ногоон',
    subtitle: 'Уламжлалт ой мод',
    color: '#0A3229',
    accent: '#D4AF37',
  },
  {
    id: 'obsidian',
    name: 'Шөнийн хар',
    subtitle: 'Өндөр тодролтой бараан',
    color: '#0F172A',
    accent: '#F59E0B',
  },
];

export function ThemePicker() {
  const [currentTheme, setCurrentTheme] = useState<AppTheme>('parchment');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('guulin-theme') as AppTheme | null;
      if (saved && THEME_OPTIONS.some((opt) => opt.id === saved)) {
        setCurrentTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        document.documentElement.setAttribute('data-theme', 'parchment');
      }
    } catch {
      // Ignore localStorage errors
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
        <Palette size={16} aria-hidden="true" />
        <span
          className="app-shell__theme-swatch"
          style={{ background: activeOption.color, borderColor: activeOption.accent }}
          aria-hidden="true"
        />
        <span className="app-shell__theme-label">{activeOption.name}</span>
      </button>

      {isOpen && (
        <div className="app-shell__theme-menu" role="dialog" aria-label="Өнгөний сонголт">
          <div className="app-shell__theme-menu-head">
            <strong>Дэвсгэр өнгөний сэдэв</strong>
            <small>Таны хүссэнээр өнгө өөрчлөгдөнө</small>
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
                  <span
                    className="app-shell__theme-preview"
                    style={{ background: opt.color, border: `2px solid ${opt.accent}` }}
                  >
                    {isSelected && <Check size={14} color={opt.id === 'parchment' || opt.id === 'mauve' ? '#1e293b' : '#ffffff'} />}
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
