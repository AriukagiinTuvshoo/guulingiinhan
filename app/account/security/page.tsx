'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api } from '../../../lib/api';

type Identity = { id: string; provider: string; display_identifier: string | null; verified: boolean; created_at: string };
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 409) return 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return fallback;
}

function AccountSecurityContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyId = searchParams.get('family')?.trim() ?? '';
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const refreshSequence = useRef(0);

  async function refresh() { setIdentities(await api<Identity[]>('/auth/me/identities')); }

  useEffect(() => {
    setLoading(true);
    api<{ enabled: boolean }>('/auth/google/config').then((value) => setGoogleEnabled(value.enabled)).catch(() => {});
    refresh().catch((cause) => {
      if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
      else setError(friendlyError(cause, 'Мэдээлэл ачаалж чадсангүй.'));
    }).finally(() => setLoading(false));
  }, [router]);

  async function requestPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const values = new FormData(event.currentTarget);
    const requestedPhone = String(values.get('phone') ?? '').trim();
    try {
      const result = await api<Challenge>('/auth/me/phone/request', {
        method: 'POST', body: JSON.stringify({ phone: requestedPhone }),
      });
      setPhone(requestedPhone);
      setChallenge(result);
      setNotice('Баталгаажуулах код илгээгдлээ.');
    } catch (cause) {
      setError(friendlyError(cause, 'Хүсэлт илгээж чадсангүй.'));
    } finally { setBusy(false); }
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await api<Identity>('/auth/me/phone/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, challenge_id: challenge.challenge_id, code: values.get('code') }),
      });
      setChallenge(null);
      setNotice('Утасны дугаар баталгаажиж, энэ account-той холбогдлоо.');
      await refresh();
    } catch (cause) {
      setError(friendlyError(cause, 'Дугаар баталгаажуулж чадсангүй.'));
    } finally { setBusy(false); }
  }

  async function requestEmailVerification() {
    const email = identities.find((item) => item.provider === 'email')?.display_identifier;
    if (!email) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{message: string}>('/auth/email/verification/request', {
        method: 'POST', body: JSON.stringify({email}),
      });
      setNotice(result.message);
    } catch (cause) { setError(friendlyError(cause, 'Хүсэлт илгээж чадсангүй.')); }
    finally { setBusy(false); }
  }

  const linkedPhone = identities.some((item) => item.provider === 'phone' && item.verified);
  if (loading) return <main className="mvp" aria-busy="true"><section className="mvpbox" style={{ maxWidth: 680 }}><p role="status">Аюулгүй байдлын тохиргоог ачаалж байна…</p></section></main>;
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 680 }}>
    <Link href={familyId ? '/settings?family=' + encodeURIComponent(familyId) : '/families'}>← Тохиргоо</Link>
    <h1 style={{ marginTop: 24 }}>Нэвтрэх ба аюулгүй байдал</h1>
    <p>Утасны дугаараа баталгаажуулж холбосноор кодоор нэвтрэх болон нууц үг сэргээх боломжтой.</p>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    <div className="card" style={{ margin: '18px 0' }}>
      <h2>Нэвтрэх аргууд</h2>
      {identities.map((identity) => <p key={identity.id}>
        <strong>{identity.provider === 'email' ? 'Имэйл' : identity.provider === 'phone' ? 'Утас' : 'Google'}</strong>
        {' · '}{identity.display_identifier ?? 'холбогдсон'}{' · '}{identity.verified ? 'Баталгаажсан' : 'баталгаажаагүй'}
      </p>)}
      {identities.some((item) => item.provider === 'email' && !item.verified) && <div className="card">
        <p>Имэйл баталгаажаагүй байна.</p>
        <button type="button" disabled={busy} onClick={requestEmailVerification}>Баталгаажуулах холбоос дахин илгээх</button>
      </div>}
      {!linkedPhone && !challenge && <form onSubmit={requestPhone}>
        <label>Утасны дугаар<input name="phone" type="tel" placeholder="+976 99112233" required maxLength={20} /><span className="muted">+976 99112233 эсвэл 99112233 гэж оруулж болно.</span></label>
        <button className="primary" disabled={busy}>{busy ? 'Илгээж байна…' : 'Утас холбох'}</button>
      </form>}
      {googleEnabled && !identities.some((item) => item.provider === 'google' && item.verified) && <form method="post" action={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1'}/auth/me/google/start`} style={{ marginTop: 16 }}>
        <button className="primary" type="submit">Google account холбох</button>
      </form>}
      {!linkedPhone && challenge && <form onSubmit={verifyPhone}>
        <p className="muted">{phone} дугаарт ирсэн 6 оронтой кодыг оруулна уу.</p>
        <label>Баталгаажуулах код<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6} /></label>
        <div className="row"><button className="primary" disabled={busy}>{busy ? 'Шалгаж байна…' : 'Баталгаажуулж холбох'}</button><button type="button" onClick={() => setChallenge(null)}>Болих</button></div>
      </form>}
      {linkedPhone && <p className="success">Баталгаажсан утас холбогдсон.</p>}
    </div>
    <p className="muted">Утасны дугаарыг салгах боломжгүй; account-д нэвтрэх өөр баталгаажсан арга хадгалагдах ёстой.</p>
  </section></main>;
}

export default function AccountSecurityPage() {
  return <Suspense fallback={<main className="mvp"><section className="mvpbox"><p role="status">Ачаалж байна…</p></section></main>}><AccountSecurityContent /></Suspense>;
}
