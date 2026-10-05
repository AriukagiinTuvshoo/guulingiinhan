'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, Family } from '../../lib/api';
import { sharedAncestryPaths } from '../../lib/shared-ancestry';
import './shared-ancestry.css';

type SharedPerson = { id: string; first_name: string; last_name: string; middle_name: string | null; gender: string; birth_date: string | null; is_alive: boolean; death_date: string | null; shared_by_me: boolean };
type SharedEdge = { id: string; parent_id: string; child_id: string; relationship_type: string };
type SharedSpouse = { id: string; person_1_id: string; person_2_id: string; status: string };
type SharedTree = { name: string; root_person_id: string | null; root_partner_person_id: string | null; persons: SharedPerson[]; relationships: SharedEdge[]; spouses: SharedSpouse[]; my_person_id: string | null };

function label(person: SharedPerson) { return [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' '); }
function years(person: SharedPerson) {
  const birth = person.birth_date?.slice(0, 4); const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} — ${death}`;
  if (birth) return person.is_alive ? `${birth} — одоо` : `${birth} — огноо тодорхойгүй`;
  return person.is_alive ? 'Амьд · он тодорхойгүй' : 'Нас барсан · он тодорхойгүй';
}

export default function SharedAncestryPage() {
  const [tree, setTree] = useState<SharedTree | null>(null); const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [context, setContext] = useState<{ family: Family; personId: string; targetName: string } | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const loaded = await api<SharedTree>('/shared-lineage');
      setTree(loaded);
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Нийтлэг модыг ачаалж чадсангүй.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const familyId = params.get('family');
    const focusId = params.get('focus');
    if (!familyId || !focusId) return;
    void Promise.all([
      api<Family[]>('/families'),
      api<{ status: string; person_id: string | null; target_name: string | null }>(`/families/${encodeURIComponent(familyId)}/root-connection`),
    ]).then(([families, connection]) => {
      const family = families.find((item) => item.id === familyId);
      if (active && family && connection.status === 'approved' && connection.person_id === focusId) {
        setContext({ family, personId: focusId, targetName: connection.target_name || 'Салбар' });
      }
    }).catch(() => { /* Invalid Family context stays empty. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!tree) return;
    const focusedId = new URLSearchParams(window.location.search).get('focus');
    if (!focusedId || !tree.persons.some((person) => person.id === focusedId)) return;
    const timer = window.setTimeout(() => document.getElementById(`shared-person-${focusedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    return () => window.clearTimeout(timer);
  }, [tree]);
  const personById = useMemo(() => new Map((tree?.persons ?? []).map((person) => [person.id, person])), [tree]);
  const children = useMemo(() => {
    const rows = new Map<string, SharedPerson[]>();
    for (const edge of tree?.relationships ?? []) { const person = personById.get(edge.child_id); if (person && !(rows.get(edge.parent_id) ?? []).some((row) => row.id === person.id)) rows.set(edge.parent_id, [...(rows.get(edge.parent_id) ?? []), person]); }
    return rows;
  }, [personById, tree]);
  const linked = Boolean(tree?.my_person_id && tree.persons.some((person) => person.id === tree.my_person_id));
  const ownName = tree?.my_person_id ? personById.get(tree.my_person_id) : undefined;
  const root = tree?.root_person_id ? personById.get(tree.root_person_id) : undefined;
  const rootPartner = tree?.root_partner_person_id ? personById.get(tree.root_partner_person_id) : undefined;
  const firstGeneration = [...new Map([...(root ? children.get(root.id) ?? [] : []), ...(rootPartner ? children.get(rootPartner.id) ?? [] : [])].map((person) => [person.id, person])).values()];
  const paths = useMemo(() => sharedAncestryPaths(tree), [tree]);
  const unlinked = (tree?.persons ?? []).filter((person) => !paths.has(person.id) && !tree?.relationships.some((edge) => edge.child_id === person.id && !paths.has(edge.parent_id)));

  function renderPerson(person: SharedPerson, depth: number, trail: Set<string>): React.ReactNode {
    if (trail.has(person.id)) return null; const nextTrail = new Set(trail); nextTrail.add(person.id);
    const partners = (tree?.spouses || []).filter((pair) => pair.person_1_id === person.id || pair.person_2_id === person.id).map((pair) => personById.get(pair.person_1_id === person.id ? pair.person_2_id : pair.person_1_id)).filter((partner): partner is SharedPerson => Boolean(partner && !trail.has(partner.id)));
    for (const partner of partners) nextTrail.add(partner.id);
    const next = [...new Map([...(children.get(person.id) || []), ...partners.flatMap((partner) => children.get(partner.id) || [])].map((child) => [child.id, child])).values()];
    return <li key={person.id} className="shared-tree__node"><article id={`shared-person-${person.id}`} className={'shared-person' + (person.id === tree?.root_person_id ? ' is-root' : '') + (person.id === context?.personId ? ' is-focused' : '')}>
      <span className="shared-person__generation">{person.id === tree?.root_person_id || person.id === tree?.root_partner_person_id ? 'УДМЫН ЭХ' : depth === 0 ? 'ХОЛБООГҮЙ САЛАА' : depth === 1 ? 'ЭХНИЙ ҮНДСЭН САЛАА' : `${depth} · ҮЕ`}</span>
      <span className="shared-person__avatar" aria-hidden="true">{(person.last_name || person.first_name).slice(0, 1).toLocaleUpperCase('mn-MN')}</span>
      <strong>{label(person)}</strong><small>{years(person)}</small>
      {partners.map((partner) => <small key={partner.id}>Хань: {label(partner)}</small>)}
      {person.id === tree?.my_person_id && <em>{person.shared_by_me ? 'Таны бүртгэл' : 'Тантай холбогдсон'}</em>}
      <span className="shared-person__scope">Нийтлэг модны мэдээлэл</span>
    </article>{next.length > 0 && <ul>{next.map((child) => renderPerson(child, depth + 1, nextTrail))}</ul>}</li>;
  }

  return <main className="shared-ancestry">
    <header className="shared-ancestry__hero"><div><span>🌳 НЭГ УДАМ · ОЛОН САЛАА</span><h1>Гуулингийнхны их мод</h1><p>Нийтлэг үндэс ба гэр бүлийн мод бодит хүмүүсийн баталгаажсан холбоогоор холбогдоно.</p></div><div className="shared-ancestry__count"><strong>{tree?.persons.length ?? 0}</strong><span>зөвшөөрсөн хүн</span></div></header>
    {context && tree && <nav className="shared-ancestry__context" aria-label="Удмын зам"><span>Үндэс мод</span><span aria-hidden="true">/</span><span>{context.targetName} салбар</span><span aria-hidden="true">/</span><Link href={`/tree?family=${encodeURIComponent(context.family.id)}`}>{context.family.name}</Link><span aria-hidden="true">/</span><Link href={`/profile?family=${encodeURIComponent(context.family.id)}&person=${encodeURIComponent(context.personId)}`}>{personById.has(context.personId) ? label(personById.get(context.personId)!) : 'Холбогдсон хүн'}</Link><Link href={`/tree?family=${encodeURIComponent(context.family.id)}`}>← Гэр бүлийн мод руу буцах</Link></nav>}
    {error && <p className="shared-ancestry__alert" role="alert">{error}</p>}
    {busy ? <p className="shared-ancestry__empty" role="status">Модыг ачаалж байна…</p> : !root ? <section className="shared-ancestry__empty"><span>🪴</span><h2>Үндсэн удмын эхийг тохируулж байна</h2><p>Системийн admin бодит хүнийг эх болгон сонгосны дараа нийтлэг мод энд харагдана.</p></section> : <section className="shared-tree" aria-label="Гуулингийнхны нийтлэг удмын мод"><div className="shared-tree__legend"><span>Үе хоорондын холбоо баталгаатай эцэг/эх, хүүхдийн бүртгэлээр зурна.</span><span>Холбоогүй салбар үндсэн модноос тусдаа байна.</span></div><div className="shared-tree__couple" aria-label="Үндсэн удмын эх"><article id={`shared-person-${root.id}`} className="shared-person is-root"><span className="shared-person__generation">УДМЫН ЭХ</span><span className="shared-person__avatar" aria-hidden="true">{root.first_name.slice(0, 1)}</span><strong>{label(root)}</strong><small>{years(root)}</small></article>{rootPartner && <><span className="shared-tree__union" aria-label="Гэрлэлтийн холбоо">♡</span><article id={`shared-person-${rootPartner.id}`} className="shared-person is-root"><span className="shared-person__generation">УДМЫН ЭХ</span><span className="shared-person__avatar" aria-hidden="true">{rootPartner.first_name.slice(0, 1)}</span><strong>{label(rootPartner)}</strong><small>{years(rootPartner)}</small></article></>}</div>{firstGeneration.length > 0 ? <div className="shared-tree__descendants"><h2>Эхний үндсэн салаанууд</h2><ul className="shared-tree__roots">{firstGeneration.map((person) => renderPerson(person, 1, new Set([root.id, ...(rootPartner ? [rootPartner.id] : [])])))}</ul></div> : <p className="shared-tree__missing">Эхний үеийн хүүхдийн холбоо хараахан баталгаажаагүй байна.</p>}{unlinked.length > 0 && <section className="shared-tree__unlinked" aria-label="Үндсэн модонд холбоогүй салаа"><h2>Үндсэн модонд холбоогүй салаа 🌱</h2><p>Эдгээр хүмүүс нийтлэг санд зөвшөөрлөөр орсон боловч үеийн холбоогоо сонгоогүй байна.</p><ul className="shared-tree__roots">{unlinked.map((person) => renderPerson(person, 0, new Set()))}</ul></section>}</section>}
    <section className="shared-join"><div><span>ТАНЫ ГЭР БҮЛИЙН САЛБАР</span><h2>Гэр бүлийн модоо үндэс модтой холбох</h2><p>{linked && ownName ? `${label(ownName)} нийтлэг модонд зөвшөөрөгдсөн байна. ` : ''}Холболтыг таны бодит хүн, сонгосон эцэг/эх, зөвшөөрөл болон админы шалгалтаар батална. Гэр бүлийн хувийн түүх, архив тусдаа хэвээр үлдэнэ.</p></div><div className="shared-join__form"><Link href="/ancestry/connect">Үндэс модтой холбох →</Link><Link href="/tree">Өөрийн гэр бүлийн мод →</Link></div></section><p className="shared-ancestry__privacy">Үндэс модны салбарт харагдах нь бусад гэр бүлийн хувийн мэдээлэлд хандах эрх олгохгүй.</p>
  </main>;
}
