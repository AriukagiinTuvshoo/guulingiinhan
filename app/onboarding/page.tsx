'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Family, User } from '../../lib/api';

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts.at(-1) ?? '', last_name: parts.slice(0, -1).join(' ') };
}

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<User>('/auth/me').catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const values = new FormData(event.currentTarget);
    try {
      const family = await api<Family>('/families', { method: 'POST', body: JSON.stringify({ name: values.get('family') }) });
      const me = await api<{ id: string }>(`/families/${family.id}/persons`, {
        method: 'POST', body: JSON.stringify({ ...splitName(String(values.get('name'))), gender: values.get('gender'), visibility: 'family' }),
      });
      await api(`/families/${family.id}/persons/${me.id}/link-me`, { method: 'POST' });
      for (const [key, type] of [['father', 'biological'], ['mother', 'biological']] as const) {
        const name = String(values.get(key) ?? '').trim();
        if (!name) continue;
        const parent = await api<{ id: string }>(`/families/${family.id}/persons`, {
          method: 'POST', body: JSON.stringify({ ...splitName(name), gender: key === 'father' ? 'male' : 'female', visibility: 'family' }),
        });
        await api(`/families/${family.id}/relationships/parent-child`, {
          method: 'POST', body: JSON.stringify({ parent_id: parent.id, child_id: me.id, relationship_type: type }),
        });
      }
      router.push(`/tree?family=${family.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Гэр бүлийг үүсгэж чадсангүй.');
    } finally { setBusy(false); }
  }
  if (loading) return <main className="mvp"><section className="mvpbox">Ачаалж байна…</section></main>;
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 580 }}>
    <Link href="/families">← Гэр бүлүүд</Link><h1 style={{ marginTop: 22 }}>Ургийн модоо эхлүүлэх</h1><p>Гэр бүлээ үүсгээд өөрийгөө бүртгэж, хүсвэл эцэг эхээ нэмнэ.</p>
    {error && <div className="error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label>Гэр бүлийн нэр<input name="family" placeholder="ГУУЛИНГИЙНХАН" maxLength={180} required /></label>
      <label>Таны нэр<input name="name" autoComplete="name" required maxLength={360} /></label>
      <label>Хүйс<select name="gender" defaultValue="unknown"><option value="unknown">Тодорхойгүй</option><option value="male">Эрэгтэй</option><option value="female">Эмэгтэй</option><option value="other">Бусад</option></select></label>
      <div className="row"><label style={{ flex: 1 }}>Эцгийн нэр<input name="father" maxLength={360} /></label><label style={{ flex: 1 }}>Эхийн нэр<input name="mother" maxLength={360} /></label></div>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Үүсгэж байна…' : 'Гэр бүлээ үүсгэх'}</button>
    </form>
  </section></main>;
}
