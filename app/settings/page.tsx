'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Check, Globe2, LogOut, Mail, Phone, RefreshCw, ShieldCheck, TreeDeciduous, UserRound, UsersRound } from 'lucide-react';
import { ApiError, api, Family, User } from '../../lib/api';

type Identity = {
  id: string;
  provider: string;
  display_identifier: string | null;
  verified: boolean;
  created_at: string;
};

type Challenge = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
};

type Notice = { kind: 'success' | 'error'; text: string };

function providerLabel(provider: string) {
  if (provider === 'email') return 'Имэйл';
  if (provider === 'phone') return 'Утас';
  if (provider === 'google') return 'Google';
  return provider;
}

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
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const loadSequence = useRef(0);
  const identitySequence = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const identityAbortRef = useRef<AbortController | null>(null);
  const mutationSequence = useRef(0);

  const selectedFamily = useMemo(
    () => families.find((family) => family.id === familyId) ?? null,
    [families, familyId],
  );

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountBusy) return;
    const displayName = String(new FormData(event.currentTarget).get('display_name') ?? '').trim();
    if (!displayName) { setNotice({ kind: 'error', text: 'Дэлгэцийн нэр шаардлагатай.' }); return; }
    setAccountBusy(true); setNotice(null);
    try {
      const updated = await api<User>('/auth/me', { method: 'PATCH', body: JSON.stringify({ display_name: displayName }) });
      setUser(updated);
      setNotice({ kind: 'success', text: 'Дэлгэцийн нэр хадгалагдлаа.' });
    } catch (cause) {
      setNotice({ kind: 'error', text: friendlyError(cause, 'Дэлгэцийн нэрийг хадгалж чадсангүй.') });
    } finally { setAccountBusy(false); }
  }

  const refreshIdentities = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++identitySequence.current;
    identityAbortRef.current?.abort();
    const controller = signal ? null : new AbortController();
    if (controller) identityAbortRef.current = controller;
    const activeSignal = signal ?? controller!.signal;
    const data = await api<Identity[]>('/auth/me/identities', { signal: activeSignal });
    if (requestId !== identitySequence.current || activeSignal.aborted) return null;
    setIdentities(data);
    return data;
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadSequence.current;
    loadAbortRef.current?.abort();
    identityAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    identitySequence.current += 1;
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

      const requestedFamily = requestedFamilyId;
      const resolvedFamily = familyData.find((family) => family.id === requestedFamily)?.id ?? '';
      setFamilyId(resolvedFamily);
      if (requestedFamily && !resolvedFamily) {
        setError('Энэ гэр бүлийн дугаар таны эрхтэй гэр бүлийн жагсаалтад байхгүй байна.');
        return;
      }
      if (!requestedFamily && resolvedFamily) {
        setFamilyId(resolvedFamily);
        router.replace('/settings?family=' + encodeURIComponent(resolvedFamily));
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

  useEffect(() => {
    if (!challenge || resendSeconds <= 0) return;
    const timer = window.setInterval(
      () => setResendSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [challenge, resendSeconds]);

  function switchFamily(nextId: string) {
    if (!families.some((family) => family.id === nextId) || nextId === familyId) return;
    loadAbortRef.current?.abort();
    identityAbortRef.current?.abort();
    loadSequence.current += 1;
    identitySequence.current += 1;
    mutationSequence.current += 1;
    setFamilyId('');
    setUser(null);
    setIdentities([]);
    setChallenge(null);
    setPhone('');
    setResendSeconds(0);
    setNotice(null);
    setLoading(true);
    setSecurityBusy(false);
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

  async function requestPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedPhone = String(new FormData(event.currentTarget).get('phone') ?? '').trim();
    if (!requestedPhone || securityBusy) return;
    const mutationId = ++mutationSequence.current;
    setSecurityBusy(true);
    setNotice(null);
    try {
      const result = await api<Challenge>('/auth/me/phone/request', {
        method: 'POST',
        body: JSON.stringify({ phone: requestedPhone }),
      });
      if (mutationId !== mutationSequence.current) return;
      setPhone(requestedPhone);
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice({ kind: 'success', text: 'Баталгаажуулах код илгээгдлээ.' });
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setNotice({ kind: 'error', text: friendlyError(cause, 'Код илгээж чадсангүй.') });
    } finally {
      if (mutationId !== mutationSequence.current) return;
      setSecurityBusy(false);
    }
  }

  async function resendPhone() {
    if (!phone || securityBusy || resendSeconds > 0) return;
    const mutationId = ++mutationSequence.current;
    setSecurityBusy(true);
    setNotice(null);
    try {
      const result = await api<Challenge>('/auth/me/phone/request', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      if (mutationId !== mutationSequence.current) return;
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice({ kind: 'success', text: 'Шинэ баталгаажуулах код илгээгдлээ.' });
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setNotice({ kind: 'error', text: friendlyError(cause, 'Код дахин илгээж чадсангүй.') });
    } finally {
      if (mutationId !== mutationSequence.current) return;
      setSecurityBusy(false);
    }
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || securityBusy) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      setNotice({ kind: 'error', text: '6 оронтой кодоо оруулна уу.' });
      return;
    }

    const mutationId = ++mutationSequence.current;
    setSecurityBusy(true);
    setNotice(null);
    try {
      await api<Identity>('/auth/me/phone/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, challenge_id: challenge.challenge_id, code }),
      });
      if (mutationId !== mutationSequence.current) return;
      setChallenge(null);
      setPhone('');
      setResendSeconds(0);
      await refreshIdentities();
      setNotice({ kind: 'success', text: 'Утасны дугаар баталгаажиж, бүртгэлтэй холбогдлоо.' });
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setNotice({ kind: 'error', text: friendlyError(cause, 'Утас баталгаажуулж чадсангүй.') });
    } finally {
      if (mutationId !== mutationSequence.current) return;
      setSecurityBusy(false);
    }
  }

  async function logout() {
    if (logoutBusy) return;
    const mutationId = ++mutationSequence.current;
    loadSequence.current += 1;
    identitySequence.current += 1;
    loadAbortRef.current?.abort();
    identityAbortRef.current?.abort();
    setLogoutBusy(true);
    setNotice(null);
    setChallenge(null);
    setPhone('');
    setResendSeconds(0);
    try {
      await api<void>('/auth/logout', { method: 'POST' });
      if (mutationId !== mutationSequence.current) return;
      setUser(null);
      setIdentities([]);
      setFamilies([]);
      setFamilyId('');
      setLoading(false);
      router.replace('/login');
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setLogoutBusy(false);
      setNotice({ kind: 'error', text: friendlyError(cause, 'Гарах үед алдаа гарлаа.') });
      void load();
    }
  }

  const emailIdentity = identities.find((item) => item.provider === 'email');
  const phoneIdentity = identities.find((item) => item.provider === 'phone' && item.verified);
  const googleIdentity = identities.find((item) => item.provider === 'google' && item.verified);

  if (loading) {
    return (
      <main className="settings-page">
        <div className="settings-shell settings-loading">
          <div className="settings-skeleton" aria-busy="true" aria-live="polite">
            <span className="settings-skeleton__line settings-skeleton__line--small" />
            <span className="settings-skeleton__line settings-skeleton__line--title" />
            <span className="settings-skeleton__line" />
            <div className="settings-skeleton__grid"><span /><span /></div>
            <small>Тохиргоог ачаалж байна…</small>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="settings-page">
        <section className="settings-shell settings-state-wrap">
          <div className="settings-state" role="alert">
            <AlertCircle size={24} />
            <p className="settings-eyebrow">ТОХИРГОО</p>
            <h1>Тохиргоог ачаалж чадсангүй</h1>
            <p>{error}</p>
            <button className="settings-button settings-button--dark" type="button" onClick={() => void load()}>
              <RefreshCw size={15} /> Дахин оролдох
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!familyId && families.length > 0 && requestedFamilyId) {
    return <main className="settings-page"><section className="settings-shell settings-state-wrap"><div className="settings-state" role="alert"><AlertCircle size={24} /><p className="settings-eyebrow">ГЭР БҮЛ</p><h1>Гэр бүл олдсонгүй</h1><p>Энэ гэр бүлийн дугаар таны эрхтэй гэр бүлүүдийн жагсаалтад байхгүй байна.</p><button className="settings-button settings-button--dark" type="button" onClick={() => router.replace('/settings')}>Гэр бүлийн тохиргоо руу буцах</button></div></section></main>;
  }

  return (
    <main className="settings-page">
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <Link
              className="settings-back"
              href={selectedFamily ? '/dashboard?family=' + encodeURIComponent(selectedFamily.id) : '/dashboard'}
            >
              ← Аппын нүүр
            </Link>
            <p className="settings-eyebrow">ХУВИЙН ОРОН ЗАЙ</p>
            <h1>Тохиргоо</h1>
            <p className="settings-intro">
              Бүртгэл, нэвтрэх аргууд болон одоогийн гэр бүлийн орчноо эндээс шалгана.
              Зөвхөн таны бүртгэлд хамаарах мэдээлэл харагдана.
            </p>
          </div>
          <div className="settings-mark" aria-hidden="true"><TreeDeciduous size={52} strokeWidth={1.05} /></div>
        </header>

        {notice && (
          <div className={'settings-alert settings-alert--' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.kind === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className="settings-layout">
          <aside className="settings-index" aria-label="Тохиргооны хэсгүүд">
            <a href="#account">Аккаунт</a>
            <a href="#family">Гэр бүл</a>
            <a href="#privacy">Нууцлал</a>
            <a href="#security">Аюулгүй байдал</a>
            <a href="#signout">Гарах</a>
          </aside>

          <div className="settings-content">
            <section id="account" className="settings-section" aria-labelledby="settings-account-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><UserRound size={18} /></div>
                <div>
                  <p className="settings-eyebrow">ACCOUNT</p>
                  <h2 id="settings-account-title">Таны бүртгэл</h2>
              <p>Таны аккаунт болон баталгаажуулсан нэвтрэх аргын мэдээллийг харуулна.</p>
                </div>
              </div>

              <div className="settings-card settings-account-card">
                <div className="settings-profile-mark" aria-hidden="true">
                  {(user?.display_name?.trim().slice(0, 1) || '?').toUpperCase()}
                </div>
                <div>
                  <dl className="settings-facts">
                    <div><dt>Дэлгэцийн нэр</dt><dd>{user?.display_name || 'Тодорхойгүй'}</dd></div>
                    <div><dt>Имэйл</dt><dd>{user?.email || 'Аккаунтад имэйл холбогдоогүй'}</dd></div>
                    <div><dt>Аккаунтын дугаар</dt><dd className="settings-mono">{user?.id}</dd></div>
                  </dl>
                  <form className="settings-inline-form" onSubmit={saveDisplayName}>
                    <label htmlFor="account-display-name">Дэлгэцийн нэрээ засах</label>
                    <input id="account-display-name" name="display_name" defaultValue={user?.display_name ?? ''} maxLength={120} required disabled={accountBusy} />
                    <button className="settings-button settings-button--dark" type="submit" disabled={accountBusy}>{accountBusy ? 'Хадгалж байна…' : 'Нэр хадгалах'}</button>
                  </form>
                  {user?.person_id && selectedFamily ? (
                    <Link className="settings-button settings-button--light" href={'/profile?family=' + encodeURIComponent(selectedFamily.id) + '&person=' + encodeURIComponent(user.person_id)}>
                      Миний хүний профайлыг харах
                    </Link>
                  ) : null}
                  <p className="settings-note">
                    Имэйл солих баталгаажуулсан урсгал одоогоор байхгүй. Бүртгэлийн зураг нэмэх боломжгүй; хүний профайл зураг тусдаа зөвшөөрөлтэй.
                  </p>
                </div>
              </div>

              <div className="settings-security-summary" aria-label="Холбогдсон нэвтрэх аргууд">
                {identities.map((identity) => (
                  <div key={identity.id} className="settings-mini-card">
                    <span className="settings-mini-card__icon">
                      {identity.provider === 'email' ? <Mail size={15} /> : identity.provider === 'phone' ? <Phone size={15} /> : <Globe2 size={15} />}
                    </span>
                    <span><strong>{providerLabel(identity.provider)}</strong><small>{identity.display_identifier || 'Холбогдсон'}</small></span>
                    <span className={'settings-status settings-status--' + (identity.verified ? 'verified' : 'pending')}>
                      {identity.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section id="family" className="settings-section" aria-labelledby="settings-family-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><UsersRound size={18} /></div>
                <div>
                  <p className="settings-eyebrow">FAMILY CONTEXT</p>
                  <h2 id="settings-family-title">Гэр бүлийн орчин</h2>
              <p>Зөвхөн таны гишүүнээр бүртгэгдсэн гэр бүлүүд энд харагдана.</p>
                </div>
              </div>

              <div className="settings-card">
                {families.length === 0 ? (
                  <div className="settings-empty">
                    <strong>Одоогоор харагдах гэр бүл алга.</strong>
                    <span>Энд зөвхөн таны гишүүнээр бүртгэгдсэн гэр бүлүүд харагдана.</span>
                    <span>Гуулингийнхан удмын модонд нэвтрэх бол гэр бүлийн эзнээс урилга хүснэ үү. Гишүүнчлэлгүйгээр хувийн удам харагдахгүй.</span>
                  </div>
                ) : families.length === 1 ? (
                  <div className="settings-family-single">
                    <span className="settings-family-single__name">{families[0].name}</span>
                    <span className="settings-family-badge">{families[0].role}</span>
                    <p className="settings-help">
                      Танд одоогоор эрхтэй нэг гэр бүлийн орчин байна.
                    </p>
                  </div>
                ) : (
                  <div className="settings-family-form">
                    <label htmlFor="settings-family-select">Одоогийн гэр бүл</label>
                    <select
                      id="settings-family-select"
                      value={selectedFamily?.id ?? ''}
                      onChange={(event) => switchFamily(event.target.value)}
                      aria-describedby="settings-family-help"
                    >
                      {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
                    </select>
                    <p id="settings-family-help" className="settings-help">
                      Хаяг дахь гэр бүлийн дугаар эрх олгохгүй; сервер гишүүнчлэлийг хүсэлт бүрд шалгана.
                    </p>
                    {selectedFamily && (
                      <div className="settings-family-meta">
                        <span className="settings-family-badge">{selectedFamily.role}</span>
                        <span>{selectedFamily.description || 'Гэр бүлийн хувийн орон зай.'}</span>
                        <Link className="settings-button settings-button--light" href={'/families?family=' + encodeURIComponent(selectedFamily.id)}>
                          Гэр бүлийн тохиргоо, гишүүдийг удирдах →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section id="privacy" className="settings-section" aria-labelledby="settings-privacy-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><ShieldCheck size={18} /></div>
                <div>
                  <p className="settings-eyebrow">НУУЦЛАЛ</p>
                  <h2 id="settings-privacy-title">Профайл ба гэр бүлийн мэдээлэл</h2>
                  <p>Хувийн удам зөвхөн зөвшөөрөгдсөн гэр бүлийн гишүүдэд харагдана. Бүртгэлээс гэр бүлийн дугаар сольсон нь эрх нэмэхгүй.</p>
                </div>
              </div>
              <div className="settings-card settings-privacy-card">
                {user?.person_id && selectedFamily ? (
                  <>
                    <div><strong>Өөрийн хүний профайлын харагдац</strong><p>Профайл засах хэсэгт “Зөвхөн би”, “Гэр бүлийнхэн”, эсвэл “Нийтийн” сонголтыг сервер дээр шалгагддаг нууцлалын дүрмээр удирдана.</p></div>
                    <Link className="settings-button settings-button--light" href={'/profile?family=' + encodeURIComponent(selectedFamily.id) + '&person=' + encodeURIComponent(user.person_id)}>Профайлын нууцлалыг тохируулах</Link>
                  </>
                ) : (
                  <>
                    <div><strong>Өөрийгөө одоо байгаа удамтай холбоно уу</strong><p>Хайлтаар хүнээ олж, холбох хүсэлт гаргана. Гэр бүлийн эзэн хэн болохыг тань шалгасны дараа батална. Нэр ижил гэдгээр автоматаар холбохгүй.</p></div>
                    <Link className="settings-button settings-button--light" href={selectedFamily ? '/tree?family=' + encodeURIComponent(selectedFamily.id) : '/families'}>Удам дотроос өөрийгөө олох</Link>
                  </>
                )}
              </div>
              <p className="settings-help">Хуваалцсан зураг болон бусад мэдээллийн харагдацыг тухайн профайл, өгүүллэг, дурсамжийн бодит нууцлалын тохиргоо удирдана. Энд хэрэгжээгүй “бүх өгөгдлийг нуух” тохиргоо нэмээгүй.</p>
            </section>

            <section id="security" className="settings-section" aria-labelledby="settings-security-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><ShieldCheck size={18} /></div>
                <div>
                  <p className="settings-eyebrow">SECURITY</p>
                  <h2 id="settings-security-title">Нэвтрэх ба аюулгүй байдал</h2>
                  <p>Зөвхөн серверт хэрэгжсэн баталгаажуулалт болон нэвтрэх арга холбох үйлдлүүдийг ашиглана.</p>
                </div>
              </div>

              <div className="settings-stack">
                <article className="settings-card settings-action-card">
                  <div className="settings-action-copy">
                    <div className="settings-action-title"><Mail size={17} /><div><strong>Имэйл баталгаажуулалт</strong><span>{emailIdentity?.display_identifier || 'Имэйл холбогдоогүй'}</span></div></div>
                    <p>{emailIdentity?.verified ? 'Энэ бүртгэлийн имэйл баталгаажсан байна.' : 'Баталгаажаагүй бол шинэ баталгаажуулах холбоос хүсэж болно.'}</p>
                  </div>
                  {emailIdentity?.verified ? (
                    <span className="settings-status settings-status--verified"><Check size={13} /> Баталгаажсан</span>
                  ) : emailIdentity ? (
                    <button className="settings-button settings-button--light" type="button" disabled={securityBusy} onClick={() => void requestEmailVerification()}>
                      {securityBusy ? 'Илгээж байна…' : 'Холбоос дахин илгээх'}
                    </button>
                  ) : (
                    <span className="settings-status settings-status--pending">Имэйл холбогдоогүй</span>
                  )}
                </article>

                <article className="settings-card settings-action-card">
                  <div className="settings-action-copy">
                    <div className="settings-action-title"><Phone size={17} /><div><strong>Утасны дугаар</strong><span>{phoneIdentity?.display_identifier || 'Холбогдоогүй'}</span></div></div>
                    <p>{phoneIdentity ? 'Баталгаажсан утас энэ бүртгэлтэй холбогдсон байна.' : 'Утас холбохдоо нэг удаагийн кодоор баталгаажуулна.'}</p>
                  </div>

                  {phoneIdentity ? (
                    <span className="settings-status settings-status--verified"><Check size={13} /> Холбогдсон</span>
                  ) : !challenge ? (
                    <form className="settings-inline-form" onSubmit={requestPhone}>
                      <label htmlFor="settings-phone">Утасны дугаар</label>
                      <input id="settings-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+976 99112233" maxLength={20} required disabled={securityBusy} aria-describedby="settings-phone-help" />
                      <span id="settings-phone-help" className="settings-help">+976 99112233 эсвэл 99112233.</span>
                      <button className="settings-button settings-button--dark" type="submit" disabled={securityBusy}>{securityBusy ? 'Илгээж байна…' : 'Код авах'}</button>
                    </form>
                  ) : (
                    <form className="settings-inline-form" onSubmit={verifyPhone}>
                      <div className="settings-otp-summary"><span>Код илгээсэн дугаар</span><strong>{phone}</strong></div>
                      <label htmlFor="settings-phone-code">Баталгаажуулах код</label>
                      <input id="settings-phone-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={securityBusy} aria-describedby="settings-phone-code-help" />
                      <span id="settings-phone-code-help" className="settings-help">6 оронтой кодоо оруулна уу.</span>
                      <div className="settings-otp-actions">
                        <button className="settings-button settings-button--dark" type="submit" disabled={securityBusy}>{securityBusy ? 'Шалгаж байна…' : 'Баталгаажуулж холбох'}</button>
                        <button className="settings-button settings-button--text" type="button" disabled={securityBusy} onClick={() => { setChallenge(null); setPhone(''); setResendSeconds(0); }}>Болих</button>
                        <button className="settings-button settings-button--text" type="button" disabled={securityBusy || resendSeconds > 0} onClick={() => void resendPhone()}>
                          {resendSeconds > 0 ? 'Дахин код авах · ' + resendSeconds + ' сек' : 'Дахин код авах'}
                        </button>
                      </div>
                    </form>
                  )}
                </article>

                <article className="settings-card settings-action-card">
                  <div className="settings-action-copy">
                    <div className="settings-action-title"><Globe2 size={17} /><div><strong>Google бүртгэл</strong><span>{googleIdentity?.display_identifier || 'Холбогдоогүй'}</span></div></div>
                    <p>Google бүртгэл холбох боломж идэвхтэй бол баталгаажсан нэвтрэх урсгалаар холбоно. Нууц мэдээллийг энэ хуудсанд хадгалахгүй.</p>
                  </div>
                  {googleIdentity ? (
                    <span className="settings-status settings-status--verified"><Check size={13} /> Холбогдсон</span>
                  ) : googleEnabled ? (
                    <form method="post" action={(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1') + '/auth/me/google/start'}>
                      <button className="settings-button settings-button--light" type="submit">Google бүртгэл холбох</button>
                    </form>
                  ) : (
                    <span className="settings-status settings-status--pending">Одоогоор боломжгүй</span>
                  )}
                </article>

                <article className="settings-card settings-limitation-card">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>Нууц үг солих</strong>
                    <p>Нэвтэрсэн үед нууц үг солих тусгай үйлдэл одоогоор байхгүй. Нууц үг сэргээх баталгаажуулсан урсгалыг ашиглана.</p>
                    <Link href="/password-reset">Нууц үг сэргээх</Link>
                  </div>
                </article>
              </div>
            </section>



            <section id="signout" className="settings-section" aria-labelledby="settings-signout-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><LogOut size={18} /></div>
                <div>
                  <p className="settings-eyebrow">SESSION</p>
                  <h2 id="settings-signout-title">Sign out</h2>
                  <p>Энэ хөтөчийн одоогийн нэвтрэлтийг хүчингүй болгоно.</p>
                </div>
              </div>
              <div className="settings-card settings-logout-card">
                <div>
                  <strong>Энэ device-ээс гарах</strong>
                  <p>Амжилттай гарсны дараа Login руу очно. Password, session token, secret дэлгэцэнд гаргахгүй.</p>
                </div>
                <button className="settings-button settings-button--dark" type="button" disabled={logoutBusy} onClick={() => void logout()}>
                  <LogOut size={15} /> {logoutBusy ? 'Гарч байна…' : 'Гарах'}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}


export default function SettingsPage() {
  return <Suspense fallback={<main className="settings-page"><div className="settings-shell settings-loading"><div className="settings-skeleton" aria-busy="true"><small>Тохиргоог ачаалж байна…</small></div></div></main>}><SettingsContent /></Suspense>;
}
