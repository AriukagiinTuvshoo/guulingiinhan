'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { TreeDeciduous } from 'lucide-react';
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

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="verification-title">
        <Link className="auth-back" href="/login">← Нэвтрэх</Link>
        <div className="auth-brand">
          <div className="brandmark auth-mark"><TreeDeciduous /></div>
          <div>
            <strong>ГУУЛИНГИЙНХАН</strong>
            <span>Миний удам · Манай түүх</span>
          </div>
        </div>
        <div className="auth-heading">
          <h1 id="verification-title">Имэйл баталгаажуулах</h1>
          <p>Баталгаажуулах холбоос 24 цагийн дараа хүчингүй болно.</p>
        </div>

        {busy && <div className="auth-message" role="status">Шалгаж байна…</div>}
        {notice && <div className="auth-message success" role="status">{notice}</div>}
        {error && <div className="auth-message error" role="alert">{error}</div>}

        {!token && (
          <form className="auth-form" onSubmit={resend}>
            <label htmlFor="verification-email">Имэйл</label>
            <input
              id="verification-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={320}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button className="auth-primary" disabled={busy}>
              Баталгаажуулах холбоос дахин авах
            </button>
            <span className="auth-help">
              Бүртгэл байгаа эсэхийг ил гаргахгүй тул ижил хариу харуулна.
            </span>
          </form>
        )}

        {notice && <Link className="auth-primary auth-link-button" href="/login">Нэвтрэх</Link>}
      </section>
    </main>
  );
}
