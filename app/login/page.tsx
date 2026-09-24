'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, api, User } from '../../lib/api';

type Mode = 'email' | 'phone' | 'recovery';
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('email');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  function moveToApp() {
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    router.push(invite ? `/invite#token=${encodeURIComponent(invite)}` : '/families');
  }

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/google/config').then((value) => setGoogleEnabled(value.enabled)).catch(() => {});
    const result = new URLSearchParams(window.location.search).get('google');
    if (result === 'failed') setError('Google-ээр нэвтрэх боломжгүй боллоо. Бүртгэлтэй бол өмнөх нэвтрэх аргаа ашиглан орж, Google-ийг аюулгүй байдлын хэсгээс холбоно уу.');
  }, []);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
      });
      moveToApp();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Нэвтэрч чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    const inputPhone = String(values.get('phone') ?? phone).trim();
    try {
      const path = mode === 'recovery' ? '/auth/password-reset/phone/request' : '/auth/phone/login/request';
      const result = await api<Challenge>(path, {
        method: 'POST',
        body: JSON.stringify({ phone: inputPhone }),
      });
      setPhone(inputPhone);
      setChallenge(result);
      setNotice('Хэрэв энэ дугаараар үйлчилгээ ашигладаг бол баталгаажуулах код илгээгдлээ.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Код илгээж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      if (mode === 'recovery') {
        const first = String(values.get('new_password') ?? '');
        const confirm = String(values.get('confirm_password') ?? '');
        if (first !== confirm) throw new Error('Нууц үг хоорондоо таарахгүй байна.');
        await api<void>('/auth/password-reset/phone/confirm', {
          method: 'POST',
          body: JSON.stringify({
            phone,
            challenge_id: challenge.challenge_id,
            code: values.get('code'),
            new_password: first,
          }),
        });
        setNotice('Нууц үг шинэчлэгдлээ. Имэйл, нууц үгээрээ нэвтэрнэ үү.');
        setChallenge(null);
        setMode('email');
        return;
      }
      await api<User>('/auth/phone/login/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, challenge_id: challenge.challenge_id, code: values.get('code') }),
      });
      moveToApp();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Баталгаажуулж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  function chooseMode(value: Mode) {
    setMode(value);
    setChallenge(null);
    setNotice('');
    setError('');
  }

  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 460 }}>
    <Link href="/" aria-label="Нүүр">← Гуулингийнхан</Link>
    <h1 style={{ marginTop: 24 }}>{mode === 'recovery' ? 'Нууц үг сэргээх' : 'Нэвтрэх'}</h1>
    <p>Гэр бүлийнхээ түүхийг үргэлжлүүлэн хадгалаарай.</p>
    <div className="tabs" role="tablist" aria-label="Нэвтрэх арга">
      <button type="button" role="tab" aria-selected={mode === 'email'} onClick={() => chooseMode('email')}>Имэйл</button>
      <button type="button" role="tab" aria-selected={mode === 'phone'} onClick={() => chooseMode('phone')}>Утасны код</button>
    </div>
    {notice && <div className="success" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {mode === 'email' && googleEnabled && <button type="button" className="primary" style={{ marginBottom: 16 }} onClick={() => { window.location.assign(`${API_BASE}/auth/google/start`); }}>Google-ээр нэвтрэх</button>}
    {mode === 'email' && <form onSubmit={submitEmail}>
      <label>Имэйл<input name="email" type="email" autoComplete="email" required maxLength={320} /></label>
      <label>Нууц үг<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'}</button>
      <p className="muted"><Link href="/password-reset">Имэйлээр нууц үг сэргээх</Link></p>
      <p className="muted"><Link href="/email-verification">Баталгаажуулах имэйл дахин илгээх</Link></p>
    </form>}
    {mode !== 'email' && !challenge && <form onSubmit={requestCode}>
      <label>Утасны дугаар (E.164)<input name="phone" type="tel" autoComplete="tel" placeholder="+97699112233" required maxLength={16} /></label>
      <p className="muted">Улсын кодтой дугаараа оруулна уу. Жишээ: +97699112233</p>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Илгээж байна…' : 'Код илгээх'}</button>
      {mode === 'phone' && <p className="muted"><button type="button" className="text-button" onClick={() => chooseMode('recovery')}>Нууц үг сэргээх</button></p>}
    </form>}
    {mode !== 'email' && challenge && <form onSubmit={verifyCode}>
      <p className="muted">{phone} дугаарт ирсэн 6 оронтой кодыг оруулна уу.</p>
      <label>Баталгаажуулах код<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6} /></label>
      {mode === 'recovery' && <>
        <label>Шинэ нууц үг<input name="new_password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></label>
        <label>Нууц үгээ дахин оруулна уу<input name="confirm_password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></label>
      </>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Шалгаж байна…' : mode === 'recovery' ? 'Нууц үг шинэчлэх' : 'Нэвтрэх'}</button>
      <p className="muted"><button type="button" className="text-button" onClick={() => { setChallenge(null); setNotice(''); }}>Дугаарыг солих</button></p>
    </form>}
    <p className="muted" style={{ marginTop: 20 }}>Бүртгэлгүй юу? <Link href="/register">Бүртгэл үүсгэх</Link></p>
    <p className="muted"><Link href="/">Загвар дэлгэцийг үзэх</Link></p>
  </section></main>;
}
