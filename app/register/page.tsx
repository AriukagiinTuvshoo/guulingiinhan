'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, ArrowRight, TreeDeciduous } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError, api, User } from '../../lib/api';

type Mode = 'email' | 'phone';
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

function registerError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 409) return 'Энэ бүртгэлийг одоогоор үүсгэх боломжгүй байна. Мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503 || cause.code === 'DATABASE_UNAVAILABLE') {
      return 'Бүртгэлийн үйлчилгээ түр хугацаанд боломжгүй байна. Дахин оролдоно уу.';
    }
    if (cause.status >= 500) return 'Бүртгэлийн серверийн алдаа гарлаа. Дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return 'Бүртгэл үүсгэж чадсангүй. Дахин оролдоно уу.';
}

export default function RegisterPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('email');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneName, setPhoneName] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/phone/config').then((result) => setPhoneEnabled(result.enabled)).catch(() => setPhoneEnabled(false));
  }, []);

  useEffect(() => {
    if (!challenge || resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [challenge, resendSeconds]);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') ?? '');
    const confirm = String(values.get('confirm') ?? '');
    if (password !== confirm) {
      setError('Нууц үг таарахгүй байна.');
      return;
    }
    setBusy(true);
    try {
      const email = String(values.get('email') ?? '').trim();
      const result = await api<{ message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: values.get('name') }),
      });
      setRegisteredEmail(email);
      setNotice(result.message);
    } catch (cause) {
      setError(registerError(cause));
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
    const requestedName = String(values.get('name') ?? '').trim();
    if (!requestedName) {
      setError('Нэрээ оруулна уу.');
      return;
    }
    if (!requestedPhone) {
      setError('Утасны дугаараа оруулна уу.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<Challenge>('/auth/phone/register/request', {
        method: 'POST',
        body: JSON.stringify({ phone: requestedPhone, display_name: requestedName }),
      });
      setPhone(requestedPhone);
      setPhoneName(requestedName);
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice('Хэрэв энэ дугаараар бүртгэлгүй бол бүртгэл үүсгэх код илгээгдлээ.');
    } catch (cause) {
      setError(registerError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resendPhoneCode() {
    if (!phone || !phoneName || busy || resendSeconds > 0) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await api<Challenge>('/auth/phone/register/request', {
        method: 'POST',
        body: JSON.stringify({ phone, display_name: phoneName }),
      });
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice('Шинэ код илгээгдлээ.');
    } catch (cause) {
      setError(registerError(cause));
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
      await api<User>('/auth/phone/register/verify', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          challenge_id: challenge.challenge_id,
          code: values.get('code'),
          display_name: phoneName,
        }),
      });
      router.push('/dashboard');
    } catch (cause) {
      setError(registerError(cause));
    } finally {
      setBusy(false);
    }
  }

  function chooseMode(nextMode: Mode) {
    setMode(nextMode);
    setChallenge(null);
    setResendSeconds(0);
    setRegisteredEmail('');
    setNotice('');
    setError('');
  }

  return (
    <main className="authv2-shell">
      <section className="authv2-frame" aria-label="ГУУЛИНГИЙНХАН бүртгэл">
        <div className="authv2-story">
          <div className="authv2-story-content">
            <Link href="/" className="authv2-mark-link" aria-label="Нүүр хуудас">
              <span className="authv2-mark"><TreeDeciduous size={27} /></span>
              <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
            </Link>
            <div className="authv2-story-copy">
              <p className="public-home__eyebrow">ГЭР БҮЛИЙН ӨВ</p>
              <h1>Түүхээ үлдээх орчноо эндээс эхлүүл.</h1>
              <p>Гэр бүлийнхээ холбоо, түүх, дурсамжийг бага багаар цуглуулж, дараагийн үедээ үлдээнэ.</p>
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
            <h2>Бүртгэл үүсгэх</h2>
            <p>Гэр бүлийнхээ хувийн орчноо эхлүүлье.</p>
          </div>

          {phoneEnabled && (
            <div className="authv2-tabs" role="tablist" aria-label="Бүртгүүлэх арга">
              <button type="button" role="tab" aria-selected={mode === 'email'} className={mode === 'email' ? 'active' : ''} onClick={() => chooseMode('email')}>Имэйл</button>
              <button type="button" role="tab" aria-selected={mode === 'phone'} className={mode === 'phone' ? 'active' : ''} onClick={() => chooseMode('phone')}>Утасны дугаар</button>
            </div>
          )}

          {notice && <div className="authv2-message authv2-message--success" role="status">{notice}</div>}
          {error && <div className="authv2-message authv2-message--error" role="alert">{error}</div>}

          {registeredEmail && mode === 'email' ? (
            <div className="authv2-complete">
              <span className="authv2-complete-mark" aria-hidden="true">✓</span>
              <h3>Бүртгэлийн хүсэлт хүлээн авлаа.</h3>
              <p><strong>{registeredEmail}</strong> хаягт шаардлагатай бол баталгаажуулах холбоос илгээгдэнэ.</p>
              <Link className="authv2-submit authv2-link-button" href={`/email-verification?email=${encodeURIComponent(registeredEmail)}`}>Имэйлээ шалгах <ArrowRight size={16} /></Link>
            </div>
          ) : mode === 'email' ? (
            <form className="authv2-form" onSubmit={submitEmail}>
              <label htmlFor="register-name">Нэр</label>
              <input id="register-name" name="name" autoComplete="name" minLength={1} maxLength={120} required />
              <label htmlFor="register-email">Имэйл</label>
              <input id="register-email" name="email" type="email" autoComplete="email" maxLength={320} required />
              <label htmlFor="register-password">Нууц үг</label>
              <div className="authv2-password">
                <input id="register-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="register-password-help" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              <span id="register-password-help" className="authv2-help">8-аас доошгүй тэмдэгт.</span>
              <label htmlFor="register-confirm">Нууц үгээ дахин оруулна</label>
              <div className="authv2-password">
                <input id="register-confirm" name="confirm" type={showConfirm ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required />
                <button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'} <ArrowRight size={16} /></button>
            </form>
          ) : !challenge ? (
            <form className="authv2-form" onSubmit={requestPhoneCode}>
              <label htmlFor="register-phone-name">Нэр</label>
              <input id="register-phone-name" name="name" autoComplete="name" minLength={1} maxLength={120} required value={phoneName} onChange={(event) => setPhoneName(event.target.value)} />
              <label htmlFor="register-phone">Утасны дугаар</label>
              <input id="register-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+976 99112233" required maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} />
              <span className="authv2-help">+976 99112233 эсвэл 99112233 гэж оруулж болно.</span>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Илгээж байна…' : 'Код авах'} <ArrowRight size={16} /></button>
            </form>
          ) : (
            <form className="authv2-form" onSubmit={verifyPhone}>
              <div className="authv2-otp-summary"><span>Код илгээсэн дугаар</span><strong>{phone}</strong></div>
              <label htmlFor="register-otp">Баталгаажуулах код</label>
              <input id="register-otp" name="code" className="authv2-otp-input" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6} autoFocus aria-describedby="register-otp-help" />
              <span id="register-otp-help" className="authv2-help">6 оронтой кодоо оруулна уу.</span>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Шалгаж байна…' : 'Код баталгаажуулах'} <ArrowRight size={16} /></button>
              <div className="authv2-otp-actions">
                <button type="button" disabled={busy || resendSeconds > 0} onClick={() => void resendPhoneCode()}>{resendSeconds > 0 ? `Дахин код авах · ${resendSeconds} сек` : 'Дахин код авах'}</button>
                <button type="button" onClick={() => chooseMode('phone')}>Дугаарыг солих</button>
              </div>
            </form>
          )}

          <p className="authv2-switch">Аль хэдийн бүртгэлтэй юу? <Link href="/login">Нэвтрэх</Link></p>
        </div>
      </section>
    </main>
  );
}
