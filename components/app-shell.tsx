'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  BookOpen,
  GitFork,
  Globe2,
  Home,
  LogOut,
  Menu,
  Settings,
  TreeDeciduous,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family, User } from '../lib/api';

type NavItem = {
  key: 'dashboard' | 'tree' | 'people' | 'stories' | 'memories' | 'archives' | 'settings';
  label: string;
  description: string;
  icon: LucideIcon;
  path: string;
  needsFamily: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Нүүр', description: 'Гэр бүлийн тойм', icon: Home, path: '/dashboard', needsFamily: false },
  { key: 'tree', label: 'Удмын мод', description: 'Удам, холбоосууд', icon: GitFork, path: '/tree', needsFamily: true },
  { key: 'people', label: 'Хүмүүс', description: 'Гэр бүлийн хүмүүс', icon: Users, path: '/people', needsFamily: true },
  { key: 'stories', label: 'Манай түүх', description: 'Түүх, үйл явдлууд', icon: BookOpen, path: '/stories', needsFamily: true },
  { key: 'memories', label: 'Дурсамж', description: 'Хадгалсан дурсамж', icon: Globe2, path: '/memories', needsFamily: true },
  { key: 'archives', label: 'Архив', description: 'Гэр бүлийн баримт', icon: Archive, path: '/archives', needsFamily: true },
  { key: 'settings', label: 'Тохиргоо', description: 'Account ба аюулгүй байдал', icon: Settings, path: '/settings', needsFamily: false },
];

function isShellRoute(pathname: string) {
  return (
    pathname === '/people' ||
    pathname.startsWith('/people/') ||
    pathname === '/tree' ||
    pathname.startsWith('/tree/') ||
    pathname === '/stories' ||
    pathname.startsWith('/stories/') ||
    pathname === '/memories' ||
    pathname.startsWith('/memories/') ||
    pathname === '/archives' ||
    pathname.startsWith('/archives/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/account/security' ||
    pathname === '/profile' ||
    pathname.startsWith('/profile/')
  );
}

function isDashboardRoute(pathname: string) {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}

function activeKey(pathname: string): NavItem['key'] | null {
  if (isDashboardRoute(pathname)) return 'dashboard';
  if (pathname === '/tree' || pathname.startsWith('/tree/')) return 'tree';
  if (pathname === '/people' || pathname.startsWith('/people/')) return 'people';
  if (pathname === '/stories' || pathname.startsWith('/stories/')) return 'stories';
  if (pathname === '/memories' || pathname.startsWith('/memories/')) return 'memories';
  if (pathname === '/archives' || pathname.startsWith('/archives/')) return 'archives';
  if (
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/account/security'
  ) {
    return 'settings';
  }
  return null;
}

function familyHref(path: string, familyId: string | null) {
  if (!familyId) return path;
  return path + '?family=' + encodeURIComponent(familyId);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const shouldRenderShell = isShellRoute(pathname);
  const requestedFamilyId = searchParams.get('family') ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextError, setContextError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstNavRef = useRef<HTMLAnchorElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);

  const currentFamily = useMemo(
    () => families.find((family) => family.id === familyId) ?? null,
    [families, familyId],
  );

  const retryContext = useCallback(async () => {
    setContextLoading(true);
    setContextLoaded(false);
    setContextError('');
    try {
      const [me, familyData] = await Promise.all([
        api<User>('/auth/me'),
        api<Family[]>('/families'),
      ]);
      setUser(me);
      setFamilies(familyData);
      setContextLoaded(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setContextLoaded(true);
        router.replace('/login');
        return;
      }
      setContextError(
        cause instanceof Error ? cause.message : 'Гэр бүлийн орчныг ачаалж чадсангүй.',
      );
      setContextLoaded(true);
    } finally {
      setContextLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!shouldRenderShell) {
      setContextLoading(false);
      setContextLoaded(false);
      setContextError('');
      setUser(null);
      setFamilies([]);
      setFamilyId('');
      setMobileOpen(false);
      setAccountOpen(false);
      return;
    }

    if (contextLoaded || contextLoading) return;
    void retryContext();
  }, [contextLoaded, contextLoading, retryContext, shouldRenderShell]);

  useEffect(() => {
    if (!shouldRenderShell || contextLoading) return;
    if (!families.length) {
      setFamilyId('');
      return;
    }

    if (requestedFamilyId) {
      const requested = families.find((family) => family.id === requestedFamilyId);
      if (!requested) {
        setFamilyId('');
        setContextError('Сонгосон гэр бүлийн орчинд хандах боломжгүй байна.');
        return;
      }
      setContextError('');
      setFamilyId((current) => (current === requested.id ? current : requested.id));
      return;
    }

    const requested = families[0];
    setContextError('');
    setFamilyId((current) => (current === requested.id ? current : requested.id));
    const params = new URLSearchParams(searchParams.toString());
    params.set('family', requested.id);
    router.replace(pathname + '?' + params.toString());
  }, [contextLoading, families, pathname, requestedFamilyId, router, searchParams, shouldRenderShell]);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        window.setTimeout(() => menuButtonRef.current?.focus(), 0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    window.setTimeout(() => firstNavRef.current?.focus(), 0);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!accountOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountOpen]);

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setContextError('');
    try {
      await api<void>('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch (cause) {
      setLogoutBusy(false);
      setContextError(
        cause instanceof Error ? cause.message : 'Гарах үед алдаа гарлаа.',
      );
    }
  }

  function switchFamily(nextId: string) {
    if (!families.some((family) => family.id === nextId)) return;
    setFamilyId(nextId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('family', nextId);
    router.replace(pathname + '?' + params.toString());
  }

  if (!shouldRenderShell) {
    return <>{children}</>;
  }

  const active = activeKey(pathname);

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <button
          ref={menuButtonRef}
          type="button"
          className="app-shell__menu-button"
          aria-label={mobileOpen ? 'Навигаци хаах' : 'Навигаци нээх'}
          aria-expanded={mobileOpen}
          aria-controls="app-shell-navigation"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <Link className="app-shell__brand" href={familyHref('/dashboard', currentFamily?.id ?? null)}>
          <span className="app-shell__brand-mark" aria-hidden="true">
            <TreeDeciduous size={21} />
          </span>
          <span>
            <strong>ГУУЛИНГИЙНХАН</strong>
            <small>Миний удам · Манай түүх</small>
          </span>
        </Link>

        <div className="app-shell__context" aria-label="Одоогийн гэр бүлийн орчин">
          {contextLoading ? (
            <span className="app-shell__context-skeleton" aria-hidden="true" />
          ) : families.length > 1 ? (
            <>
              <label htmlFor="app-shell-family">Гэр бүл</label>
              <select
                id="app-shell-family"
                value={currentFamily?.id ?? ''}
                onChange={(event) => switchFamily(event.target.value)}
                aria-label="Гэр бүлийн орчин сонгох"
              >
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </select>
            </>
          ) : currentFamily ? (
            <span className="app-shell__context-pill">
              <TreeDeciduous size={14} aria-hidden="true" />
              <strong>{currentFamily.name}</strong>
              <small>{currentFamily.role}</small>
            </span>
          ) : (
            <Link className="app-shell__context-empty" href="/families">
              Гэр бүлүүд
            </Link>
          )}
        </div>

        <div className="app-shell__account" ref={accountRef}>
          <button
            type="button"
            className="app-shell__account-button"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((value) => !value)}
          >
            <span className="app-shell__avatar" aria-hidden="true">
              {(user?.display_name?.trim().slice(0, 1) || '?').toUpperCase()}
            </span>
            <span className="app-shell__account-name">{user?.display_name || 'Хэрэглэгч'}</span>
          </button>

          {accountOpen && (
            <div className="app-shell__account-menu" role="menu" aria-label="Хэрэглэгчийн цэс">
              <div className="app-shell__account-heading">
                <strong>{user?.display_name || 'Хэрэглэгч'}</strong>
                <small>Таны account</small>
              </div>
              {user?.person_id && currentFamily ? (
                <Link
                  role="menuitem"
                  href={'/profile?family=' + encodeURIComponent(currentFamily.id) + '&person=' + encodeURIComponent(user.person_id)}
                  onClick={() => setAccountOpen(false)}
                >
                  Миний профайл
                </Link>
              ) : null}
              <Link role="menuitem" href="/families" onClick={() => setAccountOpen(false)}>
                Гэр бүлүүд
              </Link>
              <Link
                role="menuitem"
                href={familyHref('/settings', currentFamily?.id ?? null)}
                onClick={() => setAccountOpen(false)}
              >
                Тохиргоо
              </Link>
              <button
                type="button"
                role="menuitem"
                className="app-shell__account-menu-button"
                disabled={logoutBusy}
                onClick={() => void logout()}
              >
                <LogOut size={14} aria-hidden="true" />
                {logoutBusy ? 'Гарч байна…' : 'Гарах'}
              </button>
            </div>
          )}
        </div>
      </header>

      {contextError && (
        <div className="app-shell__context-alert" role="alert">
          <span>{contextError}</span>
          <button type="button" onClick={() => void retryContext()} disabled={contextLoading}>
            {contextLoading ? 'Шалгаж байна…' : 'Дахин оролдох'}
          </button>
        </div>
      )}

      <div className="app-shell__body">
        <button
          type="button"
          className={'app-shell__overlay ' + (mobileOpen ? 'is-open' : '')}
          aria-label="Навигацийг хаах"
          tabIndex={mobileOpen ? 0 : -1}
          onClick={() => setMobileOpen(false)}
        />

        <aside
          id="app-shell-navigation"
          className={'app-shell__sidebar ' + (mobileOpen ? 'is-open' : '')}
          aria-label="Authenticated application navigation"
        >
          <div className="app-shell__sidebar-inner">
            <nav aria-label="Үндсэн навигаци">
              {NAV_ITEMS.map((item, index) => {
                const Icon = item.icon;
                const itemActive = active === item.key;
                const disabled = item.needsFamily && !currentFamily;

                if (disabled) {
                  return (
                    <span
                      key={item.key}
                      className="app-shell__nav-link is-disabled"
                      aria-disabled="true"
                      title="Гэр бүлийн орчин сонгогдоогүй байна."
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                    </span>
                  );
                }

                const href = item.key === 'settings'
                  ? familyHref(item.path, currentFamily?.id ?? null)
                  : item.key === 'dashboard'
                    ? familyHref(item.path, currentFamily?.id ?? null)
                    : familyHref(item.path, currentFamily?.id ?? null);

                return (
                  <Link
                    ref={index === 0 ? firstNavRef : undefined}
                    key={item.key}
                    className={'app-shell__nav-link ' + (itemActive ? 'is-active' : '')}
                    href={href}
                    aria-current={itemActive ? 'page' : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="app-shell__sidebar-footer">
              <p>Өнгөрсөн түүхээ танин мэдэж, өнөөдрийн дурсамжаа ирээдүйд өвлүүлэн үлдээе.</p>
              <Link href={familyHref('/families', null)} onClick={() => setMobileOpen(false)}>
                Гэр бүлүүд →
              </Link>
            </div>
          </div>
        </aside>

        <div className="app-shell__content">
          {!families.length && !contextLoading ? (
            <div className="app-shell__no-family" role="status">
              <Users size={18} aria-hidden="true" />
              <span>Танд одоогоор харагдах family context алга.</span>
              <Link href="/families">Гэр бүлүүдийг шалгах →</Link>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
