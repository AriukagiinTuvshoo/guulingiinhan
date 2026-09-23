'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, User } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    if (values.get('password') !== values.get('confirm')) {
      setError('Нууц үг давтан оруулсантай таарахгүй байна.');
      return;
    }
    setBusy(true);
    try {
      await api<User>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: values.get('email'), password: values.get('password'), display_name: values.get('name') }),
      });
      const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
      router.push(invite ? `/invite#token=${encodeURIComponent(invite)}` : '/onboarding');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Бүртгэл үүсгэж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 460 }}>
    <Link href="/">← Гуулингийнхан</Link>
    <h1 style={{ marginTop: 24 }}>Бүртгэл үүсгэх</h1>
    <p>Эхлээд аккаунтаа үүсгээд гэр бүлийн модоо эхлүүлнэ.</p>
    {error && <div className="error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label>Таны нэр<input name="name" autoComplete="name" minLength={1} maxLength={120} required /></label>
      <label>Имэйл<input name="email" type="email" autoComplete="email" maxLength={320} required /></label>
      <label>Нууц үг<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /><small className="muted">10-аас доошгүй тэмдэгт</small></label>
      <label>Нууц үг давтах<input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'}</button>
    </form>
    <p className="muted" style={{ marginTop: 20 }}>Бүртгэлтэй юу? <Link href="/login">Нэвтрэх</Link></p>
  </section></main>;
}
