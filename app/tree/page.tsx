'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family, PersonSearchPage, personName, Person, TreeData, TreePerson } from '../../lib/api';

type RelationKind = 'parent' | 'child' | 'spouse';

function generationRows(tree: TreeData) {
  const levels = new Map(tree.persons.map((person) => [person.id, 0]));
  for (let pass = 0; pass < tree.persons.length; pass++) {
    let changed = false;
    for (const edge of tree.parent_child_relationships) {
      const next = (levels.get(edge.parent_id) ?? 0) + 1;
      if (next > (levels.get(edge.child_id) ?? 0)) { levels.set(edge.child_id, next); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map<number, TreePerson[]>();
  for (const person of tree.persons) {
    const level = levels.get(person.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), person]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
}

export default function TreePage() {
  const router = useRouter();
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [tree, setTree] = useState<TreeData>({ persons: [], parent_child_relationships: [], marriages: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState<PersonSearchPage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchPageNumber, setSearchPageNumber] = useState(1);
  const [depth, setDepth] = useState(2);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState('');
  const [relation, setRelation] = useState<RelationKind | null>(null);
  const [relationError, setRelationError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (id: string, personId?: string, treeDepth = depth) => {
    const query = new URLSearchParams({ depth: String(treeDepth) });
    if (personId) query.set('person_id', personId);
    const [f, data] = await Promise.all([api<Family>(`/families/${id}`), api<TreeData>(`/families/${id}/tree?${query}`)]);
    setFamily(f); setTree(data);
  }, [depth]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('family') ?? '';
    const personId = params.get('person') ?? undefined;
    if (!id) { router.replace('/families'); return; }
    setFamilyId(id);
    load(id, personId).catch((cause) => {
      if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
      else setError(cause instanceof Error ? cause.message : 'Ургийн модыг ачаалж чадсангүй.');
    }).finally(() => setBusy(false));
  }, [load, router]);
  useEffect(() => {
    const query = search.trim();
    if (!familyId || !query) { setSearchPage(null); return; }
    const timer = window.setTimeout(() => {
      setSearchBusy(true);
      api<PersonSearchPage>(`/families/${familyId}/persons/search?q=${encodeURIComponent(query)}&page=1&page_size=25`)
        .then((result) => { setSearchPage(result); setSearchPageNumber(1); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : 'Хайлт хийхэд алдаа гарлаа.'))
        .finally(() => setSearchBusy(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [familyId, search]);
  useEffect(() => {
    const root = tree.root_person_id;
    if (!root) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-person-id="${root}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [tree.root_person_id, tree.persons]);
  const rows = useMemo(() => generationRows(tree), [tree]);
  const peopleToShow = new Set(tree.persons.map((person) => person.id));
  async function selectSearchResult(personId: string) {
    setBusy(true); setError(''); setSearchPage(null);
    try { await load(familyId, personId, depth); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Хүний ургийн модыг нээж чадсангүй.'); }
    finally { setBusy(false); }
  }
  async function loadMoreSearch() {
    if (!searchPage?.has_next) return;
    const nextPage = searchPageNumber + 1;
    setSearchBusy(true);
    try {
      const next = await api<PersonSearchPage>(`/families/${familyId}/persons/search?q=${encodeURIComponent(search.trim())}&page=${nextPage}&page_size=25`);
      setSearchPage((current) => current ? { ...next, items: [...current.items, ...next.items] } : next);
      setSearchPageNumber(nextPage);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Хайлтын үр дүнг ачаалж чадсангүй.'); }
    finally { setSearchBusy(false); }
  }
  async function addRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!relation || !selected) return;
    setRelationError('');
    const form = new FormData(event.currentTarget);
    const existingId = String(form.get('existing') ?? '');
    try {
      let relatedId = existingId;
      if (!relatedId) {
        const fullName = String(form.get('name') ?? '').trim().split(/\s+/).filter(Boolean);
        const created = await api<Person>(`/families/${familyId}/persons`, { method: 'POST', body: JSON.stringify({ first_name: fullName.at(-1) ?? '', last_name: fullName.slice(0, -1).join(' '), gender: form.get('gender'), visibility: 'family' }) });
        relatedId = created.id;
      }
      if (relation === 'spouse') {
        await api(`/families/${familyId}/marriages`, { method: 'POST', body: JSON.stringify({ person_1_id: selected, person_2_id: relatedId, status: 'married', start_date: form.get('start_date') || null }) });
      } else {
        await api(`/families/${familyId}/relationships/parent-child`, { method: 'POST', body: JSON.stringify({ parent_id: relation === 'parent' ? relatedId : selected, child_id: relation === 'parent' ? selected : relatedId, relationship_type: form.get('relationship_type') }) });
      }
      await load(familyId); setRelation(null); setNotice('Гэр бүлийн холбоо хадгалагдлаа.');
    } catch (cause) { setRelationError(cause instanceof Error ? cause.message : 'Холбоог хадгалж чадсангүй.'); }
  }
  async function divorce(id: string) {
    const endDate = window.prompt('Салсан огноо (YYYY-MM-DD). Мэдэхгүй бол хоосон үлдээнэ үү.');
    if (endDate === null) return;
    try { await api(`/families/${familyId}/marriages/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'divorced', end_date: endDate || null }) }); await load(familyId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Гэрлэлтийн мэдээллийг шинэчилж чадсангүй.'); }
  }
  if (busy) return <main className="mvp"><section className="mvpbox">Ургийн модыг ачаалж байна…</section></main>;
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 1250 }}>
    <div className="row space toolbar"><div><Link href="/families">← Гэр бүлүүд</Link><h1 style={{ marginTop: 15 }}>{family?.name ?? 'Ургийн мод'}</h1></div><div className="row"><Link className="button" href={`/memories?family=${familyId}`}>Дурсамж</Link><button onClick={() => setZoom((v) => Math.max(.55, v - .1))} aria-label="Жижигрүүлэх">−</button><button onClick={() => setZoom(1)}>Тааруулах</button><button onClick={() => setZoom((v) => Math.min(1.6, v + .1))} aria-label="Томруулах">＋</button></div></div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success">{notice}</div>}
    <div className="row space"><p>{tree.persons.length} хүн · {tree.marriages.length} гэрлэлтийн бүртгэл{tree.meta?.truncated ? ' · хэсэгчлэн ачаалсан' : ''}</p><label>Үеийн хүрээ<select value={depth} onChange={(event) => { const next = Number(event.target.value); setDepth(next); void load(familyId, tree.root_person_id ?? undefined, next).catch((cause) => setError(cause instanceof Error ? cause.message : 'Модыг шинэчилж чадсангүй.')); }}><option value={1}>1 үе</option><option value={2}>2 үе</option><option value={3}>3 үе</option><option value={4}>4 үе</option><option value={5}>5 үе</option></select></label></div>
    <label>Гэр бүлийн хүн хайх<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Нэрээр хайх…" /></label>
    {searchBusy && <p className="muted" role="status">Хайж байна…</p>}
    {search.trim() && searchPage && <section className="card" aria-label="Хайлтын үр дүн"><p>{searchPage.total} үр дүн</p>{searchPage.items.length === 0 ? <p>Тохирох хүн олдсонгүй.</p> : searchPage.items.map((item) => <button key={item.id} style={{ margin: 4 }} onClick={() => void selectSearchResult(item.id)}>{item.name}{item.birth_year ? ` · ${item.birth_year}` : ''} · Модонд харах</button>)}{searchPage.has_next && <button onClick={() => void loadMoreSearch()} disabled={searchBusy}>Дараагийн үр дүн</button>}</section>}
    {tree.persons.length === 0 ? <div className="card"><p>Одоогоор хүн нэмээгүй байна.</p><Link className="button" href="/onboarding">Өөрийгөө нэмэх</Link></div> : <div className="tree-scroll"><div className="generations" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${100 / zoom}%` }}>
      {rows.map(([generation, persons]) => <div className="generation" key={generation}><span className="tag">{generation + 1}-р үе</span>{persons.filter((person) => peopleToShow.has(person.id)).map((person) => {
        const parents = tree.parent_child_relationships.filter((r) => r.child_id === person.id).length;
        const children = tree.parent_child_relationships.filter((r) => r.parent_id === person.id).length;
        const spouses = tree.marriages.filter((r) => r.person_1_id === person.id || r.person_2_id === person.id);
        const parentNames = tree.parent_child_relationships.filter((r) => r.child_id === person.id).map((r) => tree.persons.find((p) => p.id === r.parent_id)).filter((p): p is TreePerson => Boolean(p)).map(personName);
        const childNames = tree.parent_child_relationships.filter((r) => r.parent_id === person.id).map((r) => tree.persons.find((p) => p.id === r.child_id)).filter((p): p is TreePerson => Boolean(p)).map(personName);
        const spouseNames = [...new Set(spouses.map((r) => tree.persons.find((p) => p.id === (r.person_1_id === person.id ? r.person_2_id : r.person_1_id))).filter((p): p is TreePerson => Boolean(p)).map(personName))];
        return <article className="card person-card" data-person-id={person.id} key={person.id} style={person.id === tree.root_person_id ? { outline: '2px solid #d7b266' } : undefined}><button style={{ width: '100%' }} onClick={() => router.push(`/profile?family=${familyId}&person=${person.id}`)}><strong>{personName(person)}</strong><span className="muted" style={{ display: 'block', marginTop: 6 }}>{person.birth_date?.slice(0, 4) ?? '—'} – {person.is_alive ? '' : person.death_date?.slice(0, 4) ?? '?'}</span><span className="muted" style={{ display: 'block', marginTop: 4 }}>{parents} эцэг/эх · {children} хүүхэд · {new Set(spouses.map((m) => m.person_1_id === person.id ? m.person_2_id : m.person_1_id)).size} хань</span></button><div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><button aria-label="Эцэг эх нэмэх" onClick={() => {setSelected(person.id);setRelation('parent')}}>+ Эцэг/эх</button><button aria-label="Хүүхэд нэмэх" onClick={() => {setSelected(person.id);setRelation('child')}}>+ Хүүхэд</button><button aria-label="Хань нэмэх" onClick={() => {setSelected(person.id);setRelation('spouse')}}>+ Гэрлэлт</button></div>{spouses.map((m) => <div key={m.id} className="muted" style={{ marginTop: 6, fontSize: 11 }}>{m.status === 'married' ? 'Идэвхтэй' : m.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'} · {m.start_date ?? 'эхэлсэн он тодорхойгүй'} – {m.end_date ?? (m.status === 'married' ? 'одоо' : 'дууссан он тодорхойгүй')}{m.status === 'married' && <button style={{ marginLeft: 8, fontSize: 11 }} onClick={() => divorce(m.id)}>Салалтыг бүртгэх</button>}</div>)}{(parentNames.length > 0 || spouseNames.length > 0 || childNames.length > 0) && <div className="muted" style={{ borderTop: '1px solid #285847', marginTop: 10, paddingTop: 8, textAlign: 'left', lineHeight: 1.5 }}>{parentNames.length > 0 && <div>Эцэг эх: {parentNames.join(', ')}</div>}{spouseNames.length > 0 && <div>Хань: {spouseNames.join(', ')}</div>}{childNames.length > 0 && <div>Хүүхэд: {childNames.join(', ')}</div>}</div>}</article>;
      })}</div>)}
    </div></div>}
    <p className="muted">Эцэг эх-хүүхдийн холбоо болон гэрлэлт тусдаа хадгалагдана. Салалт хүүхдийн холбоонд нөлөөлөхгүй.</p>
  </section>{relation && <div className="modal-backdrop" onClick={() => setRelation(null)}><section className="modal" onClick={(e) => e.stopPropagation()}><div className="row space"><h2>{relation === 'parent' ? 'Эцэг эх нэмэх' : relation === 'child' ? 'Хүүхэд нэмэх' : 'Гэрлэлт нэмэх'}</h2><button onClick={() => setRelation(null)}>Хаах</button></div>{relationError && <div className="error" role="alert">{relationError}</div>}<form onSubmit={addRelation}><label>Одоо байгаа хүнээс сонгох<select name="existing" defaultValue=""><option value="">Шинэ хүн үүсгэх</option>{tree.persons.filter((p) => p.id !== selected).map((p) => <option value={p.id} key={p.id}>{personName(p)}</option>)}</select></label><label>Шинэ хүний нэр<input name="name" maxLength={360} /></label><label>Хүйс<select name="gender" defaultValue="unknown"><option value="unknown">Тодорхойгүй</option><option value="male">Эрэгтэй</option><option value="female">Эмэгтэй</option><option value="other">Бусад</option></select></label>{relation === 'spouse' ? <label>Гэрлэсэн огноо<input name="start_date" type="date" /></label> : <label>Холбооны төрөл<select name="relationship_type"><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option></select></label>}<button className="primary" type="submit">Холбоог хадгалах</button></form></section></div>}</main>;
}
