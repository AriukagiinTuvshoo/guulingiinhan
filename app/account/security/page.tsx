'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '../../../lib/api';

type Identity = { id: string; provider: string; display_identifier: string | null; verified: boolean; created_at: string };
type Challenge = { challenge_id: string; expires_in: number; resend_after: number };

export default function AccountSecurityPage() {
  const router = useRouter();
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  async function refresh() {
    setIdentities(await api<Identity[]>('/auth/me/identities'));
  }

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/google/config').then((value) => setGoogleEnabled(value.enabled)).catch(() => {});
    refresh().catch((cause) => {
      if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
      else setError(cause instanceof Error ? cause.message : 'Мэдээлэл ачаалж чадсангүй.');
    });
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
      setError(cause instanceof Error ? cause.message : 'Хүсэлт илгээж чадсангүй.');
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
      setError(cause instanceof Error ? cause.message : 'Дугаар баталгаажуулж чадсангүй.');
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Хүсэлт илгээж чадсангүй.'); }
    finally { setBusy(false); }
  }

  const linkedPhone = identities.some((item) => item.provider === 'phone' && item.verified);
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 680 }}>
    <Link href="/families">← Гэр бүлүүд</Link>
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
