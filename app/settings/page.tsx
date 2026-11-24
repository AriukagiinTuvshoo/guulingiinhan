'use client';

import AccountPhoto from '../../components/account-photo';
import PhoneVerification from '../../components/phone-verification';
import RootConnectionCard from '../../components/root-connection-card';
import { MongolianOrnamentBand } from '../../components/mongolian-ornament-band';
import { AppTheme, THEME_OPTIONS } from '../../components/theme-picker';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Check,
  Globe2,
  KeyRound,
  LogOut,
  Mail,
  Palette,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { API_BASE, ApiError, api, Family, User } from '../../lib/api';

type Identity = {
  id: string;
  provider: string;
  display_identifier: string | null;
  verified: boolean;
  created_at: string;
};

type Notice = { kind: 'success' | 'error'; text: string };
type SettingsTab = 'account' | 'appearance' | 'family' | 'security';

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 409) return 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFamilyId = searchParams.get('family')?.trim() ?? '';

  const [tab, setTab] = useState<SettingsTab>('account');
  const [activeTheme, setActiveTheme] = useState<AppTheme>('mn');
  const [user, setUser] = useState<User | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const loadSequence = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationSequence = useRef(0);

  const selectedFamily = useMemo(
    () => families.find((family) => family.id === familyId) ?? families[0] ?? null,
    [families, familyId],
  );

  useEffect(() => {
    try {
      const saved = (localStorage.getItem('gth') as AppTheme | null) || 'mn';
      if (THEME_OPTIONS.some((t) => t.id === saved)) setActiveTheme(saved);
    } catch {
      // ignore
    }
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<AppTheme>).detail;
      if (detail) setActiveTheme(detail);
    };
    window.addEventListener('guulin-theme-change', onSync);
    return () => window.removeEventListener('guulin-theme-change', onSync);
  }, []);

  function selectTheme(next: AppTheme) {
    setActiveTheme(next);
    document.documentElement.dataset.th = next;
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : 'light');
    try {
      localStorage.setItem('gth', next);
      localStorage.setItem('guulin-theme', next === 'dark' ? 'dark' : 'light');
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent<AppTheme>('guulin-theme-change', { detail: next }));
    setNotice({ kind: 'success', text: `«${THEME_OPTIONS.find((t) => t.id === next)?.name ?? next}» өнгөний сэдэв идэвхжлээ.` });
  }

  const load = useCallback(async () => {
    const requestId = ++loadSequence.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setError('');
    setNotice(null);
    try {
      const [me, identityData, familyData, googleConfig] = await Promise.all([
        api<User>('/auth/me', { signal: controller.signal }),
        api<Identity[]>('/auth/me/identities', { signal: controller.signal }),
        api<Family[]>('/families', { signal: controller.signal }),
        api<{ enabled: boolean }>('/auth/google/config', { signal: controller.signal }),
      ]);

      if (requestId !== loadSequence.current || controller.signal.aborted) return;
      setUser(me);
      setIdentities(identityData);
      setFamilies(familyData);
      setGoogleEnabled(googleConfig.enabled);

      const resolvedFamily =
        familyData.find((f) => f.id === requestedFamilyId)?.id ?? familyData[0]?.id ?? '';
      setFamilyId(resolvedFamily);
      if (requestedFamilyId && !familyData.some((f) => f.id === requestedFamilyId)) {
        setError('Энэ гэр бүлийн орчинд таны хандах эрх олдсонгүй.');
        return;
      }
    } catch (cause) {
      if (controller.signal.aborted || requestId !== loadSequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Тохиргоог ачаалж чадсангүй.'));
    } finally {
      if (requestId === loadSequence.current && !controller.signal.aborted) setLoading(false);
    }
  }, [requestedFamilyId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountBusy) return;
    const displayName = String(new FormData(event.currentTarget).get('display_name') ?? '').trim();
    if (!displayName) {
      setNotice({ kind: 'error', text: 'Дэлгэцийн нэр шаардлагатай.' });
      return;
    }
    setAccountBusy(true);
    setNotice(null);
    try {
      const updated = await api<User>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName }),
      });
      setUser(updated);
      setNotice({ kind: 'success', text: 'Дэлгэцийн нэр амжилттай хадгалагдлаа.' });
    } catch (cause) {
      setNotice({ kind: 'error', text: friendlyError(cause, 'Дэлгэцийн нэрийг хадгалж чадсангүй.') });
    } finally {
      setAccountBusy(false);
    }
  }

  function switchFamily(nextId: string) {
    if (!families.some((family) => family.id === nextId) || nextId === familyId) return;
    setFamilyId(nextId);
    router.replace('/settings?family=' + encodeURIComponent(nextId));
  }

  async function requestEmailVerification() {
    const email = identities.find((item) => item.provider === 'email')?.display_identifier;
    if (!email || securityBusy) return;
    const mutationId = ++mutationSequence.current;
    setSecurityBusy(true);
    setNotice(null);
    try {
      const result = await api<{ message: string }>('/auth/email/verification/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (mutationId !== mutationSequence.current) return;
      setNotice({ kind: 'success', text: result.message });
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setNotice({ kind: 'error', text: friendlyError(cause, 'Баталгаажуулах холбоос илгээж чадсангүй.') });
    } finally {
      if (mutationId !== mutationSequence.current) return;
      setSecurityBusy(false);
    }
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setNotice(null);
    try {
      await api<void>('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch (cause) {
      setLogoutBusy(false);
      setNotice({ kind: 'error', text: friendlyError(cause, 'Гарах үед алдаа гарлаа.') });
    }
  }

  const emailIdentity = identities.find((item) => item.provider === 'email');
  const phoneIdentity = identities.find((item) => item.provider === 'phone');
  const googleIdentity = identities.find((item) => item.provider === 'google' && item.verified);

  if (loading) {
    return (
      <main className="settings-v2-page">
        <div className="settings-v2-shell">
          <div className="hush-empty">Тохиргоог ачаалж байна…</div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="settings-v2-page">
        <div className="settings-v2-shell">
          <div className="hush-empty" role="alert">
            <AlertCircle size={24} />
            <h2 style={{ marginTop: 8 }}>Тохиргоог ачаалж чадсангүй</h2>
            <p>{error}</p>
            <button type="button" className="dash-tree-showcase__open" onClick={() => void load()}>
              <RefreshCw size={15} /> Дахин оролдох
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="settings-v2-page">
      <div className="settings-v2-shell">
        <header className="settings-v2-header">
          <div>
            <Link
              className="settings-v2-back"
              href={selectedFamily ? '/tree?family=' + encodeURIComponent(selectedFamily.id) : '/tree'}
            >
              ← Удмын мод
            </Link>
            <h1>Тохиргоо</h1>
          </div>
        </header>

        <MongolianOrnamentBand />

        {/* Clean 4-Tab Horizontal Navigation */}
        <nav className="settings-v2-tabs" role="tablist" aria-label="Тохиргооны бүлгүүд">
          {(
            [
              ['account', 'Бүртгэл', UserRound],
              ['appearance', 'Харагдац', Palette],
              ['family', 'Гэр бүл', UsersRound],
              ['security', 'Аюулгүй байдал', ShieldCheck],
            ] as [SettingsTab, string, typeof UserRound][]
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-v2-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {notice && (
          <div
            className={`settings-v2-notice ${notice.kind === 'error' ? 'is-error' : 'is-success'}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.kind === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        {/* TAB 1: ACCOUNT (Comprehensive: Photo + Name + Email + Phone + Google + Password) */}
        {tab === 'account' && (
          <section className="settings-v2-stack" aria-label="Бүртгэлийн мэдээлэл">
            <article className="settings-v2-card settings-v2-profile-card">
              <div className="settings-v2-photo-col">
                <AccountPhoto
                  hasPhoto={Boolean(user?.profile_photo_url)}
                  linkedFamilyId={selectedFamily?.id ?? null}
                  linkedPersonId={user?.person_id ?? null}
                  onChanged={() => {
                    void api<User>('/auth/me')
                      .then(setUser)
                      .catch(() => setNotice({ kind: 'error', text: 'Профайлын зургийг шинэчилж чадсангүй.' }));
                  }}
                />
              </div>

              <div className="settings-v2-form-col">
                <div className="settings-v2-card-head">
                  <h2>{user?.display_name || 'Хэрэглэгч'}</h2>
                </div>

                <form className="settings-v2-name-form" onSubmit={saveDisplayName}>
                  <label htmlFor="account-display-name">Дэлгэцийн нэр</label>
                  <div className="settings-v2-inline-row">
                    <input
                      id="account-display-name"
                      name="display_name"
                      defaultValue={user?.display_name ?? ''}
                      maxLength={120}
                      required
                      disabled={accountBusy}
                    />
                    <button type="submit" className="dash-tree-showcase__open" disabled={accountBusy}>
                      {accountBusy ? 'Хадгалж байна…' : 'Хадгалах'}
                    </button>
                  </div>
                </form>

                <div className="settings-v2-footer-links">
                  {user?.person_id && selectedFamily ? (
                    <Link
                      className="hush-chip-btn"
                      href={'/profile?family=' + encodeURIComponent(selectedFamily.id) + '&person=' + encodeURIComponent(user.person_id)}
                    >
                      Удам дахь миний профайл →
                    </Link>
                  ) : (
                    <Link
                      className="hush-chip-btn"
                      href={selectedFamily ? '/tree?family=' + encodeURIComponent(selectedFamily.id) : '/tree'}
                    >
                      Удмын модноос өөрийгөө холбох →
                    </Link>
                  )}
                </div>
              </div>
            </article>

            <div className="settings-v2-two-col">
              <article className="settings-v2-card">
                <div className="settings-v2-row-between">
                  <div className="settings-v2-icon-title">
                    <Mail size={18} />
                    <div>
                      <h3>Имэйл</h3>
                      <small>{emailIdentity?.display_identifier || user?.email || 'Холбогдоогүй'}</small>
                    </div>
                  </div>
                  {emailIdentity?.verified ? (
                    <span className="settings-v2-badge is-ok"><Check size={13} /> Баталгаажсан</span>
                  ) : emailIdentity ? (
                    <button type="button" className="hush-chip-btn" disabled={securityBusy} onClick={() => void requestEmailVerification()}>
                      {securityBusy ? 'Илгээж байна…' : 'Баталгаажуулах'}
                    </button>
                  ) : null}
                </div>
              </article>

              <article className="settings-v2-card">
                <div className="settings-v2-row-between">
                  <div className="settings-v2-icon-title">
                    <Globe2 size={18} />
                    <div>
                      <h3>Google</h3>
                      <small>{googleIdentity?.display_identifier || 'Холбогдоогүй'}</small>
                    </div>
                  </div>
                  {googleIdentity ? (
                    <span className="settings-v2-badge is-ok"><Check size={13} /> Холбогдсон</span>
                  ) : googleEnabled && API_BASE ? (
                    <form method="post" action={API_BASE + '/auth/me/google/start'}>
                      <button type="submit" className="hush-chip-btn">Холбох</button>
                    </form>
                  ) : (
                    <span className="settings-v2-badge">Холбогдоогүй</span>
                  )}
                </div>
              </article>
            </div>

            <article className="settings-v2-card">
              <div className="settings-v2-icon-title" style={{ marginBottom: 10 }}>
                <Phone size={18} />
                <div>
                  <h3>Утасны дугаар</h3>
                  <small>
                    {phoneIdentity?.display_identifier || 'Бүртгэгдээгүй'}
                    {phoneIdentity?.verified ? ' · Баталгаажсан' : ''}
                  </small>
                </div>
              </div>
              <PhoneVerification
                purpose="account"
                currentPhone={phoneIdentity?.verified ? '' : phoneIdentity?.display_identifier ?? ''}
                onVerified={() => {
                  void api<Identity[]>('/auth/me/identities').then(setIdentities);
                  setNotice({ kind: 'success', text: 'Утасны дугаар хадгалагдлаа.' });
                }}
              />
            </article>
          </section>
        )}

        {/* TAB 2: APPEARANCE (Zero fluff!) */}
        {tab === 'appearance' && (
          <section className="settings-v2-card" aria-label="Харагдац">
            <div className="settings-v2-theme-grid">
              {THEME_OPTIONS.map((opt) => {
                const isSelected = opt.id === activeTheme;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`settings-v2-theme-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => selectTheme(opt.id)}
                  >
                    <div className="settings-v2-theme-preview" style={{ background: opt.bg, borderColor: opt.accent }}>
                      <span className="settings-v2-theme-sb" style={{ background: opt.sb }} />
                      <div className="settings-v2-theme-body">
                        <span className="settings-v2-theme-bar" style={{ background: opt.primary }} />
                        <span className="settings-v2-theme-line" style={{ background: opt.accent }} />
                      </div>
                    </div>
                    <div className="settings-v2-theme-meta">
                      <strong>
                        {opt.name} {isSelected && <Check size={14} />}
                      </strong>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* TAB 3: FAMILY & LINEAGE */}
        {tab === 'family' && (
          <section className="settings-v2-stack" aria-label="Гэр бүл ба удам">
            <article className="settings-v2-card">
              <div className="settings-v2-card-head">
                <h2>Одоогийн гэр бүлийн орчин</h2>
                <p>Таны хандах эрхтэй гэр бүл, нууцлал болон удмын модны тохиргоо.</p>
              </div>

              {families.length === 0 ? (
                <div className="hush-empty">
                  <p>Одоогоор гишүүнчлэлтэй гэр бүл алга.</p>
                  <Link className="dash-tree-showcase__open" href="/invite" style={{ marginTop: 10 }}>
                    Урилга хүлээн авах
                  </Link>
                </div>
              ) : (
                <div className="settings-v2-family-row">
                  {families.length > 1 ? (
                    <label style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Гэр бүл сонгох</span>
                      <select
                        value={selectedFamily?.id ?? ''}
                        onChange={(e) => switchFamily(e.target.value)}
                      >
                        {families.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({f.role})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div>
                      <strong style={{ fontSize: 20, fontFamily: 'var(--font-philosopher), Philosopher, serif' }}>
                        {selectedFamily?.name}
                      </strong>
                      <span className="settings-v2-pill" style={{ marginLeft: 10 }}>
                        {selectedFamily?.role}
                      </span>
                    </div>
                  )}

                  {selectedFamily && (
                    <Link className="dash-tree-showcase__open" href={'/tree?family=' + encodeURIComponent(selectedFamily.id)}>
                      Удмын мод нээх →
                    </Link>
                  )}
                </div>
              )}
            </article>

            {selectedFamily && <RootConnectionCard familyId={selectedFamily.id} />}
          </section>
        )}

        {/* TAB 4: SECURITY & SIGN OUT */}
        {tab === 'security' && (
          <section className="settings-v2-stack" aria-label="Аюулгүй байдал">
            <div className="settings-v2-two-col">
              <article className="settings-v2-card">
                <div className="settings-v2-row-between">
                  <div className="settings-v2-icon-title">
                    <Mail size={18} />
                    <div>
                      <h3>Имэйл баталгаажуулалт</h3>
                      <small>{emailIdentity?.display_identifier || 'Имэйл холбогдоогүй'}</small>
                    </div>
                  </div>
                  {emailIdentity?.verified ? (
                    <span className="settings-v2-badge is-ok"><Check size={13} /> Баталгаажсан</span>
                  ) : emailIdentity ? (
                    <button type="button" className="hush-chip-btn" disabled={securityBusy} onClick={() => void requestEmailVerification()}>
                      {securityBusy ? 'Илгээж байна…' : 'Баталгаажуулах'}
                    </button>
                  ) : null}
                </div>
              </article>

              <article className="settings-v2-card">
                <div className="settings-v2-row-between">
                  <div className="settings-v2-icon-title">
                    <Globe2 size={18} />
                    <div>
                      <h3>Google аккаунт</h3>
                      <small>{googleIdentity?.display_identifier || 'Холбогдоогүй'}</small>
                    </div>
                  </div>
                  {googleIdentity ? (
                    <span className="settings-v2-badge is-ok"><Check size={13} /> Холбогдсон</span>
                  ) : googleEnabled && API_BASE ? (
                    <form method="post" action={API_BASE + '/auth/me/google/start'}>
                      <button type="submit" className="hush-chip-btn">Холбох</button>
                    </form>
                  ) : (
                    <span className="settings-v2-badge">Боломжгүй</span>
                  )}
                </div>
              </article>
            </div>

            <article className="settings-v2-card">
              <div className="settings-v2-icon-title" style={{ marginBottom: 10 }}>
                <Phone size={18} />
                <div>
                  <h3>Утасны дугаар</h3>
                  <small>
                    {phoneIdentity?.display_identifier || 'Утас холбогдоогүй'} ·{' '}
                    {phoneIdentity?.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}
                  </small>
                </div>
              </div>
              <PhoneVerification
                purpose="account"
                currentPhone={phoneIdentity?.verified ? '' : phoneIdentity?.display_identifier ?? ''}
                onVerified={() => {
                  void api<Identity[]>('/auth/me/identities').then(setIdentities);
                  setNotice({ kind: 'success', text: 'Утасны дугаар баталгаажиж хадгалагдлаа.' });
                }}
              />
            </article>

            <div className="settings-v2-two-col">
              <article className="settings-v2-card">
                <div className="settings-v2-icon-title" style={{ marginBottom: 10 }}>
                  <KeyRound size={18} />
                  <div>
                    <h3>Нууц үг солих</h3>
                    <small>Шинэчилсний дараа бүх төхөөрөмжөөс гарна.</small>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link className="hush-chip-btn" href="/account/security#password">Нууц үг өөрчлөх</Link>
                  <Link className="hush-chip-btn" href="/password-reset">Нууц үг сэргээх</Link>
                </div>
              </article>

              <article className="settings-v2-card settings-v2-logout">
                <div className="settings-v2-row-between">
                  <div>
                    <h3>Системээс гарах</h3>
                    <small>Энэ төхөөрөмж дээрх нэвтрэлтийг дуусгана.</small>
                  </div>
                  <button
                    type="button"
                    className="oral-btn oral-btn--stop"
                    disabled={logoutBusy}
                    onClick={() => void logout()}
                  >
                    <LogOut size={15} /> {logoutBusy ? 'Гарч байна…' : 'Гарах'}
                  </button>
                </div>
              </article>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <main className="settings-v2-page">
          <div className="settings-v2-shell">
            <div className="hush-empty">Тохиргоог ачаалж байна…</div>
          </div>
        </main>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
