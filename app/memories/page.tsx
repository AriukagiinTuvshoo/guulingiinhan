'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, personName, Person } from '../../lib/api';

type Memory = { id: string; title: string; description: string | null; memory_date: string | null; visibility: string; person_ids: string[]; created_at: string };

export default function MemoriesPage() {
  const router = useRouter(); const [family, setFamily] = useState(''); const [people, setPeople] = useState<Person[]>([]); const [memories, setMemories] = useState<Memory[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function load(id: string) {
    const [p, m] = await Promise.all([api<Person[]>(`/families/${id}/persons`), api<Memory[]>(`/families/${id}/memories`)]);
    setPeople(p); setMemories(m);
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? ''; setFamily(id);
    if (!id) { router.replace('/families'); return; }
    load(id).catch((cause) => { if (cause instanceof ApiError && cause.status === 401) router.replace('/login'); else setError(cause instanceof Error ? cause.message : 'Дурсамжийг ачаалж чадсангүй.'); });
  }, [router]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setError('');
    try {
      const personIds = form.getAll('person_ids').map(String);
      await api(`/families/${family}/memories`, { method: 'POST', body: JSON.stringify({ title: form.get('title'), description: form.get('description') || null, memory_date: form.get('memory_date') || null, visibility: form.get('visibility'), person_ids: personIds }) });
      formElement.reset(); await load(family);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Дурсамж хадгалж чадсангүй.'); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('Энэ дурсамжийг устгах уу?')) return;
    try { await api(`/families/${family}/memories/${id}`, { method: 'DELETE' }); await load(family); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Устгаж чадсангүй.'); }
  }
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 980 }}><Link href={`/tree?family=${family}`}>← Ургийн мод</Link><h1 style={{ marginTop: 22 }}>Гэр бүлийн дурсамж</h1>{error && <div className="error" role="alert">{error}</div>}
    <div className="cards"><section className="card"><h2>Дурсамж нэмэх</h2><form onSubmit={create}><label>Гарчиг<input name="title" maxLength={180} required /></label><label>Огноо<input name="memory_date" type="date" /></label><label>Тайлбар<textarea name="description" maxLength={20000} /></label><label>Холбоотой хүмүүс<select name="person_ids" multiple size={Math.min(6, Math.max(3, people.length))}>{people.map((person) => <option value={person.id} key={person.id}>{personName(person)}</option>)}</select><small className="muted">Олон хүн сонгох бол Ctrl (Windows) эсвэл Command (Mac) дарна.</small></label><label>Харагдах байдал<select name="visibility"><option value="family">Гэр бүлийнхэн</option><option value="private">Зөвхөн би</option><option value="public">Нийтийн</option></select></label><button className="primary" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Дурсамж хадгалах'}</button></form><p className="muted">Зураг хадгалах сан холбогдоогүй тул одоогоор зөвхөн текст хадгална.</p></section>
    <section className="card"><h2>Хадгалсан дурсамж</h2>{memories.length === 0 ? <p>Дурсамж одоогоор алга.</p> : memories.map((memory) => <article key={memory.id} style={{ padding: '14px 0', borderBottom: '1px solid #285847' }}><span className="tag">{memory.memory_date ?? 'Огноогүй'}</span><h3>{memory.title}</h3>{memory.description && <p>{memory.description}</p>}<p className="muted">{memory.person_ids.map((id) => people.find((person) => person.id === id)).filter((person): person is Person => Boolean(person)).map(personName).join(' · ')}</p><button onClick={() => remove(memory.id)}>Устгах</button></article>)}</section></div>
  </section></main>;
}
