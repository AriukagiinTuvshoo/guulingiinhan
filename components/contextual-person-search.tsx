 'use client';
import { useEffect, useState } from 'react';
import { api, PersonSearchPage } from '../lib/api';
export default function ContextualPersonSearch({ familyId, onSelect }: { familyId: string; onSelect: (id: string, name: string) => void }) {
  const [q, setQ] = useState(''); const [data, setData] = useState<PersonSearchPage | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    setData(null); setError(''); if (!q.trim()) return; const controller = new AbortController();
    const timer = window.setTimeout(() => void api<PersonSearchPage>(`/families/${familyId}/persons/search?q=${encodeURIComponent(q.trim())}&page_size=12`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Хүний хайлт амжилтгүй боллоо.'); }), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [familyId, q]);
  return <div className="heritage-person-search"><label>Холбоотой хүн<input value={q} onChange={(event) => setQ(event.target.value)} maxLength={120} placeholder="Хүний нэрээр хайх…" autoComplete="off" /></label>
    {error && <p role="alert">{error}</p>}
    {data && <div className="memory-person-results">{data.items.length ? data.items.map((person) => <button type="button" key={person.id} onClick={() => { onSelect(person.id, person.name); setQ(''); }}><strong>{person.name}</strong><small>{[person.birth_year, person.branch_name ?? person.family_name].filter(Boolean).join(' · ')}</small></button>) : <p>Хүн олдсонгүй.</p>}</div>}
  </div>;
}
