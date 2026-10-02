'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import './shared-ancestry.css';

type SharedPerson = { id: string; first_name: string; last_name: string; middle_name: string | null; gender: string; birth_date: string | null; is_alive: boolean; death_date: string | null; shared_by_me: boolean };
type SharedEdge = { id: string; parent_id: string; child_id: string; relationship_type: string };
type SharedTree = { name: string; root_person_id: string | null; persons: SharedPerson[]; relationships: SharedEdge[]; my_person_id: string | null };

function label(person: SharedPerson) { return [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' '); }
function years(person: SharedPerson) {
  const birth = person.birth_date?.slice(0, 4); const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} — ${death}`;
  if (birth) return person.is_alive ? `${birth} — одоо` : `${birth} — огноо тодорхойгүй`;
  return person.is_alive ? 'Амьд · он тодорхойгүй' : 'Нас барсан · он тодорхойгүй';
}

export default function SharedAncestryPage() {
  const [tree, setTree] = useState<SharedTree | null>(null); const [busy, setBusy] = useState(true);
  const [parentId, setParentId] = useState(''); const [relationshipType, setRelationshipType] = useState('biological');
  const [consent, setConsent] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const loaded = await api<SharedTree>('/shared-lineage');
      setTree(loaded);
      const ownEdge = loaded.relationships.find((edge) => edge.child_id === loaded.my_person_id);
      setParentId(ownEdge?.parent_id ?? '');
      setRelationshipType(ownEdge?.relationship_type ?? 'biological');
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Нийтлэг модыг ачаалж чадсангүй.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const personById = useMemo(() => new Map((tree?.persons ?? []).map((person) => [person.id, person])), [tree]);
  const children = useMemo(() => {
    const rows = new Map<string, SharedPerson[]>();
    for (const edge of tree?.relationships ?? []) { const person = personById.get(edge.child_id); if (person) rows.set(edge.parent_id, [...(rows.get(edge.parent_id) ?? []), person]); }
    return rows;
  }, [personById, tree]);
  const linked = Boolean(tree?.my_person_id && tree.persons.some((person) => person.id === tree.my_person_id));
  const ownName = tree?.my_person_id ? personById.get(tree.my_person_id) : undefined;

  async function join() {
    if (!tree?.my_person_id || !consent || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<SharedTree>('/shared-lineage/join', { method: 'POST', body: JSON.stringify({ person_id: tree.my_person_id, parent_person_id: parentId || null, relationship_type: relationshipType, share_consent: consent }) });
      setTree(updated); setConsent(false); setParentId(''); setNotice('Таны хүн нийтлэг модонд нэмэгдлээ.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Холбоход алдаа гарлаа.'); }
    finally { setSaving(false); }
  }
  async function savePlacement() {
    if (saving) return;
    const myPersonId = tree?.my_person_id;
    const hasCurrentParent = tree?.relationships.some((edge) => edge.child_id === myPersonId);
    if (!parentId && hasCurrentParent && !window.confirm('Таны үеийн холбоосыг арилгаж, нийтлэг модонд тусдаа салаа болгох уу? Хүний бүртгэл хадгалагдана.')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<SharedTree>('/shared-lineage/relationships/me', {
        method: 'PUT',
        body: JSON.stringify({ parent_person_id: parentId || null, relationship_type: relationshipType }),
      });
      setTree(updated);
      setNotice(parentId ? 'Таны үеийн холбоог шинэчиллээ.' : 'Таны хүн үндсэн модноос тусдаа салаа боллоо. Бүртгэл хэвээр үлдсэн.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Холбоог шинэчилж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function leave() {
    if (!window.confirm('Таны хүнийг нийтлэг модноос салгана. Гэр бүлийн өөрийн мод болон бүртгэл устахгүй. Үргэлжлүүлэх үү?')) return;
    setSaving(true); setError(''); setNotice('');
    try { await api<void>('/shared-lineage/people/me', { method: 'DELETE' }); await load(); setNotice('Таны хүнийг нийтлэг модноос салгалаа.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Салгах боломжгүй байна.'); }
    finally { setSaving(false); }
  }
  function renderPerson(person: SharedPerson, depth: number, trail: Set<string>): React.ReactNode {
    if (trail.has(person.id)) return null; const nextTrail = new Set(trail); nextTrail.add(person.id);
    const next = children.get(person.id) ?? [];
    return <li key={person.id} className="shared-tree__node"><article className={'shared-person' + (person.id === tree?.root_person_id ? ' is-root' : '')}>
      <span className="shared-person__generation">{person.id === tree?.root_person_id ? 'УДМЫН ЭХ' : depth === 0 ? 'ХОЛБООГҮЙ САЛАА' : `${depth} · ҮЕ`}</span>
      <span className="shared-person__avatar" aria-hidden="true">{(person.last_name || person.first_name).slice(0, 1).toLocaleUpperCase('mn-MN')}</span>
      <strong>{label(person)}</strong><small>{years(person)}</small>
      {person.id === tree?.my_person_id && <em>{person.shared_by_me ? 'Таны бүртгэл' : 'Тантай холбогдсон'}</em>}
      <span className="shared-person__scope">Нийтлэг модны мэдээлэл</span>
    </article>{next.length > 0 && <ul>{next.map((child) => renderPerson(child, depth + 1, nextTrail))}</ul>}</li>;
  }

  return <main className="shared-ancestry">
    <header className="shared-ancestry__hero"><div><span>🌳 НЭГ УДАМ · ОЛОН САЛАА</span><h1>Гуулингийнхны их мод</h1><p>Системийн admin үндсэн удмын эхийг тогтооно. Гишүүн бүр өөрийн хүнийг нэмэх, холбоосоо сонгох эрхтэй.</p></div><div className="shared-ancestry__count"><strong>{tree?.persons.length ?? 0}</strong><span>зөвшөөрсөн хүн</span></div></header>
    {error && <p className="shared-ancestry__alert" role="alert">{error}</p>}{notice && <p className="shared-ancestry__notice" role="status">{notice}</p>}
    {busy ? <p className="shared-ancestry__empty" role="status">Модыг ачаалж байна…</p> : !tree?.root_person_id ? <section className="shared-ancestry__empty"><span>🪴</span><h2>Үндсэн удмын эхийг тохируулж байна</h2><p>Системийн admin бодит хүнийг эх болгон сонгосны дараа нийтлэг мод энд харагдана.</p></section> : <section className="shared-tree" aria-label="Гуулингийнхны нийтлэг удмын мод"><div className="shared-tree__legend"><span>Үе хоорондын холбоо баталгаатай эцэг/эх, хүүхдийн бүртгэлээр зурна.</span><span>Холбоогүй салбар үндсэн модноос тусдаа байна.</span></div><ul className="shared-tree__roots">{tree.persons.filter((person) => person.id === tree.root_person_id).map((person) => renderPerson(person, 0, new Set()))}</ul>{tree.persons.some((person) => person.id !== tree.root_person_id && !tree.relationships.some((edge) => edge.child_id === person.id)) && <section className="shared-tree__unlinked" aria-label="Үндсэн модонд холбоогүй салаа"><h2>Үндсэн модонд холбоогүй салаа 🌱</h2><p>Эдгээр хүмүүс нийтлэг санд зөвшөөрлөөр орсон боловч үеийн холбоогоо сонгоогүй байна.</p><ul className="shared-tree__roots">{tree.persons.filter((person) => person.id !== tree.root_person_id && !tree.relationships.some((edge) => edge.child_id === person.id)).map((person) => renderPerson(person, 0, new Set()))}</ul></section>}</section>}
    <section className="shared-join"><div><span>🌱 ТАНЫ САЛАА</span><h2>{linked ? 'Та нийтлэг модонд холбогдсон байна' : 'Өөрийн хүнийг модонд нэмэх'}</h2><p>Өөрийн account-тай холбосон хүнийг л нийтлэг модонд оруулна. Хувийн архив, дурсамж болон гэр бүлийн тусдаа мод хэвээр үлдэнэ.</p></div>
      {linked ? <div className="shared-join__form"><strong>{ownName ? label(ownName) : 'Таны бүртгэлтэй хүн'} · нийтлэг модонд орсон</strong><label>Хэний үр удам гэж холбох вэ?<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Үеийн холбоогүй салбар болгох</option>{tree?.persons.filter((person) => person.id !== tree.my_person_id).map((person) => <option key={person.id} value={person.id}>{label(person)}</option>)}</select></label>{parentId && <label>Холбооны төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select></label>}<button type="button" disabled={saving} onClick={() => void savePlacement()}>{saving ? 'Хадгалж байна…' : '🌿 Холбоогоо шинэчлэх'}</button><button type="button" disabled={saving} className="shared-join__danger" onClick={() => void leave()}>{saving ? 'Ажиллаж байна…' : 'Нийтлэг модноос гарах'}</button><small>Буруу эцэг/эх сонгосон бол эндээс өөрчилнө. Салбараа салгахад таны гэр бүлийн бүртгэл устахгүй.</small></div> : !tree?.my_person_id ? <div className="shared-join__empty">Таны account хүнтэй холбогдоогүй байна. Эхлээд өөрийн гэр бүлийн мод → Хүмүүс хэсгээс бүртгэлтэй хүнтэйгээ холбогдоорой. <Link href="/tree">Өөрийн мод руу →</Link></div> : <div className="shared-join__form">
        <label>Нийтлэг модонд байгаа эцэг/эх (заавал биш)<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Одоохондоо холбоосгүй салаа</option>{tree.persons.filter((person) => person.id !== tree.my_person_id).map((person) => <option key={person.id} value={person.id}>{label(person)}</option>)}</select></label>
        {parentId && <label>Холбооны төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select></label>}
        <label className="shared-join__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Миний нэр, удмын товч мэдээлэл болон сонгосон холбоос энэ сайтад нэвтэрсэн бүх account-д харагдахыг зөвшөөрч байна.</span></label>
        <button type="button" disabled={saving || !consent} onClick={() => void join()}>{saving ? 'Холбож байна…' : '🌿 Нийтлэг модонд нэмэх'}</button>
      </div>}
    </section><p className="shared-ancestry__privacy">Энэ үйлдэл таны Family-г нэгтгэхгүй. Бүртгэл болон хувийн түүхээ өөрийн гэр бүлийн орчноос удирдана.</p>
  </main>;
}
