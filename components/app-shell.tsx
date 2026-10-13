'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Bell,
  BookOpen,
  CalendarDays,
  GitFork,
  Globe2,
  Newspaper,
  Home,
  LogOut,
  Menu,
  Settings,
  Search,
  ShieldCheck,
  TreeDeciduous,
  UserRound,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family, User, PersonProfile } from '../lib/api';
import ProfilePhoto from './profile-photo';
import { PHOTO_CHANGED_EVENT, type PhotoChange } from '../lib/image-upload';
import { needsExplicitFamily, resolveFamilyScope } from '../lib/family-scope';
import { FamilyContext } from './family-context';
import { useDialogFocus } from './use-dialog-focus';
import SharedDonationBanner from './shared-donation-banner';
import { InstallAppButton } from './install-app';

type NavItem = {
  key: 'dashboard' | 'community' | 'news' | 'tree' | 'people' | 'stories' | 'memories' | 'archives' | 'activities' | 'settings' | 'search' | 'relationships';
  label: string;
  description: string;
  icon: LucideIcon;
  path: string;
  needsFamily: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Нүүр', description: 'Гэр бүлийн тойм', icon: Home, path: '/', needsFamily: false },
  { key: 'community', label: 'Нийтийн түүх', description: 'Бүх гэр бүлийн нийтлэл', icon: Newspaper, path: '/community', needsFamily: false },
  { key: 'news', label: 'Мэдээ', description: 'Гуулингийнхны мэдэгдэл', icon: Bell, path: '/news', needsFamily: false },
  { key: 'tree', label: 'Удмын мод', description: 'Үндсэн удам · Манай гэр бүл', icon: GitFork, path: '/tree', needsFamily: false },
  { key: 'people', label: 'Гишүүд', description: 'Урилга ба миний бүртгэл', icon: Users, path: '/people', needsFamily: true },
  { key: 'search', label: 'Хайлт', description: 'Гэр бүлийн сангаас хайх', icon: Search, path: '/search', needsFamily: true },
  { key: 'relationships', label: 'Хамаарал', description: 'Хоёр хүний холбооны зам', icon: GitFork, path: '/relationships', needsFamily: true },
  { key: 'stories', label: 'Манай түүх', description: 'Түүх, үйл явдлууд', icon: BookOpen, path: '/stories', needsFamily: true },
  { key: 'memories', label: 'Дурсамж', description: 'Хадгалсан дурсамж', icon: Globe2, path: '/memories', needsFamily: true },
  { key: 'archives', label: 'Архив', description: 'Гэр бүлийн баримт', icon: Archive, path: '/archives', needsFamily: true },
  { key: 'activities', label: 'Сан ба уулзалт', description: 'Хандив, арга хэмжээ', icon: CalendarDays, path: '/activities', needsFamily: true },
  { key: 'settings', label: 'Тохиргоо', description: 'Account ба аюулгүй байдал', icon: Settings, path: '/settings', needsFamily: false },
];

const NAV_GROUPS: { label: string; keys: NavItem['key'][] }[] = [
  { label: 'ТОЙМ', keys: ['dashboard'] },
  { label: 'УДАМ', keys: ['tree', 'people', 'relationships', 'search'] },
  { label: 'ӨВИЙН САН', keys: ['stories', 'memories', 'archives'] },
  { label: 'ГЭР БҮЛ', keys: ['community', 'news', 'activities'] },
  { label: 'АККАУНТ', keys: ['settings'] },
];

function isShellRoute(pathname: string) {
  return (
    pathname === '/search' || pathname === '/relationships' ||
    pathname === '/people' ||
    pathname.startsWith('/people/') ||
    pathname === '/tree' ||
    pathname.startsWith('/tree/') ||
    pathname === '/ancestry' ||
    pathname.startsWith('/ancestry/') ||
    pathname === '/community' ||
    pathname.startsWith('/community/') ||
    pathname === '/news' ||
    pathname === '/stories' ||
    pathname.startsWith('/stories/') ||
    pathname === '/memories' ||
    pathname.startsWith('/memories/') ||
    pathname === '/archives' ||
    pathname.startsWith('/archives/') ||
    pathname === '/activities' ||
    pathname.startsWith('/activities/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/account/security' ||
    pathname === '/profile' ||
    pathname.startsWith('/profile/')
  );
}

function isDashboardRoute(pathname: string) {
  return pathname === '/' || pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}

function activeKey(pathname: string): NavItem['key'] | null {
  if (pathname === '/search') return 'search';
  if (pathname === '/relationships') return 'relationships';
  if (isDashboardRoute(pathname)) return 'dashboard';
  if (pathname === '/tree' || pathname.startsWith('/tree/')) return 'tree';
  if (pathname === '/ancestry' || pathname.startsWith('/ancestry/')) return 'tree';
  if (pathname === '/community' || pathname.startsWith('/community/')) return 'community';
  if (pathname === '/news') return 'news';
  if (pathname === '/people' || pathname.startsWith('/people/')) return 'people';
  if (pathname === '/stories' || pathname.startsWith('/stories/')) return 'stories';
  if (pathname === '/memories' || pathname.startsWith('/memories/')) return 'memories';
  if (pathname === '/archives' || pathname.startsWith('/archives/')) return 'archives';
  if (pathname === '/activities' || pathname.startsWith('/activities/')) return 'activities';
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

export type AppShellContextValue = {
  user: User | null;
  families: Family[];
  familyId: string;
  currentFamily: Family | null;
  contextLoading: boolean;
  contextLoaded: boolean;
  contextError: string;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

type PublishedNotice = { id: string; title: string; body: string };

function playNotificationChime(context: AudioContext) {
  const start = context.currentTime;
  [784, 988].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = start + index * 0.12;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.08, noteStart + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.3);
  });
}

function NotificationBell({ userId, closeSignal, onOpen }: { userId: string; closeSignal: boolean; onOpen(): void }) {
  const [notices, setNotices] = useState<PublishedNotice[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const latestId = useRef<string | null>(null);
  const initialized = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    const context = audioContext.current;
    audioContext.current = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    initialized.current = false;
    latestId.current = null;
    soundEnabledRef.current = false;
    setOpen(false);
    setNotices([]);
    setLoadError(false);
    try {
      const storedRead = window.localStorage.getItem(`announcement-read:${userId}`);
      const parsed = storedRead ? JSON.parse(storedRead) : [];
      setReadIds(new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []));
      setSoundEnabled(window.localStorage.getItem(`announcement-sound:${userId}`) === '1');
      soundEnabledRef.current = window.localStorage.getItem(`announcement-sound:${userId}`) === '1';
    } catch {
      setReadIds(new Set());
      setSoundEnabled(false);
    }

    const load = async () => {
      try {
        const rows = await api<PublishedNotice[]>('/announcements?limit=8');
        if (!active) return;
        const newLatestId = rows[0]?.id ?? null;
        if (initialized.current && newLatestId && newLatestId !== latestId.current && soundEnabledRef.current && audioContext.current) {
          const context = audioContext.current;
          void context.resume().then(() => {
            if (active && audioContext.current === context) playNotificationChime(context);
          }).catch(() => undefined);
        }
        latestId.current = newLatestId;
        initialized.current = true;
        setNotices(rows);
        setLoadError(false);
      } catch {
        if (active) setLoadError(true);
      }
    };

    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => { if (closeSignal) setOpen(false); }, [closeSignal]);
  const unreadCount = notices.filter((notice) => !readIds.has(notice.id)).length;

  function markVisibleRead() {
    const next = new Set([...readIds, ...notices.map((notice) => notice.id)]);
    setReadIds(next);
    try { window.localStorage.setItem(`announcement-read:${userId}`, JSON.stringify([...next].slice(-50))); } catch { /* storage is optional */ }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEnabledRef.current = next;
    try { window.localStorage.setItem(`announcement-sound:${userId}`, next ? '1' : '0'); } catch { /* storage is optional */ }
    if (!next) return;
    try {
      const context = audioContext.current ?? new AudioContext();
      audioContext.current = context;
      void context.resume().then(() => playNotificationChime(context)).catch(() => undefined);
    } catch { /* Web Audio may be unavailable */ }
  }

  return <div className="app-shell__notifications" ref={panelRef}>
    <button
      type="button"
      className="app-shell__notification-button"
      aria-label={unreadCount ? `Мэдэгдэл, уншаагүй ${unreadCount}` : 'Мэдэгдэл'}
      aria-expanded={open}
      aria-controls="app-shell-notification-panel"
      onClick={() => {
        const next = !open;
        setOpen(next);
        if (next) { onOpen(); markVisibleRead(); }
        if (soundEnabledRef.current) {
          try {
            const context = audioContext.current ?? new AudioContext();
            audioContext.current = context;
            void context.resume().catch(() => undefined);
          } catch { /* Web Audio may be unavailable */ }
        }
      }}
    >
      <Bell size={18} aria-hidden="true" />
      {unreadCount > 0 && <span className="app-shell__notification-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
    {open && <section id="app-shell-notification-panel" className="app-shell__notification-panel" role="dialog" aria-label="Мэдэгдлийн төв">
      <header><div><strong>Мэдэгдэл</strong><small>{unreadCount ? `${unreadCount} уншаагүй` : notices.length ? 'Бүх мэдээг уншсан' : 'Шинэ мэдээ алга'}</small></div><button type="button" aria-label={`Хонхны дууг ${soundEnabled ? 'унтраах' : 'асаах'}`} onClick={toggleSound}>{soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}</button><button type="button" aria-label="Мэдэгдлийг хаах" onClick={() => setOpen(false)}><X size={18} /></button></header>
      {loadError && <p className="app-shell__notification-state" role="status">Мэдээг түр ачаалж чадсангүй. <button type="button" onClick={() => window.location.reload()}>Дахин ачаалах</button></p>}
      {!loadError && notices.length === 0 && <p className="app-shell__notification-state">Одоогоор шинэ мэдээ алга.</p>}
      <ul>{notices.map((notice) => <li key={notice.id}>
        <Link href="/news" onClick={() => { markVisibleRead(); setOpen(false); }}>
          <strong>{notice.title}</strong><span>{notice.body}</span>
        </Link>
      </li>)}</ul>
      <Link className="app-shell__notification-all" href="/news" onClick={() => setOpen(false)}>Бүх мэдээ харах →</Link>
    </section>}
  </div>;
}

export function useAppShellContext() {
  const context = useContext(AppShellContext);
  if (!context) throw new Error('useAppShellContext must be used inside AppShell');
  return context;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const shouldRenderShell = isDashboardRoute(pathname) || isShellRoute(pathname);
  const requestedFamilyId = searchParams.get('family') ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextError, setContextError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [familySwitching, setFamilySwitching] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstNavRef = useRef<HTMLAnchorElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const contextRequestRef = useRef(0);
  const scopedFamilyId = contextLoaded && !contextLoading
    ? resolveFamilyScope(families, requestedFamilyId, needsExplicitFamily(pathname, searchParams.has('person'))).id
    : '';

  const currentFamily = useMemo(
    () => families.find((family) => family.id === scopedFamilyId) ?? null,
    [families, scopedFamilyId],
  );

  // The signed-in person's portrait is their visible identity throughout the app.
  // A profile being viewed or edited by an admin must never become their avatar.
  const portraitIdentity = user?.person_id && currentFamily
    ? `/families/${currentFamily.id}/persons/${user.person_id}` : '';
  const portraitScope = `${user?.id ?? ''}:${portraitIdentity}`;
  const [ownPortrait, setOwnPortrait] = useState<{ identity: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!shouldRenderShell || !portraitIdentity) return;
    let active = true;
    let controller: AbortController;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<PersonProfile>(portraitIdentity, { signal })
        .then(person => {
          if (active && !signal.aborted) setOwnPortrait({ identity: portraitScope, url: person.profile_photo_url ?? null });
        })
        .catch(() => {
          if (active && !signal.aborted) setOwnPortrait({ identity: portraitScope, url: null });
        });
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<PhotoChange>).detail;
      if (detail?.endpoint === `${portraitIdentity}/profile-photo`) refresh();
    };
    refresh();
    window.addEventListener(PHOTO_CHANGED_EVENT, changed);
    return () => { active = false; controller?.abort(); window.removeEventListener(PHOTO_CHANGED_EVENT, changed); };
  }, [shouldRenderShell, portraitIdentity, portraitScope]);
  const headerPhoto = ownPortrait?.identity === portraitScope && ownPortrait.url
    ? ownPortrait.url : user?.profile_photo_url;

  const retryContext = useCallback(async () => {
    const requestId = ++contextRequestRef.current;
    setContextLoading(true);
    setContextLoaded(false);
    setContextError('');
    setUser(null);
    setIsGlobalAdmin(false);
    setFamilies([]);
    setFamilyId('');
    try {
      const [me, familyData] = await Promise.all([
        api<User>('/auth/me'),
        api<Family[]>('/families'),
      ]);
      if (requestId !== contextRequestRef.current) return;
      setUser(me);
      setFamilies(familyData);
      setContextLoaded(true);
      void api('/admin/me')
        .then(() => {
          if (requestId === contextRequestRef.current) setIsGlobalAdmin(true);
        })
        .catch(() => {
          if (requestId === contextRequestRef.current) setIsGlobalAdmin(false);
        });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setContextLoaded(true);
        router.replace('/login');
        return;
      }
      if (requestId !== contextRequestRef.current) return;
      setContextError(
        cause instanceof Error ? cause.message : 'Гэр бүлийн орчныг ачаалж чадсангүй.',
      );
      setIsGlobalAdmin(false);
      setContextLoaded(true);
    } finally {
      if (requestId === contextRequestRef.current) setContextLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!shouldRenderShell || !user?.id) return;
    let active = true;
    const refreshPhoto = (event: Event) => {
      if ((event as CustomEvent<{ endpoint?: string }>).detail?.endpoint !== '/auth/me/photo') return;
      void api<User>('/auth/me').then(current => { if (active) setUser(current); }).catch(() => undefined);
    };
    window.addEventListener('guulingiinhan:photo-changed', refreshPhoto);
    return () => { active = false; window.removeEventListener('guulingiinhan:photo-changed', refreshPhoto); };
  }, [shouldRenderShell, user?.id]);

  useEffect(() => {
    if (!shouldRenderShell) {
      setContextLoading(false);
      setContextLoaded(false);
      setContextError('');
      setUser(null);
      setIsGlobalAdmin(false);
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
    // An unresolved session/family list cannot establish a denial. Keep the
    // private scope empty until the authenticated context is available.
    if (!shouldRenderShell || contextLoading || !contextLoaded || !user) return;
    const scope = resolveFamilyScope(families, requestedFamilyId, needsExplicitFamily(pathname, searchParams.has('person')));
    if (!scope.id) {
      setFamilyId('');
      setFamilySwitching(false);
      setContextError(scope.error);
      return;
    }
    const nextFamily = scope.id;
    setContextError('');
    setFamilyId((current) => (current === nextFamily ? current : nextFamily));
    if (requestedFamilyId === nextFamily) setFamilySwitching(false);

    if (
      nextFamily &&
      requestedFamilyId !== nextFamily &&
      pathname !== '/profile' &&
      !pathname.startsWith('/profile/')
    ) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('family', nextFamily);
      router.replace(pathname + '?' + params.toString());
    } else if (nextFamily && requestedFamilyId !== nextFamily && pathname.startsWith('/profile')) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('family', nextFamily);
      router.replace(pathname + '?' + params.toString());
    }
  }, [contextLoaded, contextLoading, families, pathname, requestedFamilyId, router, searchParams, shouldRenderShell, user]);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  useDialogFocus(mobileOpen, '#app-shell-navigation', () => setMobileOpen(false));

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
      contextRequestRef.current += 1;
      setUser(null);
      setFamilies([]);
      setFamilyId('');
      setContextLoaded(false);
      setContextError('');
      setMobileOpen(false);
      setAccountOpen(false);
      router.replace('/login');
    } catch (cause) {
      setLogoutBusy(false);
      setContextError(
        cause instanceof Error ? cause.message : 'Гарах үед алдаа гарлаа.',
      );
    }
  }

  function switchFamily(nextId: string) {
    if (familySwitching || logoutBusy || !families.some((family) => family.id === nextId)) return;
    if (nextId === familyId) return;
    contextRequestRef.current += 1;
    setContextError('');
    setFamilySwitching(true);
    setFamilyId(nextId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('family', nextId);
    router.replace(pathname + '?' + params.toString());
  }

  const shellContext = useMemo<AppShellContextValue>(
    () => ({ user, families, familyId: scopedFamilyId, currentFamily, contextLoading, contextLoaded, contextError }),
    [user, families, scopedFamilyId, currentFamily, contextLoading, contextLoaded, contextError],
  );

  if (!shouldRenderShell) {
    return <>{children}</>;
  }

  const active = activeKey(pathname);

  return (
    <AppShellContext.Provider value={shellContext}>
      <div className={'app-shell' + (pathname === '/tree' ? ' app-shell--tree' : '')}>
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

        <Link className="app-shell__brand" href={familyHref('/', currentFamily?.id ?? null)}>
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
          ) : (families.length > 1 || (families.length > 0 && !currentFamily)) ? (
            <>
              <label htmlFor="app-shell-family">Гэр бүл</label>
              <select
                id="app-shell-family"
                value={currentFamily?.id ?? ''}
                onChange={(event) => switchFamily(event.target.value)}
                aria-label="Гэр бүлийн орчин сонгох"
                aria-busy={familySwitching}
                disabled={contextLoading || familySwitching}
              >
                <option value="">Гэр бүл сонгох</option>
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
          {user && <NotificationBell userId={user.id} closeSignal={accountOpen || mobileOpen} onOpen={() => { setAccountOpen(false); setMobileOpen(false); }} />}
          <button
            type="button"
            className="app-shell__account-button"
            aria-haspopup="menu"
            aria-label="Миний бүртгэлийн цэс"
            aria-expanded={accountOpen}
            onClick={() => { setMobileOpen(false); setAccountOpen((value) => !value); }}
          >
            <ProfilePhoto url={headerPhoto} className="app-shell__avatar" name={user?.display_name || 'Хэрэглэгч'} fallback={(user?.display_name?.trim().slice(0, 1) || '?').toUpperCase()} />
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
              {isGlobalAdmin ? (
                <Link role="menuitem" href="/admin" onClick={() => setAccountOpen(false)}>
                  <ShieldCheck size={14} aria-hidden="true" />
                  Админ удирдлага
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
              <InstallAppButton menuItem />
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

      {user && <SharedDonationBanner userId={user.id} compact={pathname === '/tree'} />}

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
          role={mobileOpen ? 'dialog' : undefined}
          aria-modal={mobileOpen ? true : undefined}
        >
          <div className="app-shell__sidebar-inner">
            {mobileOpen && <button className="app-shell__drawer-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Цэсийг хаах"><X size={20} aria-hidden="true" /></button>}
            <nav aria-label="Үндсэн навигаци">
              {NAV_GROUPS.map((group) => <div className="app-shell__nav-group" key={group.label}>
                <span className="app-shell__nav-group-label">{group.label}</span>
                {group.keys.map((key) => {
                const item = NAV_ITEMS.find((candidate) => candidate.key === key)!;
                const index = NAV_ITEMS.indexOf(item);
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
              </div>)}
            </nav>

            <div className="app-shell__sidebar-footer">
              <p>Өнгөрсөн түүхээ танин мэдэж, өнөөдрийн дурсамжаа ирээдүйд өвлүүлэн үлдээе.</p>
              <Link href={familyHref('/families', null)} onClick={() => setMobileOpen(false)}>
                Гэр бүлүүд →
              </Link>
            </div>
          </div>
        </aside>

        <div className="app-shell__content" aria-busy={contextLoading || familySwitching}>
          {!families.length && !contextLoading ? (
            <div className="app-shell__no-family" role="status">
              <Users size={18} aria-hidden="true" />
              <span>Танд одоогоор харагдах family context алга.</span>
              <Link href="/families">Гэр бүлүүдийг шалгах →</Link>
            </div>
          ) : null}
          <div key={requestedFamilyId || familyId || 'no-family-context'}>
            <FamilyContext.Provider value={{
              family: currentFamily,
              user,
              loading: contextLoading || !contextLoaded || familySwitching,
              error: contextError,
              retry: retryContext,
            }}>
              {children}
            </FamilyContext.Provider>
          </div>
        </div>
      </div>
      </div>
    </AppShellContext.Provider>
  );
}
