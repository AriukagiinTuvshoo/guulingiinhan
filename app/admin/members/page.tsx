'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import '../admin.css';

type Member = { user_id: string; display_name: string; role: string };
type Invitation = { id: string; email: string; role: string; expires_at: string };
type Access = { owner: boolean; scopes: string[] };

export default function AdminMembersPage() {
  const [family, setFamily] = useState('');
  const [owner, setOwner] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? '';
    const controller = new AbortController();
    if (!id) { setError('Гэр бүл сонгоно уу.'); setLoading(false); return; }
    setFamily(id);
    api<Access>(`/families/${encodeURIComponent(id)}/admin-access`, { signal: controller.signal }).then(async (access) => {
      if (!access.scopes.includes('manage_members')) throw new Error('forbidden');
      const [rows, invites] = await Promise.all([
        api<Member[]>(`/families/${encodeURIComponent(id)}/members`, { signal: controller.signal }),
        api<Invitation[]>(`/families/${encodeURIComponent(id)}/invitations`, { signal: controller.signal }),
      ]);
      if (!controller.signal.aborted) { setOwner(access.owner); setMembers(rows); setInvitations(invites); setAllowed(true); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError('Гишүүд, урилгыг удирдах эрхгүй эсвэл ачаалж чадсангүй.'); setLoading(false); } });
    return () => controller.abort();
  }, []);
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const row = await api<Invitation>(`/families/${encodeURIComponent(family)}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) });
      setInvitations((current) => [row, ...current]); setEmail(''); setNotice('Урилга илгээгдлээ.');
    } catch { setError('Урилга илгээж чадсангүй.'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy || !window.confirm('Урилгыг цуцлах уу?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setInvitations((current) => current.filter((row) => row.id !== id)); setNotice('Урилга цуцлагдлаа.');
    } catch { setError('Урилга цуцалж чадсангүй.'); }
    finally { setBusy(false); }
  }
  return <main className="admin-console"><header className="admin-console__header"><h1>Гишүүд ба урилга</h1><Link href={`/admin?family=${encodeURIComponent(family)}`}>Удирдлага руу буцах</Link></header>
    <section className="admin-console__content">
      {loading && <p role="status">Ачаалж байна…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!loading && allowed && <><h2>Гишүүд</h2><ul className="admin-console__audit">{members.map((row) => <li key={row.user_id}><span>{row.display_name}</span><span>{row.role}</span></li>)}</ul>
        <h2>Урилга илгээх</h2><form className="admin-console__member" onSubmit={invite}>
          <label>Имэйл <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {owner && <label>Гишүүний төрөл <select value={role} onChange={(event) => setRole(event.target.value)}><option value="member">Гишүүн</option><option value="editor">Засварлагч</option></select></label>}
          <button disabled={busy}>Урилга илгээх</button>
        </form>
        <h2>Идэвхтэй урилга</h2><ul className="admin-console__audit">{invitations.map((row) => <li key={row.id}><span>{row.email} ({row.role})</span><button type="button" disabled={busy} onClick={() => void revoke(row.id)}>Цуцлах</button></li>)}</ul>
      </>}
    </section></main>;
}
