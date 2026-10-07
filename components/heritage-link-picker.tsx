'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { heritageLabels, HeritageKind, linkToken } from '../lib/heritage-links';
import ContextualPersonSearch from './contextual-person-search';

export default function HeritageLinkPicker({ familyId, value, onChange }: { familyId: string; value: string; onChange: (value: string) => void }) {
  const [kind, setKind] = useState<HeritageKind>('memory'); const [query, setQuery] = useState(''); const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [results, setResults] = useState<{ id: string; title: string }[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setResults([]); setError(''); setBusy(false); if (!query.trim() && kind !== 'event') return; if (kind === 'event' && !person) return;
    const controller = new AbortController(); const timer = window.setTimeout(() => { setBusy(true);
      const paths = { memory: 'memories', story: 'stories', archive: 'archives', event: `persons/${person?.id}/events` };
      void api<{ items: { id: string; title: string }[] } | { id: string; title: string }[]>(`/families/${familyId}/${paths[kind]}?q=${encodeURIComponent(query.trim())}&page_size=12`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setResults((Array.isArray(data) ? data.filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 12) : data.items)); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Материалын хайлт ачаалсангүй.'); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250); return () => { window.clearTimeout(timer); controller.abort(); };
  }, [familyId, kind, query, person]);
  const selected = [...value.matchAll(linkToken)];
  return <details className="content-link-picker"><summary>Түүх, дурсамж, архив, үйл явдалтай холбох</summary><p className="discovery-help">Материалын нэрийг харах эрхээр нь дахин шалгаж харуулна. Хувийн материалыг нийтэд нээхгүй.</p><label>Материалын төрөл<select value={kind} onChange={e => { setKind(e.target.value as HeritageKind); setQuery(''); }}>{(Object.keys(heritageLabels) as HeritageKind[]).map(k => <option key={k} value={k}>{heritageLabels[k]}</option>)}</select></label>{kind === 'event' && <>{person && <p>{person.name}</p>}<ContextualPersonSearch familyId={familyId} onSelect={(id, name) => setPerson({ id, name })} /></>}<label>Гарчгаар хайх<input value={query} onChange={e => setQuery(e.target.value)} maxLength={100} /></label>{busy && <p role="status">Хайж байна…</p>}{error && <p role="alert">{error}</p>}<ul>{results.map(item => <li key={item.id}><button type="button" disabled={selected.length >= 20 || value.includes(`[[link:${kind}:${item.id}]]`)} onClick={() => onChange(value + `\n\n[[link:${kind}:${item.id}]]`)}>{item.title} · Холбох</button></li>)}</ul>{!busy && !error && query.trim() && !results.length && <p>Илэрц олдсонгүй.</p>}{selected.length > 0 && <ul aria-label="Сонгосон холбоосууд">{selected.map((match, index) => <li key={`${match[1]}-${match[2]}-${index}`}><span>{heritageLabels[match[1] as HeritageKind]} · {index + 1} дэх холбоос </span><button type="button" onClick={() => onChange(value.replace(match[0], ''))}>Холбоосыг хасах</button></li>)}</ul>}</details>;
}
