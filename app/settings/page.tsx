'use client';

import AccountPhoto from '../../components/account-photo';
import PhoneVerification from '../../components/phone-verification';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Check, Globe2, LogOut, Mail, Phone, RefreshCw, ShieldCheck, TreeDeciduous, UserRound, UsersRound } from 'lucide-react';
import { API_BASE, ApiError, api, Family, User } from '../../lib/api';
import RootConnectionCard from '../../components/root-connection-card';

type Identity = {
  id: string;
  provider: string;
  display_identifier: string | null;
  verified: boolean;
  created_at: string;
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
        setError('Энэ Family ID таны authorized family context-д байхгүй байна.');
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

  async function logout() {
    if (logoutBusy) return;
    const mutationId = ++mutationSequence.current;
    loadSequence.current += 1;
    identitySequence.current += 1;
    loadAbortRef.current?.abort();
    identityAbortRef.current?.abort();
    setLogoutBusy(true);
    setNotice(null);
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
  const phoneIdentity = identities.find((item) => item.provider === 'phone');
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
    return <main className="settings-page"><section className="settings-shell settings-state-wrap"><div className="settings-state" role="alert"><AlertCircle size={24} /><p className="settings-eyebrow">FAMILY CONTEXT</p><h1>Гэр бүл олдсонгүй</h1><p>Энэ Family ID таны эрхтэй гэр бүлүүдийн жагсаалтад байхгүй байна.</p><button className="settings-button settings-button--dark" type="button" onClick={() => router.replace('/settings')}>Гэр бүлийн тохиргоо руу буцах</button></div></section></main>;
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
              Өөрийн бүртгэл, нэвтрэх аргууд болон одоогийн гэр бүлийн орчноо эндээс шалгана.
              Зөвхөн танд хандах эрхтэй мэдээлэл харагдана.
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
            <a href="#account">Бүртгэл</a>
            <a href="#family">Гэр бүл ба удам</a>
            <a href="#privacy">Нууцлал</a>
            <a href="#security">Аюулгүй байдал</a>
            <a href="#signout">Гарах</a>
          </aside>

          <div className="settings-content">
            <section id="account" className="settings-section" aria-labelledby="settings-account-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><UserRound size={18} /></div>
                <div>
                  <p className="settings-eyebrow">БҮРТГЭЛ</p>
                  <h2 id="settings-account-title">Таны бүртгэл</h2>
                  <p>Таны бүртгэл болон баталгаажсан нэвтрэх аргууд.</p>
                </div>
              </div>

              <div className="settings-card settings-account-card">
                <div className="settings-profile-mark" aria-hidden="true">
                  {(user?.display_name?.trim().slice(0, 1) || '?').toUpperCase()}
                </div>
                <div>
                  <dl className="settings-facts">
                    <div><dt>Дэлгэцийн нэр</dt><dd>{user?.display_name || 'Тодорхойгүй'}</dd></div>
                    <div><dt>Имэйл</dt><dd>{user?.email || 'Имэйл холбогдоогүй'}</dd></div>
                    <div><dt>Бүртгэлийн ID</dt><dd className="settings-mono">{user?.id}</dd></div>
                  </dl>
                  <form className="settings-inline-form" onSubmit={saveDisplayName}>
                    <label htmlFor="account-display-name">Дэлгэцийн нэрээ засах</label>
                    <input id="account-display-name" name="display_name" defaultValue={user?.display_name ?? ''} maxLength={120} required disabled={accountBusy} />
                    <button className="settings-button settings-button--dark" type="submit" disabled={accountBusy}>{accountBusy ? 'Хадгалж байна…' : 'Нэр хадгалах'}</button>
                  </form>
                  {user?.person_id && selectedFamily ? (
                    <Link className="settings-button settings-button--light" href={'/profile?family=' + encodeURIComponent(selectedFamily.id) + '&person=' + encodeURIComponent(user.person_id)}>
                      Удам дахь миний профайлыг харах
                    </Link>
                  ) : null}
                  <p className="settings-note">
                    Имэйл солиход тусдаа баталгаажуулалт шаардлагатай. Хүний профайл зураг өөрийн зөвшөөрлөөр тусад нь хадгалагдана.
                  </p>
                </div>
              </div>

              <div className="settings-security-summary" aria-label="Холбогдсон нэвтрэх аргууд">
                <AccountPhoto hasPhoto={Boolean(user?.profile_photo_url)} onChanged={() => { void api<User>('/auth/me').then(setUser).catch(() => setNotice({ kind: 'error', text: 'Профайлын мэдээллийг шинэчилж чадсангүй.' })); }} />
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
                  <p className="settings-eyebrow">ГЭР БҮЛИЙН УДАМ</p>
                  <h2 id="settings-family-title">Гэр бүл ба удам</h2>
                  <p>Таны гишүүнчлэлтэй гэр бүл, удмын модонд очих холбоос.</p>
                </div>
              </div>

              <div className="settings-card">
                {families.length === 0 ? (
                  <div className="settings-empty">
                    <strong>Одоогоор харагдах гэр бүл алга.</strong>
                    <span>Одоо байгаа удмын орчинд орохын тулд гэр бүлийн урилга хүлээн авна уу.</span>
                    <Link className="settings-button settings-button--light" href="/invite">Урилга хүлээн авах</Link>
                  </div>
                ) : families.length === 1 ? (
                  <div className="settings-family-single">
                    <span className="settings-family-single__name">{families[0].name}</span>
                    <span className="settings-family-badge">{families[0].role}</span>
                    <p className="settings-help">
                      Таны хандах эрхтэй гэр бүл энэ байна.
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
                      Гэр бүл солиход таны гишүүнчлэл сервер талд шалгагдана.
                    </p>
                    {selectedFamily && (
                      <div className="settings-family-meta">
                        <span className="settings-family-badge">{selectedFamily.role}</span>
                        <span>{selectedFamily.description || 'Гэр бүлийн хувийн орон зай.'}</span>
                        <Link className="settings-button settings-button--light" href={'/families?family=' + encodeURIComponent(selectedFamily.id)}>
                          Гэр бүлийн гишүүдийг харах →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
                {selectedFamily && <div className="settings-lineage-links"><div><strong>Удмын мод</strong><p>{user?.person_id ? 'Таны профайл удмын хүнтэй холбогдсон.' : 'Таны бүртгэл удмын хүнтэй хараахан холбогдоогүй.'}</p></div><Link className="settings-button settings-button--light" href={'/tree?family=' + encodeURIComponent(selectedFamily.id)}>Бүх удмыг харах →</Link></div>}
              </div>
            </section>

            {selectedFamily && <RootConnectionCard familyId={selectedFamily.id} />}

            <section id="privacy" className="settings-section" aria-labelledby="settings-privacy-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><ShieldCheck size={18} /></div>
                <div><p className="settings-eyebrow">НУУЦЛАЛ</p><h2 id="settings-privacy-title">Профайл ба гэр бүлийн мэдээлэл</h2><p>Хувийн удам зөвшөөрөгдсөн гэр бүлийн гишүүдэд харагдана.</p></div>
              </div>
              <div className="settings-card settings-privacy-card">
                {user?.person_id && selectedFamily ? <>
                  <div><strong>Өөрийн профайлын харагдац</strong><p>Харагдах хүрээг өөрийн хүний профайл дээр засна. Серверийн зөвшөөрөл үйлдэл бүрд шалгагдана.</p></div>
                  <Link className="settings-button settings-button--light" href={'/profile?family=' + encodeURIComponent(selectedFamily.id) + '&person=' + encodeURIComponent(user.person_id)}>Профайлын нууцлалыг тохируулах</Link>
                </> : <>
                  <div><strong>Өөрийгөө удмын хүнтэй холбох</strong><p>Нэрээр таамаглан автоматаар холбохгүй. Гэр бүлийн эзэн хүсэлтийг шалгаж батална.</p></div>
                  <Link className="settings-button settings-button--light" href={selectedFamily ? '/tree?family=' + encodeURIComponent(selectedFamily.id) : '/families'}>Удам дотроос өөрийгөө олох</Link>
                </>}
              </div>
            </section>

            <section id="security" className="settings-section" aria-labelledby="settings-security-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><ShieldCheck size={18} /></div>
                <div>
                  <p className="settings-eyebrow">АЮУЛГҮЙ БАЙДАЛ</p>
                  <h2 id="settings-security-title">Нэвтрэх ба аюулгүй байдал</h2>
                  <p>Одоо ашиглаж буй баталгаажуулалт болон нэвтрэх аргууд.</p>
                </div>
              </div>

              <div className="settings-stack">
                <article className="settings-card settings-action-card">
                  <div className="settings-action-copy">
                    <div className="settings-action-title"><Mail size={17} /><div><strong>Имэйл баталгаажуулалт</strong><span>{emailIdentity?.display_identifier || 'Имэйл холбогдоогүй'}</span></div></div>
                    <p>{emailIdentity?.verified ? 'Энэ account-ийн имэйл баталгаажсан байна.' : 'Баталгаажаагүй бол existing verification endpoint-оор шинэ холбоос хүсэж болно.'}</p>
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

                <article className="settings-card settings-phone-card">
                  <div className="settings-action-title"><Phone size={17} /><h3>Утасны дугаар</h3></div>
                  <p>{phoneIdentity?.display_identifier || 'Утас холбогдоогүй'} · {phoneIdentity?.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}</p>
                  <p>Шинэ дугаар баталгаажсаны дараа хуучин дугаар солигдоно. Нэвтрэхэд SMS шаардахгүй.</p>
                  <PhoneVerification purpose="account" currentPhone={phoneIdentity?.verified ? '' : phoneIdentity?.display_identifier ?? ''} onVerified={() => {
                    void api<Identity[]>('/auth/me/identities').then(setIdentities);
                    setNotice({ kind: 'success', text: 'Утасны дугаар баталгаажиж хадгалагдлаа.' });
                  }} />
                </article>

                <article className="settings-card settings-action-card">
                  <div className="settings-action-copy">
                    <div className="settings-action-title"><Globe2 size={17} /><div><strong>Google account</strong><span>{googleIdentity?.display_identifier || 'Холбогдоогүй'}</span></div></div>
                    <p>Үйлчилгээ идэвхтэй үед Google аккаунтаа холбож болно.</p>
                  </div>
                  {googleIdentity ? (
                    <span className="settings-status settings-status--verified"><Check size={13} /> Холбогдсон</span>
                  ) : googleEnabled && API_BASE ? (
                    <form method="post" action={API_BASE + '/auth/me/google/start'}>
                      <button className="settings-button settings-button--light" type="submit">Google account холбох</button>
                    </form>
                  ) : (
                    <span className="settings-status settings-status--pending">Одоогоор боломжгүй</span>
                  )}
                </article>

                <article className="settings-card settings-limitation-card">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>Нууц үг солих</strong>
                    <p>Одоогийн нууц үгээ баталгаажуулж шинэ нууц үг тохируулна. Шинэчилсний дараа бүх төхөөрөмжөөс гарна.</p>
                    <Link href="/account/security#password">Нууц үг өөрчлөх</Link><Link href="/password-reset">Нууц үг сэргээх</Link>
                  </div>
                </article>
              </div>
            </section>



            <section id="signout" className="settings-section" aria-labelledby="settings-signout-title">
              <div className="settings-section__head">
                <div className="settings-section__icon"><LogOut size={18} /></div>
                <div>
                  <p className="settings-eyebrow">НЭВТРЭЛТ</p>
                  <h2 id="settings-signout-title">Гарах</h2>
                  <p>Энэ төхөөрөмж дээрх нэвтрэлтийг дуусгана.</p>
                </div>
              </div>
              <div className="settings-card settings-logout-card">
                <div>
                  <strong>Энэ device-ээс гарах</strong>
                  <p>Дараа нь бүртгэлтэй имэйл эсвэл утас, нууц үгээрээ дахин нэвтэрнэ.</p>
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
