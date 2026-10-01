'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, TreeDeciduous } from 'lucide-react';
import { api } from '../../lib/api';

export default function PasswordResetPage() {
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/email/config').then((result) => setEmailEnabled(result.enabled)).catch(() => setEmailEnabled(false));
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value) {
      setToken(value);
      window.history.replaceState({}, '', '/password-reset');
    }
  }, []);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    try {
      const result = await api<{message: string}>('/auth/password-reset/request', {
        method: 'POST', body: JSON.stringify({email: values.get('email')}),
      });
      setNotice(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Хүсэлт илгээж чадсангүй.'); }
    finally { setBusy(false); }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') ?? '');
    if (password !== String(values.get('confirm') ?? '')) {
      setError('Нууц үг давтан оруулсантай таарахгүй байна.'); setBusy(false); return;
    }
    try {
      await api<void>('/auth/password-reset/confirm', {
        method: 'POST', body: JSON.stringify({token, new_password: password}),
      });
      setComplete(true); setNotice('Нууц үг шинэчлэгдлээ. Шинээр нэвтэрнэ үү.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Нууц үг шинэчилж чадсангүй.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="reset-title">
        <Link className="auth-back" href="/login">← Нэвтрэх</Link>
        <div className="auth-brand">
          <div className="brandmark auth-mark"><TreeDeciduous /></div>
          <div><strong>ГУУЛИНГИЙНХАН</strong><span>Миний удам · Манай түүх</span></div>
        </div>
        <div className="auth-heading">
          <h1 id="reset-title">Нууц үг сэргээх</h1>
          <p>Баталгаажсан имэйлд хугацаатай, нэг удаагийн холбоос илгээнэ.</p>
        </div>
        {notice && <div className="auth-message success" role="status">{notice}</div>}
        {error && <div className="auth-message error" role="alert">{error}</div>}
        {!token && !complete && emailEnabled === false && <div className="authv2-unavailable" role="status"><strong>Имэйлээр сэргээх түр хаалттай</strong><p>Баталгаажуулах имэйл илгээх үйлчилгээ тохируулагдаагүй байна.</p></div>}
        {!token && !complete && emailEnabled === null && <p className="authv2-availability" role="status">Үйлчилгээний төлөвийг шалгаж байна…</p>}
        {!token && !complete && emailEnabled === true && <form className="auth-form" onSubmit={request}>
          <label htmlFor="reset-email">Имэйл</label>
          <input id="reset-email" name="email" type="email" autoComplete="email" maxLength={320} required />
          <button className="auth-primary" disabled={busy}>{busy ? 'Илгээж байна…' : 'Холбоос илгээх'}</button>
          <span className="auth-help">Бүртгэлтэй эсэхийг харуулахгүй.</span>
        </form>}
        {token && !complete && <form className="auth-form" onSubmit={confirm}>
          <label htmlFor="reset-password">Шинэ нууц үг</label>
          <div className="password-field">
            <input id="reset-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required />
            <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <span className="auth-help">8-аас доошгүй тэмдэгт.</span>
          <label htmlFor="reset-confirm">Нууц үгээ давтах</label>
          <div className="password-field">
            <input id="reset-confirm" name="confirm" type={showConfirm ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required />
            <button type="button" className="password-toggle" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>
              {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <button className="auth-primary" disabled={busy}>{busy ? 'Шинэчилж байна…' : 'Нууц үг шинэчлэх'}</button>
        </form>}
        {complete && <Link className="auth-primary auth-link-button" href="/login">Нэвтрэх</Link>}
      </section>
    </main>
  );
}
