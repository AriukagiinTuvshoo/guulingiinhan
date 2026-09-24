'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family, User } from '../../lib/api';

export default function InvitePage() {
  const router = useRouter(); const [familyId, setFamilyId] = useState(''); const [family, setFamily] = useState<Family | null>(null);
  const [token, setToken] = useState(''); const [issued, setIssued] = useState<{id: string; email: string} | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); const hashParams = new URLSearchParams(window.location.hash.slice(1)); const fid = params.get('family') ?? ''; const invitationToken = hashParams.get('token') ?? '';
    setFamilyId(fid); setToken(invitationToken);
    if (fid) api<Family>(`/families/${fid}`).then(setFamily).catch((cause) => setError(cause instanceof Error ? cause.message : 'Гэр бүлийг ачаалж чадсангүй.'));
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { const result = await api<{ id: string; email: string; role: string; expires_at: string }>(`/families/${familyId}/invitations`, { method: 'POST', body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) }); setIssued({id: result.id, email: result.email}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Урилга үүсгэж чадсангүй.'); }
    finally { setBusy(false); }
  }
  async function accept() {
    setBusy(true); setError('');
    try { const result = await api<{ family_id: string }>('/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) }); setDone(true); router.replace(`/tree?family=${result.family_id}`); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setError('Урилгыг хүлээн авахын тулд бүртгэлдээ нэвтэрнэ үү.');
      else setError(cause instanceof Error ? cause.message : 'Урилгыг хүлээн авч чадсангүй.');
    } finally { setBusy(false); }
  }
  async function revoke() {
    if (!issued) return;
    setBusy(true); setError('');
    try { await api<void>(`/families/${familyId}/invitations/${issued.id}`, {method: 'DELETE'}); setIssued(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Урилгыг цуцалж чадсангүй.'); }
    finally { setBusy(false); }
  }
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 620 }}>
    <Link href="/families">← Гэр бүлүүд</Link>
    {token ? <><h1 style={{ marginTop: 22 }}>Гэр бүлийн урилга</h1><p>Урилгыг зөвхөн урьсан, имэйлээ баталгаажуулсан бүртгэлээр авна.</p>{error && <div className="error" role="alert">{error}</div>}{done ? <div className="success">Урилгыг хүлээн авлаа.</div> : <div className="row"><button className="primary" disabled={busy} onClick={accept}>{busy ? 'Шалгаж байна…' : 'Урилга хүлээн авах'}</button><Link href={`/login#invite=${encodeURIComponent(token)}`}>Нэвтрэх</Link><Link href={`/register#invite=${encodeURIComponent(token)}`}>Бүртгүүлэх</Link></div>}</> : <><h1 style={{ marginTop: 22 }}>{family?.name ?? 'Гэр бүлийн хүн урих'}</h1><p>Урилгыг баталгаажсан и-мэйл хаяг руу илгээнэ. Холбоос 7 хоног хүчинтэй.</p>{error && <div className="error" role="alert">{error}</div>}<form onSubmit={create}><label>Урих имэйл<input name="email" type="email" maxLength={320} required /></label><label>Эрх<select name="role"><option value="member">Гишүүн</option><option value="editor">Засварлагч</option></select></label><button className="primary" disabled={busy}>{busy ? 'Илгээж байна…' : 'Урилга илгээх'}</button></form>{issued && <div className="card" style={{ marginTop: 18 }}><h2>Урилга илгээгдлээ</h2><p>{issued.email} хаяг руу 7 хоногийн хүчинтэй урилга илгээв.</p><button type="button" disabled={busy} onClick={revoke}>Урилгыг цуцлах</button></div>}</>}
  </section></main>;
}
