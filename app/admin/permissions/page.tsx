'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import '../admin.css';

type MemberGrant = { user_id: string; display_name: string; role: string; scopes: string[] };
const labels: Record<string, string> = { view_audit: 'Үйлдлийн бүртгэл харах', manage_trash: 'Хогийн сав сэргээх', manage_settings: 'Гэр бүлийн тохиргоо өөрчлөх', manage_members: 'Гишүүний урилга удирдах', manage_people: 'Хүмүүс удирдах', manage_content: 'Түүх болон архив удирдах' };

export default function PermissionsPage() {
  const [family, setFamily] = useState('');
  const [members, setMembers] = useState<MemberGrant[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? '';
    const controller = new AbortController();
    if (!id) { setError('Гэр бүл сонгоно уу.'); setLoading(false); return; }
    setFamily(id);
    api<MemberGrant[]>(`/families/${encodeURIComponent(id)}/admin-grants`, { signal: controller.signal })
      .then((rows) => { if (!controller.signal.aborted) { setMembers(rows); setLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setError('Зөвхөн эзэмшигч эрх өөрчилнө.'); setLoading(false); } });
    return () => controller.abort();
  }, []);
  function toggle(userId: string, scope: string) {
    setMembers((current) => current.map((member) => member.user_id !== userId ? member : {
      ...member, scopes: member.scopes.includes(scope) ? member.scopes.filter((item) => item !== scope) : [...member.scopes, scope],
    }));
    setNotice('');
  }
  async function save(member: MemberGrant) {
    if (busy) return;
    setBusy(member.user_id); setError(''); setNotice('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/admin-grants/${encodeURIComponent(member.user_id)}`, { method: 'PUT', body: JSON.stringify({ scopes: member.scopes }) });
      setNotice('Эрх хадгалагдлаа.');
    } catch { setError('Эрх хадгалж чадсангүй.'); }
    finally { setBusy(''); }
  }
  return <main className="admin-console"><header className="admin-console__header"><h1>Админ эрх</h1><Link href={`/admin?family=${encodeURIComponent(family)}`}>Удирдлага руу буцах</Link></header>
    <section className="admin-console__content"><p>Эрх нь зөвхөн энэ гэр бүлд үйлчилнэ. Guardian болон хувийн мэдээллийн шалгалтыг орлохгүй.</p>
      {loading && <p role="status">Ачаалж байна…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!loading && !members.length && !error && <p>Бусад гишүүн алга.</p>}
      {members.map((member) => <fieldset className="admin-console__member" key={member.user_id} disabled={!!busy}><legend>{member.display_name} ({member.role})</legend>
        {Object.entries(labels).map(([scope, label]) => <label key={scope}><input type="checkbox" checked={member.scopes.includes(scope)} onChange={() => toggle(member.user_id, scope)} /> {label}</label>)}
        <button onClick={() => void save(member)}>{busy === member.user_id ? 'Хадгалж байна…' : 'Хадгалах'}</button>
      </fieldset>)}
    </section></main>;
}
