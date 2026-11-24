'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Globe2, Mail, Phone, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import PhoneVerification from '../../../components/phone-verification';
import { ApiError, api } from '../../../lib/api';

type Identity = { id: string; provider: string; display_identifier: string | null; verified: boolean; created_at: string };

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 404) return 'Мэдээлэл олдсонгүй.';
    if (cause.status === 409) return 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}
function providerLabel(provider: string) {
  if (provider === 'email') return 'Имэйл';
  if (provider === 'phone') return 'Утас';
  if (provider === 'google') return 'Google';
  return provider;
}

function AccountSecurityContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyId = searchParams.get('family')?.trim() ?? '';
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationSequence = useRef(0);

  const load = async () => {
    const requestId = ++loadSequence.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const [identityData, googleConfig] = await Promise.all([
        api<Identity[]>('/auth/me/identities', { signal: controller.signal }),
        api<{ enabled: boolean }>('/auth/google/config', { signal: controller.signal }),
      ]);
      if (requestId !== loadSequence.current || controller.signal.aborted) return;
      setIdentities(identityData);
      setGoogleEnabled(googleConfig.enabled);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== loadSequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) { router.replace('/login'); return; }
      setError(friendlyError(cause, 'Аюулгүй байдлын мэдээллийг ачаалж чадсангүй.'));
    } finally {
      if (requestId === loadSequence.current && !controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
      mutationSequence.current += 1;
      loadAbortRef.current?.abort();
    };
  }, [router]);

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ message: string }>('/auth/me/email/request', { method: 'POST',
        body: JSON.stringify({ email: values.get('email'), current_password: values.get('current_password') }) });
      form.reset(); setNotice(result.message);
    } catch (cause) { setError(friendlyError(cause, 'Имэйл солих хүсэлт илгээж чадсангүй.')); }
    finally { setBusy(false); }
  }

  async function requestEmailVerification() {
    const email = identities.find((item) => item.provider === 'email')?.display_identifier;
    if (!email || busy) return;
    const mutationId = ++mutationSequence.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ message: string }>('/auth/email/verification/request', { method: 'POST', body: JSON.stringify({ email }) });
      if (mutationId !== mutationSequence.current) return;
      setNotice(result.message);
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setError(friendlyError(cause, 'Баталгаажуулах холбоос илгээж чадсангүй.'));
    } finally {
      if (mutationId === mutationSequence.current) setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (values.get('password') !== values.get('confirm')) { setError('Нууц үг таарахгүй байна.'); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/me/password', { method: 'POST', body: JSON.stringify({ current_password: values.get('current_password'), new_password: values.get('password') }) });
      router.replace('/login');
    } catch (cause) { setError(friendlyError(cause, 'Нууц үг шинэчилж чадсангүй.')); }
    finally { setBusy(false); }
  }

  const email = identities.find((item) => item.provider === 'email') ?? null;
  const phoneIdentity = identities.find((item) => item.provider === 'phone') ?? null;
  const google = identities.find((item) => item.provider === 'google' && item.verified) ?? null;

  if (loading) return <main className="settings-page"><div className="settings-shell settings-loading"><div className="settings-skeleton" aria-busy="true" aria-live="polite"><span className="settings-skeleton__line settings-skeleton__line--small" /><span className="settings-skeleton__line settings-skeleton__line--title" /><span className="settings-skeleton__line" /><div className="settings-skeleton__grid"><span /><span /></div><small>Аюулгүй байдлын тохиргоог ачаалж байна…</small></div></div></main>;
  if (error && !identities.length) return <main className="settings-page"><section className="settings-shell settings-state-wrap"><div className="settings-state" role="alert"><RefreshCw size={22} /><p className="settings-eyebrow">SECURITY</p><h1>Аюулгүй байдлын мэдээлэл ачаалж чадсангүй</h1><p>{error}</p><button className="settings-button settings-button--dark" type="button" onClick={() => void load()}>Дахин оролдох</button></div></section></main>;

  return <main className="settings-page"><div className="settings-shell">
    <header className="settings-header"><div><Link className="settings-back" href={familyId ? '/settings?family=' + encodeURIComponent(familyId) : '/settings'}>← Тохиргоо</Link><p className="settings-eyebrow">БҮРТГЭЛ · АЮУЛГҮЙ БАЙДАЛ</p><h1>Нэвтрэх ба аюулгүй байдал</h1><p className="settings-intro">Нэвтрэх мэдээлэл, утасны баталгаажуулалт болон нууц үгээ удирдана.</p></div><div className="settings-mark" aria-hidden="true"><ShieldCheck size={52} strokeWidth={1.05} /></div></header>
    {error && <div className="settings-alert settings-alert--error" role="alert">{error}</div>}
    {notice && <div className="settings-alert settings-alert--success" role="status" aria-live="polite"><Check size={16} /><span>{notice}</span></div>}
    <div className="settings-layout"><aside className="settings-index" aria-label="Аюулгүй байдлын хэсгүүд"><a href="#methods">Нэвтрэх аргууд</a><a href="#verification">Баталгаажуулалт</a><a href="#password">Нууц үг</a></aside><div className="settings-content">
      <section id="methods" className="settings-section" aria-labelledby="security-methods-title"><div className="settings-section__head"><div className="settings-section__icon"><UserRound size={18} /></div><div><p className="settings-eyebrow">НЭВТРЭХ АРГУУД</p><h2 id="security-methods-title">Нэвтрэх аргууд</h2><p>Таны бүртгэлд холбогдсон нэвтрэх аргууд.</p></div></div><div className="settings-security-summary">{identities.length ? identities.map((identity) => <div key={identity.id} className="settings-mini-card"><span className="settings-mini-card__icon">{identity.provider === 'email' ? <Mail size={15} /> : identity.provider === 'phone' ? <Phone size={15} /> : <Globe2 size={15} />}</span><span><strong>{providerLabel(identity.provider)}</strong><small>{identity.display_identifier || 'Холбогдсон'}</small></span><span className={'settings-status settings-status--' + (identity.verified ? 'verified' : 'pending')}>{identity.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}</span></div>) : <div className="settings-empty"><strong>Холбогдсон identity алга.</strong><span>Account-ийн одоогийн authentication contract-оос мэдээлэл ирсэнгүй.</span></div>}</div></section>
      <section id="verification" className="settings-section" aria-labelledby="security-verification-title"><div className="settings-section__head"><div className="settings-section__icon"><ShieldCheck size={18} /></div><div><p className="settings-eyebrow">БАТАЛГАА</p><h2 id="security-verification-title">Баталгаажуулалт</h2><p>Verification status нь backend-ийн reported state-ийг л дагана.</p></div></div><div className="settings-stack">
        <article className="settings-card settings-action-card"><div className="settings-action-copy"><div className="settings-action-title"><Mail size={17} /><div><strong>Имэйл</strong><span>{email?.display_identifier || 'Имэйл холбогдоогүй'}</span></div></div><p>{email?.verified ? 'Имэйл баталгаажсан байна.' : email ? 'Баталгаажуулах холбоосыг existing verification flow-оор дахин хүсэж болно.' : 'Account-д имэйл identity алга.'}</p></div>{email?.verified ? <span className="settings-status settings-status--verified"><Check size={13} /> Баталгаажсан</span> : email ? <button className="settings-button settings-button--light" type="button" disabled={busy} onClick={() => void requestEmailVerification()}>{busy ? 'Илгээж байна…' : 'Холбоос дахин илгээх'}</button> : <span className="settings-status settings-status--pending">Боломжгүй</span>}</article>
        <article className="settings-card settings-phone-card"><div className="settings-action-title"><Phone size={17} /><h3>Утасны дугаар</h3></div>
          <p>{phoneIdentity?.display_identifier || 'Утас холбогдоогүй'} · {phoneIdentity?.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}</p>
          <p>Шинэ дугаар баталгаажсаны дараа хуучин дугаар солигдоно. Нэвтрэхэд SMS шаардахгүй.</p>
          <PhoneVerification purpose="account" currentPhone={phoneIdentity?.verified ? '' : phoneIdentity?.display_identifier ?? ''} onVerified={() => { void load(); setNotice('Утасны дугаар баталгаажиж хадгалагдлаа.'); }} />
        </article>
        <article className="settings-card settings-action-card"><div className="settings-action-copy"><div className="settings-action-title"><Globe2 size={17} /><div><strong>Google аккаунт</strong><span>{google?.display_identifier || 'Холбогдоогүй'}</span></div></div><p>Үйлчилгээ идэвхтэй үед Google аккаунтаа холбож болно.</p></div>{google ? <span className="settings-status settings-status--verified"><Check size={13} /> Холбогдсон</span> : googleEnabled && apiBase ? <form method="post" action={apiBase + '/auth/me/google/start'}><button className="settings-button settings-button--light" type="submit">Google account холбох</button></form> : <span className="settings-status settings-status--pending">{googleEnabled ? 'Тохиргоо дутуу' : 'Одоогоор боломжгүй'}</span>}</article>
      </div></section>
      <section className="settings-section" aria-labelledby="security-email-title">
        <h2 id="security-email-title">Имэйл холбох эсвэл солих</h2>
        <p>Шинэ хаягаа баталгаажуулсны дараа имэйл солигдож, бүх төхөөрөмжөөс гарна.</p>
        <form className="settings-inline-form" onSubmit={changeEmail}>
          <label htmlFor="security-new-email">Шинэ имэйл</label><input id="security-new-email" name="email" type="email" autoComplete="email" maxLength={320} required />
          <label htmlFor="security-email-password">Одоогийн нууц үг</label><input id="security-email-password" name="current_password" type="password" autoComplete="current-password" maxLength={128} />
          <button className="settings-button settings-button--dark" disabled={busy}>Баталгаажуулах холбоос илгээх</button>
        </form>
      </section>
      <section id="password" className="settings-section" aria-labelledby="security-password-title">
        <h2 id="security-password-title">Нууц үг өөрчлөх</h2>
        <p>Нууц үг шинэчлэгдсэний дараа бүх төхөөрөмжөөс гарна. Шинээр нэвтэрнэ үү.</p>
        <form className="settings-inline-form" onSubmit={changePassword}>
          <label htmlFor="security-current-password">Одоогийн нууц үг</label><input id="security-current-password" name="current_password" type="password" autoComplete="current-password" maxLength={128} />
          <label htmlFor="security-new-password">Шинэ нууц үг</label><input id="security-new-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          <label htmlFor="security-password-confirm">Нууц үгээ давтах</label><input id="security-password-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
          <button className="settings-button settings-button--dark" disabled={busy}>Нууц үг шинэчлэх</button>
        </form>
        <Link className="settings-action-link" href="/password-reset">Нууц үг сэргээх →</Link>
      </section>
    </div></div>
  </div></main>;
}

export default function AccountSecurityPage() {
  return <Suspense fallback={<main className="settings-page"><div className="settings-shell settings-loading"><div className="settings-skeleton" aria-busy="true"><small>Аюулгүй байдлын тохиргоог ачаалж байна…</small></div></div></main>}><AccountSecurityContent /></Suspense>;
}
