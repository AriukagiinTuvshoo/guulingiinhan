'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, TreeDeciduous } from 'lucide-react';
import { api, User } from '../../lib/api';

type Mode = 'email' | 'phone';
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

export default function RegisterPage() {
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
    api<{ enabled: boolean }>('/auth/phone/config')
      .then((result) => setPhoneEnabled(result.enabled))
      .catch(() => setPhoneEnabled(false));
  }, []);

  useEffect(() => {
    if (!challenge || resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((value) => Math.max(0, value - 1));
    }, 1000);
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
      setError('Нууц үг хоёр талдаа ижил байх ёстой.');
      return;
    }
    setBusy(true);
    try {
      const submittedEmail = String(values.get('email') ?? '').trim();
      const result = await api<{ message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: submittedEmail,
          password,
          display_name: values.get('name'),
        }),
      });
      setRegisteredEmail(submittedEmail);
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Бүртгэл үүсгэж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function requestPhoneCode(inputPhone?: string, inputName?: string) {
    const requestedPhone = (inputPhone ?? phone).trim();
    const requestedName = (inputName ?? phoneName).trim();
    if (!requestedName) {
      setError('Нэрээ оруулна уу.');
      return;
    }
    if (!requestedPhone) {
      setError('Утасны дугаараа оруулна уу.');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await api<Challenge>('/auth/phone/register/request', {
        method: 'POST',
        body: JSON.stringify({
          phone: requestedPhone,
          display_name: requestedName,
        }),
      });
      setPhone(requestedPhone);
      setPhoneName(requestedName);
      setChallenge(result);
      setResendSeconds(result.resend_after);
      setNotice('Хэрэв энэ дугаараар бүртгэлгүй бол бүртгэл үүсгэх код илгээгдлээ.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Код илгээж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function requestPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await requestPhoneCode(
      String(values.get('phone') ?? ''),
      String(values.get('name') ?? ''),
    );
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
      window.location.assign('/dashboard');
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
    setError('');
    setNotice('');
    setRegisteredEmail('');
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="register-title">
        <Link className="auth-back" href="/">← Нүүр</Link>

        <div className="auth-brand">
          <div className="brandmark auth-mark"><TreeDeciduous /></div>
          <div>
            <strong>ГУУЛИНГИЙНХАН</strong>
            <span>Миний удам · Манай түүх</span>
          </div>
        </div>

        <div className="auth-heading">
          <h1 id="register-title">Бүртгэл үүсгэх</h1>
          <p>Гэр бүлийнхээ хувийн орчноо үүсгэе.</p>
        </div>

        {phoneEnabled && (
          <div className="auth-tabs" role="tablist" aria-label="Бүртгүүлэх арга">
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
              Утасны дугаараар
            </button>
          </div>
        )}

        {notice && <div className="auth-message success" role="status">{notice}</div>}
        {error && <div className="auth-message error" role="alert">{error}</div>}

        {registeredEmail && mode === 'email' ? (
          <div className="auth-complete">
            <div className="auth-complete-mark">✓</div>
            <h2>Бүртгэл үүслээ</h2>
            <p>
              <strong>{registeredEmail}</strong> хаягт баталгаажуулах холбоос илгээлээ.
              Имэйлээ баталгаажуулсны дараа нэвтэрнэ үү.
            </p>
            <Link
              className="auth-primary auth-link-button"
              href={`/email-verification?email=${encodeURIComponent(registeredEmail)}`}
            >
              Имэйлээ шалгах
            </Link>
          </div>
        ) : mode === 'email' ? (
          <form className="auth-form" onSubmit={submitEmail}>
            <label htmlFor="register-name">Нэр</label>
            <input id="register-name" name="name" autoComplete="name" minLength={1} maxLength={120} required />

            <label htmlFor="register-email">Имэйл</label>
            <input id="register-email" name="email" type="email" autoComplete="email" maxLength={320} required />

            <label htmlFor="register-password">Нууц үг</label>
            <div className="password-field">
              <input
                id="register-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
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
            <span className="auth-help">8-аас доошгүй тэмдэгт.</span>

            <label htmlFor="register-confirm">Нууц үгээ дахин оруулна</label>
            <div className="password-field">
              <input
                id="register-confirm"
                name="confirm"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirm((value) => !value)}
                aria-label={showConfirm ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}
              >
                {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <button className="auth-primary" type="submit" disabled={busy}>
              {busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'}
            </button>
          </form>
        ) : !challenge ? (
          <form className="auth-form" onSubmit={requestPhone}>
            <label htmlFor="register-phone-name">Нэр</label>
            <input
              id="register-phone-name"
              name="name"
              autoComplete="name"
              minLength={1}
              maxLength={120}
              required
              value={phoneName}
              onChange={(event) => setPhoneName(event.target.value)}
            />

            <label htmlFor="register-phone">Утасны дугаар</label>
            <input
              id="register-phone"
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
        ) : (
          <form className="auth-form" onSubmit={verifyPhone}>
            <div className="otp-summary">
              <span>Код илгээсэн дугаар</span>
              <strong>{phone}</strong>
            </div>

            <label htmlFor="register-otp">Баталгаажуулах код</label>
            <input
              id="register-otp"
              name="code"
              className="otp-input"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
              maxLength={6}
              autoFocus
              aria-describedby="register-otp-help"
            />
            <span id="register-otp-help" className="auth-help">6 оронтой кодоо оруулна уу.</span>

            <button className="auth-primary" type="submit" disabled={busy}>
              {busy ? 'Шалгаж байна…' : 'Код баталгаажуулах'}
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
              <button type="button" className="text-button" onClick={() => chooseMode('phone')}>
                Дугаарыг солих
              </button>
            </div>
          </form>
        )}

        <p className="auth-footer">
          Бүртгэлтэй юу? <Link href="/login">Нэвтрэх</Link>
        </p>
      </section>
    </main>
  );
}
