'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, PersonSearchPage } from '../../lib/api';

type Memory = {
  id: string;
  title: string;
  description: string | null;
  memory_date: string | null;
  visibility: string;
  person_ids: string[];
  person_names?: string[];
  created_at: string;
};
type SelectedPerson = { id: string; name: string };

export default function MemoriesPage() {
  const router = useRouter();
  const [family, setFamily] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<PersonSearchPage | null>(null);
  const [personPage, setPersonPage] = useState(1);
  const [selectedPeople, setSelectedPeople] = useState<SelectedPerson[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(id: string) {
    setMemories(await api<Memory[]>(`/families/${id}/memories`));
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? '';
    setFamily(id);
    if (!id) { router.replace('/families'); return; }
    load(id).catch((cause) => {
      if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
      else setError(cause instanceof Error ? cause.message : 'Дурсамжийг ачаалж чадсангүй.');
    });
  }, [router]);

  useEffect(() => {
    const query = personQuery.trim();
    if (!family || !query) { setPersonResults(null); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      api<PersonSearchPage>(`/families/${family}/persons/search?q=${encodeURIComponent(query)}&page=1&page_size=20`)
        .then((result) => { if (active) { setPersonResults(result); setPersonPage(1); } })
        .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Хайлт хийхэд алдаа гарлаа.'); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [family, personQuery]);

  async function loadMorePeople() {
    if (!personResults?.has_next) return;
    const nextPage = personPage + 1;
    try {
      const next = await api<PersonSearchPage>(`/families/${family}/persons/search?q=${encodeURIComponent(personQuery.trim())}&page=${nextPage}&page_size=20`);
      setPersonResults((current) => current ? { ...next, items: [...current.items, ...next.items] } : next);
      setPersonPage(nextPage);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Үр дүнг ачаалж чадсангүй.'); }
  }

  function togglePerson(person: SelectedPerson) {
    setSelectedPeople((current) => current.some((item) => item.id === person.id)
      ? current.filter((item) => item.id !== person.id)
      : current.length >= 100 ? current : [...current, person]);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    try {
      await api(`/families/${family}/memories`, { method: 'POST', body: JSON.stringify({ title: form.get('title'), description: form.get('description') || null, memory_date: form.get('memory_date') || null, visibility: form.get('visibility'), person_ids: selectedPeople.map((person) => person.id) }) });
      formElement.reset();
      setSelectedPeople([]);
      setPersonQuery('');
      setPersonResults(null);
      await load(family);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Дурсамж хадгалж чадсангүй.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Энэ дурсамжийг устгах уу?')) return;
    try { await api(`/families/${family}/memories/${id}`, { method: 'DELETE' }); await load(family); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Устгаж чадсангүй.'); }
  }

  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 980 }}><Link href={`/tree?family=${family}`}>← Ургийн мод</Link><h1 style={{ marginTop: 22 }}>Гэр бүлийн дурсамж</h1>{error && <div className="error" role="alert">{error}</div>}
    <div className="cards"><section className="card"><h2>Дурсамж нэмэх</h2><form onSubmit={create}><label>Гарчиг<input name="title" maxLength={180} required /></label><label>Огноо<input name="memory_date" type="date" /></label><label>Тайлбар<textarea name="description" maxLength={20000} /></label><label>Холбоотой хүн хайх<input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Нэрээр хайх…" /></label><div className="row" aria-label="Сонгосон хүмүүс">{selectedPeople.map((person) => <button type="button" key={person.id} onClick={() => togglePerson(person)}>{person.name} ×</button>)}</div>{personQuery.trim() && personResults && <div className="card" aria-label="Хайлтын үр дүн">{personResults.items.length ? personResults.items.map((person) => { const selected = selectedPeople.some((item) => item.id === person.id); return <button type="button" key={person.id} aria-pressed={selected} style={{ margin: 4 }} onClick={() => togglePerson({ id: person.id, name: person.name })}>{selected ? '✓ ' : '+ '}{person.name}{person.birth_year ? ` · ${person.birth_year}` : ''}</button>; }) : <p>Тохирох хүн олдсонгүй.</p>}{personResults.has_next && <button type="button" onClick={() => void loadMorePeople()}>Дараагийн үр дүн</button>}</div>}{personQuery.trim() && !personResults && <p className="muted" role="status">Хайж байна…</p>}<label>Харагдах байдал<select name="visibility"><option value="family">Гэр бүлийнхэн</option><option value="private">Зөвхөн би</option><option value="public">Нийтийн</option></select></label><button className="primary" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Дурсамж хадгалах'}</button></form><p className="muted">Зураг хадгалах сан холбогдоогүй тул одоогоор зөвхөн текст хадгална.</p></section>
    <section className="card"><h2>Хадгалсан дурсамж</h2>{memories.length === 0 ? <p>Дурсамж одоогоор алга.</p> : memories.map((memory) => <article key={memory.id} style={{ padding: '14px 0', borderBottom: '1px solid #285847' }}><span className="tag">{memory.memory_date ?? 'Огноогүй'}</span><h3>{memory.title}</h3>{memory.description && <p>{memory.description}</p>}<p className="muted">{memory.person_names?.join(' · ') ?? `${memory.person_ids.length} холбоотой хүн`}</p><button onClick={() => void remove(memory.id)}>Устгах</button></article>)}</section></div>
  </section></main>;
}
