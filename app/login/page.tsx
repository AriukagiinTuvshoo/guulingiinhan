'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, User } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
      });
      const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
      router.push(invite ? `/invite#token=${encodeURIComponent(invite)}` : '/families');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Нэвтэрч чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 460 }}>
    <Link href="/" aria-label="Нүүр">← Гуулингийнхан</Link>
    <h1 style={{ marginTop: 24 }}>Нэвтрэх</h1>
    <p>Гэр бүлийнхээ түүхийг үргэлжлүүлэн хадгалаарай.</p>
    {error && <div className="error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label>Имэйл<input name="email" type="email" autoComplete="email" required maxLength={320} /></label>
      <label>Нууц үг<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'}</button>
    </form>
    <p className="muted" style={{ marginTop: 20 }}>Бүртгэлгүй юу? <Link href="/register">Бүртгэл үүсгэх</Link></p>
    <p className="muted"><Link href="/">Загвар дэлгэцийг үзэх</Link></p>
  </section></main>;
}
