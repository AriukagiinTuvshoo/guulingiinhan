'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Globe2, Mail, Phone, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { ApiError, api } from '../../../lib/api';

type Identity = { id: string; provider: string; display_identifier: string | null; verified: boolean; created_at: string };
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

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
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
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

  async function requestPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const requestedPhone = String(new FormData(event.currentTarget).get('phone') ?? '').trim();
    if (!requestedPhone) return;
    const mutationId = ++mutationSequence.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<Challenge>('/auth/me/phone/request', { method: 'POST', body: JSON.stringify({ phone: requestedPhone }) });
      if (mutationId !== mutationSequence.current) return;
      setPhone(requestedPhone); setChallenge(result); setNotice('Баталгаажуулах код илгээгдлээ.');
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setError(friendlyError(cause, 'Код илгээж чадсангүй.'));
    } finally {
      if (mutationId === mutationSequence.current) setBusy(false);
    }
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!/^[0-9]{6}$/.test(code)) { setError('6 оронтой кодоо оруулна уу.'); return; }
    const mutationId = ++mutationSequence.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await api<Identity>('/auth/me/phone/verify', { method: 'POST', body: JSON.stringify({ phone, challenge_id: challenge.challenge_id, code }) });
      if (mutationId !== mutationSequence.current) return;
      setChallenge(null); setPhone('');
      await load();
      if (mutationId !== mutationSequence.current) return;
      setNotice('Утасны дугаар баталгаажиж, энэ account-той холбогдлоо.');
    } catch (cause) {
      if (mutationId !== mutationSequence.current) return;
      setError(friendlyError(cause, 'Утас баталгаажуулж чадсангүй.'));
    } finally {
      if (mutationId === mutationSequence.current) setBusy(false);
    }
  }

  const email = identities.find((item) => item.provider === 'email') ?? null;
  const phoneIdentity = identities.find((item) => item.provider === 'phone' && item.verified) ?? null;
  const google = identities.find((item) => item.provider === 'google' && item.verified) ?? null;

  if (loading) return <main className="settings-page"><div className="settings-shell settings-loading"><div className="settings-skeleton" aria-busy="true" aria-live="polite"><span className="settings-skeleton__line settings-skeleton__line--small" /><span className="settings-skeleton__line settings-skeleton__line--title" /><span className="settings-skeleton__line" /><div className="settings-skeleton__grid"><span /><span /></div><small>Аюулгүй байдлын тохиргоог ачаалж байна…</small></div></div></main>;
  if (error && !identities.length) return <main className="settings-page"><section className="settings-shell settings-state-wrap"><div className="settings-state" role="alert"><RefreshCw size={22} /><p className="settings-eyebrow">SECURITY</p><h1>Аюулгүй байдлын мэдээлэл ачаалж чадсангүй</h1><p>{error}</p><button className="settings-button settings-button--dark" type="button" onClick={() => void load()}>Дахин оролдох</button></div></section></main>;

  return <main className="settings-page"><div className="settings-shell">
    <header className="settings-header"><div><Link className="settings-back" href={familyId ? '/settings?family=' + encodeURIComponent(familyId) : '/settings'}>← Тохиргоо</Link><p className="settings-eyebrow">ACCOUNT · SECURITY</p><h1>Нэвтрэх ба аюулгүй байдал</h1><p className="settings-intro">Authentication method, verification status болон security action-уудыг тусад нь ойлгомжтой харуулна. Энд зөвхөн одоогийн backend contract ашиглагдана.</p></div><div className="settings-mark" aria-hidden="true"><ShieldCheck size={52} strokeWidth={1.05} /></div></header>
    {error && <div className="settings-alert settings-alert--error" role="alert">{error}</div>}
    {notice && <div className="settings-alert settings-alert--success" role="status" aria-live="polite"><Check size={16} /><span>{notice}</span></div>}
    <div className="settings-layout"><aside className="settings-index" aria-label="Аюулгүй байдлын хэсгүүд"><a href="#methods">Нэвтрэх аргууд</a><a href="#verification">Баталгаажуулалт</a><a href="#password">Нууц үг</a></aside><div className="settings-content">
      <section id="methods" className="settings-section" aria-labelledby="security-methods-title"><div className="settings-section__head"><div className="settings-section__icon"><UserRound size={18} /></div><div><p className="settings-eyebrow">AUTHENTICATION</p><h2 id="security-methods-title">Нэвтрэх аргууд</h2><p>Account-д бодитоор холбогдсон identity-үүдийг backend-ээс шууд харуулна.</p></div></div><div className="settings-security-summary">{identities.length ? identities.map((identity) => <div key={identity.id} className="settings-mini-card"><span className="settings-mini-card__icon">{identity.provider === 'email' ? <Mail size={15} /> : identity.provider === 'phone' ? <Phone size={15} /> : <Globe2 size={15} />}</span><span><strong>{providerLabel(identity.provider)}</strong><small>{identity.display_identifier || 'Холбогдсон'}</small></span><span className={'settings-status settings-status--' + (identity.verified ? 'verified' : 'pending')}>{identity.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}</span></div>) : <div className="settings-empty"><strong>Холбогдсон identity алга.</strong><span>Account-ийн одоогийн authentication contract-оос мэдээлэл ирсэнгүй.</span></div>}</div></section>
      <section id="verification" className="settings-section" aria-labelledby="security-verification-title"><div className="settings-section__head"><div className="settings-section__icon"><ShieldCheck size={18} /></div><div><p className="settings-eyebrow">VERIFICATION</p><h2 id="security-verification-title">Баталгаажуулалт</h2><p>Verification status нь backend-ийн reported state-ийг л дагана.</p></div></div><div className="settings-stack">
        <article className="settings-card settings-action-card"><div className="settings-action-copy"><div className="settings-action-title"><Mail size={17} /><div><strong>Имэйл</strong><span>{email?.display_identifier || 'Имэйл холбогдоогүй'}</span></div></div><p>{email?.verified ? 'Имэйл баталгаажсан байна.' : email ? 'Баталгаажуулах холбоосыг existing verification flow-оор дахин хүсэж болно.' : 'Account-д имэйл identity алга.'}</p></div>{email?.verified ? <span className="settings-status settings-status--verified"><Check size={13} /> Баталгаажсан</span> : email ? <button className="settings-button settings-button--light" type="button" disabled={busy} onClick={() => void requestEmailVerification()}>{busy ? 'Илгээж байна…' : 'Холбоос дахин илгээх'}</button> : <span className="settings-status settings-status--pending">Боломжгүй</span>}</article>
        <article className="settings-card settings-action-card"><div className="settings-action-copy"><div className="settings-action-title"><Phone size={17} /><div><strong>Утасны OTP</strong><span>{phoneIdentity?.display_identifier || (challenge ? phone : 'Баталгаажсан утас холбогдоогүй')}</span></div></div><p>6 оронтой код, expiry болон resend cooldown-ийг existing backend challenge удирдана. OTP өөрөө энд хадгалагдахгүй.</p></div>{phoneIdentity ? <span className="settings-status settings-status--verified"><Check size={13} /> Холбогдсон</span> : !challenge ? <form className="settings-inline-form" onSubmit={requestPhone}><label htmlFor="security-phone">Утасны дугаар</label><input id="security-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+976 99112233" maxLength={20} required disabled={busy} /><span className="settings-help">+976 99112233 эсвэл 99112233.</span><button className="settings-button settings-button--dark" type="submit" disabled={busy}>{busy ? 'Илгээж байна…' : 'Код авах'}</button></form> : <form className="settings-inline-form" onSubmit={verifyPhone}><div className="settings-otp-summary"><span>Код илгээсэн дугаар</span><strong>{phone}</strong></div><label htmlFor="security-phone-code">Баталгаажуулах код</label><input id="security-phone-code" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} required disabled={busy} /><span className="settings-help">6 оронтой кодоо оруулна уу. Backend-ийн expiry/cooldown/attempt limit хүчинтэй.</span><div className="settings-otp-actions"><button className="settings-button settings-button--dark" type="submit" disabled={busy}>{busy ? 'Шалгаж байна…' : 'Баталгаажуулах'}</button><button className="settings-button settings-button--text" type="button" disabled={busy} onClick={() => { setChallenge(null); setPhone(''); }}>Болих</button></div></form>}</article>
        <article className="settings-card settings-action-card"><div className="settings-action-copy"><div className="settings-action-title"><Globe2 size={17} /><div><strong>Google identity</strong><span>{google?.display_identifier || 'Холбогдоогүй'}</span></div></div><p>Google linking enabled үед existing OAuth flow руу шилжинэ. Provider subject болон credential энэ UI-д ил гарахгүй.</p></div>{google ? <span className="settings-status settings-status--verified"><Check size={13} /> Холбогдсон</span> : googleEnabled ? <form method="post" action={(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1') + '/auth/me/google/start'}><button className="settings-button settings-button--light" type="submit">Google account холбох</button></form> : <span className="settings-status settings-status--pending">Одоогоор боломжгүй</span>}</article>
      </div></section>
      <section id="password" className="settings-section" aria-labelledby="security-password-title"><div className="settings-section__head"><div className="settings-section__icon"><ShieldCheck size={18} /></div><div><p className="settings-eyebrow">PASSWORD</p><h2 id="security-password-title">Нууц үг</h2><p>Authenticated password-change endpoint одоогоор байхгүй тул existing password reset flow-оор үргэлжлүүлнэ.</p></div></div><div className="settings-card settings-limitation-card"><ShieldCheck size={17} /><div><strong>Нууц үг сэргээх</strong><p>Шинэ password-ийг энд хадгалахгүй. Existing reset flow нь өөрийн хамгаалалттай reset token-оор ажиллана.</p><Link href="/password-reset">Нууц үг сэргээх →</Link></div></div></section>
    </div></div>
  </div></main>;
}

export default function AccountSecurityPage() {
  return <Suspense fallback={<main className="settings-page"><div className="settings-shell settings-loading"><div className="settings-skeleton" aria-busy="true"><small>Аюулгүй байдлын тохиргоог ачаалж байна…</small></div></div></main>}><AccountSecurityContent /></Suspense>;
}
