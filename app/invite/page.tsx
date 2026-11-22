'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api, Family } from '../../lib/api';

export default function InvitePage() {
  const [familyId, setFamilyId] = useState(''); const [family, setFamily] = useState<Family | null>(null);
  const [token, setToken] = useState(''); const [issued, setIssued] = useState<{id: string; email: string} | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [preview, setPreview] = useState<{ family_name: string; role: string; expires_at: string } | null>(null);
  const [acceptedFamilyId, setAcceptedFamilyId] = useState('');
  const [selectedRole, setSelectedRole] = useState('member');
  const [pastedCode, setPastedCode] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); const hashParams = new URLSearchParams(window.location.hash.slice(1)); const fid = params.get('family') ?? ''; const invitationToken = hashParams.get('token') ?? '';
    setFamilyId(fid); setToken(invitationToken);
    if (fid) api<Family>(`/families/${fid}`).then(setFamily).catch((cause) => setError(cause instanceof Error ? cause.message : 'Гэр бүлийг ачаалж чадсангүй.'));
  }, []);
  async function inspectInvitation() {
    setBusy(true); setError('');
    try { setPreview(await api('/invitations/preview', { method: 'POST', body: JSON.stringify({ token }) })); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Урилгыг шалгаж чадсангүй.'); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { const result = await api<{ id: string; email: string; role: string; expires_at: string }>(`/families/${familyId}/invitations`, { method: 'POST', body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) }); setIssued({id: result.id, email: result.email}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Урилга үүсгэж чадсангүй.'); }
    finally { setBusy(false); }
  }
  async function accept() {
    setBusy(true); setError('');
    try { const result = await api<{ family_id: string }>('/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) }); setAcceptedFamilyId(result.family_id); setDone(true); setToken(''); window.history.replaceState(null, '', '/invite'); }
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
    <h1 style={{ marginTop: 22 }}>Гэр бүлийн урилга</h1>
    {error && <div className="error" role="alert">{error}</div>}
    {done ? <div className="success" role="status"><h2>Гэр бүлд амжилттай нэгдлээ</h2><p>Шинэ гэр бүл үүсгэх шаардлагагүй. Гишүүд хэсгээс өөрийн бүртгэлээ баталгаажуулж, байгаа модонд нэгдээрэй.</p><p>{preview?.family_name} · {preview?.role === 'editor' ? 'Засварлагч' : 'Гишүүн'}</p><Link className="button primary" href={`/tree?view=family&family=${encodeURIComponent(acceptedFamilyId)}`}>Гэр бүлийн модыг нээх →</Link><Link className="button" href={`/people?family=${encodeURIComponent(acceptedFamilyId)}`}>Өөрийн удмын бүртгэлийг холбох →</Link></div> : token ? <>
      <ol><li>Урьсан имэйлтэй бүртгэлээр нэвтэрнэ.</li><li>Гэр бүл болон олгох эрхийг шалгана.</li><li>Зөвшөөрч нэгдэнэ.</li></ol>
      {preview ? <section className="card"><h2>{preview.family_name}</h2><p>Танд олгох эрх: <strong>{preview.role === 'editor' ? 'Засварлагч' : 'Гишүүн'}</strong></p><p>{preview.role === 'editor' ? 'Гэр бүлийн мэдээлэл нэмэх, засах эрхтэй. Эзэмшигч болон глобал админ эрх олгохгүй.' : 'Гэр бүлийн зөвшөөрөгдсөн мэдээллийг үзэж, өөрийн дурсамжийг нэмнэ.'}</p><p>Урилгын хугацаа: {new Date(preview.expires_at).toLocaleDateString('mn-MN')}</p><button type="button" className="primary" disabled={busy} onClick={accept}>{busy ? 'Нэгдэж байна…' : 'Зөвшөөрч гэр бүлд нэгдэх'}</button></section> : <button type="button" className="primary" disabled={busy} onClick={inspectInvitation}>{busy ? 'Шалгаж байна…' : 'Урилгын гэр бүл, эрхийг шалгах'}</button>}
      <div className="row"><Link href={`/login#invite=${encodeURIComponent(token)}`}>Нэвтрэх</Link><Link href={`/register#invite=${encodeURIComponent(token)}`}>Бүртгүүлэх</Link></div>
    </> : family?.role === 'owner' ? <>
      <h2>{family.name}</h2><p>Имэйлээр хүлээн авагчид нь зориулсан холбоос илгээнэ. 7 хоногийн дараа хүчингүй болно; та урилгыг цуцалж болно.</p>
      <form onSubmit={create}><label>Урих имэйл<input name="email" type="email" maxLength={320} required autoComplete="email" /></label><label>Олгох эрх<select name="role" value={selectedRole} onChange={event => setSelectedRole(event.target.value)} aria-describedby="invitation-role-help"><option value="member">Гишүүн</option><option value="editor">Засварлагч</option></select></label><p id="invitation-role-help">{selectedRole === 'editor' ? 'Гэр бүлийн мэдээлэл нэмэх, засах боломж олгоно. Зөвхөн итгэлтэй хүнд сонгоно уу.' : 'Зөвшөөрөгдсөн мэдээллийг үзэх болон өөрийн дурсамжийг нэмэх эрх.'}</p><button className="primary" disabled={busy}>{busy ? 'Илгээж байна…' : 'Урилга илгээх'}</button></form>
      {issued && <div className="card" role="status" style={{ marginTop: 18 }}><h2>Урилга илгээгдлээ</h2><p>{issued.email} хаягт очсон холбоосоор зөвхөн тэр бүртгэл нэгдэнэ.</p><button type="button" disabled={busy} onClick={revoke}>Урилгыг цуцлах</button></div>}
    </> : familyId ? <p>Гэр бүлийн эзэмшигч урилга илгээнэ. Гэр бүлийн мэдээлэл ачаалж байгаа эсвэл танд энэ эрх байхгүй байна.</p> : <form onSubmit={event => { event.preventDefault(); setToken(pastedCode.trim()); setPreview(null); }}><p>Имэйлээр ирсэн холбоосыг нээнэ үү. Эсвэл урилгын кодыг энд оруулж болно.</p><label>Урилгын код<input type="password" value={pastedCode} onChange={event => setPastedCode(event.target.value)} minLength={32} maxLength={128} autoComplete="off" required /></label><button className="primary" type="submit">Кодыг шалгах</button></form>}
  </section></main>;
}
