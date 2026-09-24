'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function PasswordResetPage() {
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
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

  return <main className="mvp"><section className="mvpbox" style={{maxWidth: 500}}>
    <Link href="/login">← Нэвтрэх</Link>
    <h1 style={{marginTop: 24}}>Нууц үг сэргээх</h1>
    <p>Зөвхөн баталгаажсан имэйлд хугацаатай, нэг удаагийн холбоос илгээнэ.</p>
    {notice && <div className="success" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {!token && !complete && <form onSubmit={request}>
      <label>Имэйл<input name="email" type="email" autoComplete="email" maxLength={320} required /></label>
      <button className="primary" disabled={busy}>{busy ? 'Илгээж байна…' : 'Холбоос илгээх'}</button>
      <p className="muted">Бүртгэлтэй эсэхийг харуулахгүй.</p>
    </form>}
    {token && !complete && <form onSubmit={confirm}>
      <label>Шинэ нууц үг<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <label>Нууц үгээ давтах<input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <button className="primary" disabled={busy}>{busy ? 'Шинэчилж байна…' : 'Нууц үг шинэчлэх'}</button>
    </form>}
    {complete && <Link className="button" href="/login">Нэвтрэх</Link>}
  </section></main>;
}
