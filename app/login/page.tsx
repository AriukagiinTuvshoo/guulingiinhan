'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, TreeDeciduous } from 'lucide-react';
import { API_BASE, api, User } from '../../lib/api';

type Mode = 'email' | 'phone';
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

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
    api<{ enabled: boolean }>('/auth/phone/config')
      .then((result) => setPhoneEnabled(result.enabled))
      .catch(() => setPhoneEnabled(false));
    api<{ enabled: boolean }>('/auth/google/config')
      .then((value) => setGoogleEnabled(value.enabled))
      .catch(() => setGoogleEnabled(false));

    const result = new URLSearchParams(window.location.search).get('google');
    if (result === 'failed') {
      setError(
        'Google-ээр нэвтрэх боломжгүй боллоо. Бүртгэлтэй бол өмнөх нэвтрэх аргаа ашиглана уу.',
      );
    }
  }, []);

  useEffect(() => {
    if (!challenge || resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [challenge, resendSeconds]);

  function moveToApp() {
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    router.push(invite ? `/invite#token=${encodeURIComponent(invite)}` : '/dashboard');
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: values.get('email'),
          password: values.get('password'),
        }),
      });
      moveToApp();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Нэвтэрч чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function requestPhoneCode(inputPhone?: string) {
    const requestedPhone = (inputPhone ?? phone).trim();
    if (!requestedPhone) {
      setError('Утасны дугаараа оруулна уу.');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await api<Challenge>('/auth/phone/login/request', {
        method: 'POST',
        body: JSON.stringify({ phone: requestedPhone }),
      });
      setPhone(requestedPhone);
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice('Хэрэв энэ дугаараар бүртгэлтэй account байвал баталгаажуулах код илгээгдлээ.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Код илгээж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await requestPhoneCode(String(values.get('phone') ?? ''));
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/phone/login/verify', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          challenge_id: challenge.challenge_id,
          code: values.get('code'),
        }),
      });
      setNotice('Нэвтэрлээ.');
      moveToApp();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Код баталгаажуулж чадсангүй.');
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
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <Link className="auth-back" href="/" aria-label="Нүүр хуудас руу буцах">
          ← Нүүр
        </Link>

        <div className="auth-brand">
          <div className="brandmark auth-mark"><TreeDeciduous /></div>
          <div>
            <strong>ГУУЛИНГИЙНХАН</strong>
            <span>Миний удам · Манай түүх</span>
          </div>
        </div>

        <div className="auth-heading">
          <h1 id="login-title">Нэвтрэх</h1>
          <p>Гэр бүлийнхээ түүхийг үргэлжлүүлэн хадгалаарай.</p>
        </div>

        {phoneEnabled && (
          <div className="auth-tabs" role="tablist" aria-label="Нэвтрэх арга">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'email'}
              className={mode === 'email' ? 'active' : ''}
              onClick={() => chooseMode('email')}
            >
              Имэйлээр
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'phone'}
              className={mode === 'phone' ? 'active' : ''}
              onClick={() => chooseMode('phone')}
            >
              Утасны код
            </button>
          </div>
        )}

        {notice && <div className="auth-message success" role="status">{notice}</div>}
        {error && <div className="auth-message error" role="alert">{error}</div>}

        {mode === 'email' && (
          <form className="auth-form" onSubmit={submitEmail}>
            <label htmlFor="login-email">Имэйл</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
            />

            <label htmlFor="login-password">Нууц үг</label>
            <div className="password-field">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                maxLength={128}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <button className="auth-primary" type="submit" disabled={busy}>
              {busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'}
            </button>

            {googleEnabled && (
              <button
                type="button"
                className="auth-secondary"
                onClick={() => window.location.assign(`${API_BASE}/auth/google/start`)}
              >
                Google-ээр нэвтрэх
              </button>
            )}

            <div className="auth-links">
              <Link href="/password-reset">Нууц үг сэргээх</Link>
              <Link href="/email-verification">Баталгаажуулах имэйл дахин илгээх</Link>
            </div>
          </form>
        )}

        {mode === 'phone' && !challenge && (
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="login-phone">Утасны дугаар</label>
            <input
              id="login-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+976 99112233"
              required
              maxLength={20}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <span className="auth-help">+976 99112233 эсвэл 99112233 гэж оруулж болно.</span>

            <button className="auth-primary" type="submit" disabled={busy}>
              {busy ? 'Илгээж байна…' : 'Код авах'}
            </button>
          </form>
        )}

        {mode === 'phone' && challenge && (
          <form className="auth-form" onSubmit={verifyCode}>
            <div className="otp-summary">
              <span>Код илгээсэн дугаар</span>
              <strong>{phone}</strong>
            </div>

            <label htmlFor="login-otp">Баталгаажуулах код</label>
            <input
              id="login-otp"
              name="code"
              className="otp-input"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
              maxLength={6}
              autoFocus
              aria-describedby="login-otp-help"
            />
            <span id="login-otp-help" className="auth-help">6 оронтой кодоо оруулна уу.</span>

            <button className="auth-primary" type="submit" disabled={busy}>
              {busy ? 'Шалгаж байна…' : 'Нэвтрэх'}
            </button>

            <div className="otp-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy || resendSeconds > 0}
                onClick={() => void requestPhoneCode()}
              >
                {resendSeconds > 0 ? `Дахин код авах · ${resendSeconds} сек` : 'Дахин код авах'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => chooseMode('phone')}
              >
                Дугаарыг солих
              </button>
            </div>
          </form>
        )}

        <p className="auth-footer">
          Бүртгэлгүй юу? <Link href="/register">Бүртгэл үүсгэх</Link>
        </p>
      </section>
    </main>
  );
}
