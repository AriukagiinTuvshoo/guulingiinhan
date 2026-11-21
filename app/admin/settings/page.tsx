'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, Family } from '../../../lib/api';
import '../admin.css';

export default function AdminSettingsPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family');
    if (!id) { setError('Гэр бүл сонгоно уу.'); return; }
    const controller = new AbortController();
    Promise.all([
      api<Family>(`/families/${encodeURIComponent(id)}`, { signal: controller.signal }),
      api<{ scopes: string[] }>(`/families/${encodeURIComponent(id)}/admin-access`, { signal: controller.signal }),
    ]).then(([result, access]) => {
      if (controller.signal.aborted) return;
      if (!access.scopes.includes('manage_settings')) { setError('Тохиргоо өөрчлөх эрхгүй.'); return; }
      setFamily(result); setName(result.name); setDescription(result.description ?? '');
    }).catch(() => { if (!controller.signal.aborted) setError('Тохиргоог ачаалж чадсангүй.'); });
    return () => controller.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!family || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<Family>(`/families/${encodeURIComponent(family.id)}`, { method: 'PATCH', body: JSON.stringify({ name, description: description || null }) });
      setFamily(result); setNotice('Тохиргоо хадгалагдлаа.');
    } catch { setError('Тохиргоог хадгалж чадсангүй.'); }
    finally { setBusy(false); }
  }
  return <main className="admin-console"><header className="admin-console__header"><h1>Гэр бүлийн тохиргоо</h1><Link href={`/admin?family=${encodeURIComponent(family?.id ?? '')}`}>Удирдлага руу буцах</Link></header>
    <section className="admin-console__content">
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {family && <form className="admin-console__member" onSubmit={save}>
        <label>Нэр <input value={name} required maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
        <label>Тайлбар <textarea value={description} maxLength={10000} onChange={(event) => setDescription(event.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Хадгалж байна…' : 'Хадгалах'}</button>
      </form>}
    </section>
  </main>;
}
