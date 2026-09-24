'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function EmailVerificationPage() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmail(new URLSearchParams(window.location.search).get('email') ?? '');
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get('token');
    if (!value) return;
    setToken(value);
    window.history.replaceState({}, '', '/email-verification');
    setBusy(true);
    api<{ message: string }>('/auth/email/verification/confirm', {
      method: 'POST', body: JSON.stringify({ token: value }),
    }).then((result) => setNotice(result.message))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Имэйл баталгаажуулж чадсангүй.'))
      .finally(() => setBusy(false));
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    try {
      const result = await api<{ message: string }>('/auth/email/verification/request', {
        method: 'POST', body: JSON.stringify({ email: values.get('email') }),
      });
      setEmail(String(values.get('email') ?? '')); setNotice(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Хүсэлт илгээж чадсангүй.'); }
    finally { setBusy(false); }
  }

  return <main className="mvp"><section className="mvpbox" style={{maxWidth: 500}}>
    <Link href="/login">← Нэвтрэх</Link>
    <h1 style={{marginTop: 24}}>Имэйл баталгаажуулах</h1>
    <p>Холбоос 24 цагийн дараа хүчингүй болно. Баталгаажуулах нь гэр бүлийн зөвшөөрөл олгохгүй.</p>
    {busy && <p role="status">Шалгаж байна…</p>}
    {notice && <div className="success" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {!token && <form onSubmit={resend}>
      <label>Имэйл<input name="email" type="email" autoComplete="email" maxLength={320} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button className="primary" disabled={busy}>Баталгаажуулах холбоос дахин илгээх</button>
      <p className="muted">Бүртгэл байгаа эсэхийг ил гаргахгүйн тулд ижил хариу харуулна.</p>
    </form>}
    {notice && <p><Link className="button" href="/login">Нэвтрэх</Link></p>}
  </section></main>;
}
