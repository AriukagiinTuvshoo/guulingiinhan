'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, TreeDeciduous } from 'lucide-react';
import { API_BASE, ApiError, api, User } from '../../lib/api';

type Mode = 'email' | 'phone';
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

function authError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх мэдээлэл буруу байна.';
    if (cause.status === 403) return 'Энэ нэвтрэх үйлдлийг одоогоор хийх боломжгүй байна.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503 || cause.code === 'DATABASE_UNAVAILABLE') {
      return 'Нэвтрэх үйлчилгээ түр хугацаанд боломжгүй байна. Дахин оролдоно уу.';
    }
    if (cause.status >= 500) return 'Нэвтрэх серверийн алдаа гарлаа. Дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return 'Нэвтэрч чадсангүй. Дахин оролдоно уу.';
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('email');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/phone/config').then((result) => setPhoneEnabled(result.enabled)).catch(() => setPhoneEnabled(false));
    api<{ enabled: boolean }>('/auth/google/config').then((result) => setGoogleEnabled(result.enabled)).catch(() => setGoogleEnabled(false));
    if (new URLSearchParams(window.location.search).get('google') === 'failed') {
      setError('Google-ээр нэвтрэх боломжгүй боллоо. Өмнөх нэвтрэх аргаа ашиглаарай.');
    }
  }, []);

  useEffect(() => {
    if (!challenge || resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [challenge, resendSeconds]);

  async function moveToApp() {
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if (invite) {
      router.push(`/invite#token=${encodeURIComponent(invite)}`);
      return;
    }
    try {
      await api('/admin/me');
      router.push('/admin');
    } catch {
      router.push('/dashboard');
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email: values.get('email'), password: values.get('password') }) });
      await moveToApp();
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function requestPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const values = new FormData(event.currentTarget);
    const requestedPhone = String(values.get('phone') ?? '').trim();
    if (!requestedPhone) {
      setError('Утасны дугаараа оруулна уу.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<Challenge>('/auth/phone/login/request', { method: 'POST', body: JSON.stringify({ phone: requestedPhone }) });
      setPhone(requestedPhone);
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice('Хэрэв энэ дугаараар бүртгэлтэй account байвал код илгээгдлээ.');
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resendPhoneCode() {
    if (!phone || busy || resendSeconds > 0) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await api<Challenge>('/auth/phone/login/request', { method: 'POST', body: JSON.stringify({ phone }) });
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice('Шинэ код илгээгдлээ.');
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/phone/login/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, challenge_id: challenge.challenge_id, code: values.get('code') }),
      });
      await moveToApp();
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  function chooseMode(nextMode: Mode) {
    setMode(nextMode);
    setChallenge(null);
    setResendSeconds(0);
    setPhone('');
    setNotice('');
    setError('');
  }

  return (
    <main className="authv2-shell">
      <section className="authv2-frame" aria-label="ГУУЛИНГИЙНХАН нэвтрэх">
        <div className="authv2-story">
          <div className="authv2-story-content">
            <Link href="/" className="authv2-mark-link" aria-label="Нүүр хуудас">
              <span className="authv2-mark"><TreeDeciduous size={27} /></span>
              <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
            </Link>
            <div className="authv2-story-copy">
              <p className="public-home__eyebrow">ГЭР БҮЛИЙН ӨВ</p>
              <h1>Түүхийнхээ дунд буцаж орно.</h1>
              <p>Хүмүүс, холбоо, дурсамж, түүхээ гэр бүлийнхээ хувийн орчноос үргэлжлүүлэн хадгална.</p>
            </div>
            <div className="authv2-branch-art" aria-hidden="true"><TreeDeciduous size={132} strokeWidth={1.05} /></div>
            <Link href="/" className="authv2-back">← Нүүр хуудас</Link>
          </div>
        </div>

        <div className="authv2-form-panel">
          <div className="authv2-mobile-brand">
            <Link href="/" className="authv2-mark-link">
              <span className="authv2-mark"><TreeDeciduous size={23} /></span>
              <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
            </Link>
          </div>

          <div className="authv2-heading">
            <p className="public-home__eyebrow">ХУВИЙН ОРОН ЗАЙ</p>
            <h2>Нэвтрэх</h2>
            <p>Гэр бүлийнхээ түүхийг үргэлжлүүлэн хадгалаарай.</p>
          </div>

          <div className="authv2-tabs" role="tablist" aria-label="Нэвтрэх арга">
            <button type="button" role="tab" aria-selected={mode === 'email'} className={mode === 'email' ? 'active' : ''} onClick={() => chooseMode('email')}>Имэйлээр</button>
            <button type="button" role="tab" aria-selected={mode === 'phone'} className={mode === 'phone' ? 'active' : ''} onClick={() => chooseMode('phone')} disabled={!phoneEnabled}>Утасны дугаараар{!phoneEnabled && <span className="authv2-tab-status">Түр хаалттай</span>}</button>
          </div>

          {notice && <div className="authv2-message authv2-message--success" role="status">{notice}</div>}
          {error && <div id="login-error" className="authv2-message authv2-message--error" role="alert">{error}</div>}

          {mode === 'email' ? (
            <form className="authv2-form" onSubmit={submitEmail}>
              <label htmlFor="login-email">Имэйл</label>
              <input id="login-email" name="email" type="email" autoComplete="email" required maxLength={320} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
              <label htmlFor="login-password">Нууц үг</label>
              <div className="authv2-password">
                <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div className="authv2-forgot-row"><Link href="/password-reset">Нууц үгээ мартсан уу?</Link></div>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'} <ArrowRight size={16} /></button>
              {googleEnabled && (
                <>
                  <div className="authv2-divider"><span>эсвэл</span></div>
                  <button type="button" className="authv2-google" onClick={() => window.location.assign(API_BASE + '/auth/google/start')}>Google-ээр нэвтрэх</button>
                </>
              )}
            </form>
          ) : !challenge ? (
            <form className="authv2-form" onSubmit={requestPhoneCode}>
              <label htmlFor="login-phone">Утасны дугаар</label>
              <input id="login-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+976 99112233" required maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} />
              <span className="authv2-help">+976 99112233 эсвэл 99112233 гэж оруулж болно.</span>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Илгээж байна…' : 'Код авах'} <ArrowRight size={16} /></button>
            </form>
          ) : (
            <form className="authv2-form" onSubmit={verifyPhone}>
              <div className="authv2-otp-summary"><span>Код илгээсэн дугаар</span><strong>{phone}</strong></div>
              <label htmlFor="login-otp">Баталгаажуулах код</label>
              <input id="login-otp" name="code" className="authv2-otp-input" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6} autoFocus aria-describedby="login-otp-help" />
              <span id="login-otp-help" className="authv2-help">6 оронтой кодоо оруулна уу.</span>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Шалгаж байна…' : 'Нэвтрэх'} <ArrowRight size={16} /></button>
              <div className="authv2-otp-actions">
                <button type="button" disabled={busy || resendSeconds > 0} onClick={() => void resendPhoneCode()}>{resendSeconds > 0 ? `Дахин код авах · ${resendSeconds} сек` : 'Дахин код авах'}</button>
                <button type="button" onClick={() => chooseMode('phone')}>Дугаарыг солих</button>
              </div>
            </form>
          )}

          <p className="authv2-switch">Бүртгэлгүй юу? <Link href="/register">Бүртгэл үүсгэх</Link></p>
        </div>
      </section>
    </main>
  );
}
