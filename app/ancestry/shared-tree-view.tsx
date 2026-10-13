'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, Family, TreeData } from '../../lib/api';
import { sharedAncestryGenerations, sharedAncestryPaths } from '../../lib/shared-ancestry';
import { useAppShellContext } from '../../components/app-shell';
import FamilyMap, { FamilyMapMode } from '../../components/family-map';
import SharedRelativeRequest, { SharedRequestKind, SharedRequestStatus } from '../../components/shared-relative-request';
import '../family-map.css';
import './shared-ancestry.css';

type SharedPerson = { id: string; first_name: string; last_name: string; middle_name: string | null; gender: string; birth_date: string | null; is_alive: boolean; death_date: string | null; shared_by_me: boolean; profile_photo_url?: string | null };
type SharedEdge = { id: string; parent_id: string; child_id: string; relationship_type: string };
type SharedSpouse = { id: string; person_1_id: string; person_2_id: string; status: 'married' | 'widowed' | 'divorced' };
type SharedTree = { name: string; root_person_id: string | null; root_partner_person_id: string | null; persons: SharedPerson[]; relationships: SharedEdge[]; spouses: SharedSpouse[]; my_person_id: string | null };
function label(person: SharedPerson) { return [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' '); }
function years(person: SharedPerson) {
  const birth = person.birth_date?.slice(0, 4); const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} — ${death}`;
  if (birth) return person.is_alive ? `${birth} — одоо` : `${birth} — огноо тодорхойгүй`;
  return person.is_alive ? 'Амьд · он тодорхойгүй' : 'Нас барсан · он тодорхойгүй';
}

export default function SharedAncestryPage() {
  const { familyId, currentFamily } = useAppShellContext();
  const [tree, setTree] = useState<SharedTree | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [context, setContext] = useState<{ family: Family; personId: string; targetName: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<FamilyMapMode>('overview');
  const [zoom, setZoom] = useState(0.85);
  const [focusDepth, setFocusDepth] = useState(3);
  const [generation, setGeneration] = useState('');
  const [requestTarget, setRequestTarget] = useState<{ person: SharedPerson; kind: SharedRequestKind } | null>(null);
  const [requestRevision, setRequestRevision] = useState(0);
  const loadRequest = useRef(0);
  const detailRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setBusy(true); setError('');
    try {
      const result = await api<SharedTree>('/shared-lineage');
      if (request === loadRequest.current) setTree(result);
    } catch (cause) {
      if (request === loadRequest.current) setError(cause instanceof ApiError ? cause.message : 'Үндсэн модыг ачаалж чадсангүй.');
    } finally { if (request === loadRequest.current) setBusy(false); }
  }, []);
  useEffect(() => { void load(); return () => { loadRequest.current++; }; }, [load]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('family'), focusId = params.get('focus');
    if (!id || !focusId) return;
    void Promise.all([
      api<Family[]>('/families'),
      api<{ status: string; person_id: string | null; target_name: string | null }>(`/families/${encodeURIComponent(id)}/root-connection`),
    ]).then(([families, connection]) => {
      const family = families.find((item) => item.id === id);
      if (active && family && connection.status === 'approved' && connection.person_id === focusId) setContext({ family, personId: focusId, targetName: connection.target_name || 'Салбар' });
    }).catch(() => { /* Unverified context stays empty. */ });
    return () => { active = false; };
  }, []);
  const paths = useMemo(() => sharedAncestryPaths(tree), [tree]);
  const generations = useMemo(() => sharedAncestryGenerations(tree), [tree]);
  const peopleById = useMemo(() => new Map((tree?.persons || []).map((person) => [person.id, person])), [tree]);
  const root = tree?.root_person_id ? peopleById.get(tree.root_person_id) : undefined;
  const partner = tree?.root_partner_person_id ? peopleById.get(tree.root_partner_person_id) : undefined;
  const selected = selectedId && paths.has(selectedId) ? peopleById.get(selectedId) : undefined;
  const mapData = useMemo<TreeData>(() => ({
    persons: (tree?.persons || []).filter((person) => paths.has(person.id)),
    parent_child_relationships: (tree?.relationships || []).filter((edge) => paths.has(edge.parent_id) && paths.has(edge.child_id)),
    marriages: (tree?.spouses || []).filter((pair) => paths.has(pair.person_1_id) && paths.has(pair.person_2_id)).map((pair) => ({ ...pair, start_date: null, end_date: null })),
    root_person_id: tree?.root_person_id, lineage_root_person_id: tree?.root_person_id,
  }), [tree, paths]);
  useEffect(() => {
    const focusedId = new URLSearchParams(window.location.search).get('focus');
    if (focusedId && paths.has(focusedId)) setSelectedId(focusedId);
  }, [paths]);
  useEffect(() => { if (selectedId) detailRef.current?.focus({ preventScroll: true }); }, [selectedId]);
  const selectedSpouses = selected ? (tree?.spouses || []).filter((pair) => pair.person_1_id === selected.id || pair.person_2_id === selected.id).map((pair) => peopleById.get(pair.person_1_id === selected.id ? pair.person_2_id : pair.person_1_id)).filter((person): person is SharedPerson => Boolean(person)) : [];
  const currentPersonAlreadyShared = Boolean(tree?.my_person_id && paths.has(tree.my_person_id));
  const familyHref = `/tree?view=family${familyId ? `&family=${encodeURIComponent(familyId)}` : ''}`;
  function openRequest(personId: string, kind: SharedRequestKind = 'child') {
    const person = peopleById.get(personId);
    if (person && paths.has(personId)) { setNotice(''); setRequestTarget({ person, kind }); }
  }
  function closeDetail() {
    const id = selectedId;
    setSelectedId(null);
    if (id) document.getElementById(`tree-person-${id}`)?.focus({ preventScroll: true });
  }

  return <main className="shared-ancestry">
    <header className="shared-ancestry__hero"><div><span>ҮНДСЭН УДМЫН МОД</span><h1>Гуулингийнхны их мод</h1><p>{root ? `${label(root)}${partner ? ` + ${label(partner)}` : ''}` : 'Үе үеийн гэр бүлийн холбоо'}</p></div><div className="shared-ancestry__count"><strong>{paths.size}</strong><span>холбоотой хүн</span></div></header>
    {context && <nav className="shared-ancestry__context" aria-label="Удмын зам"><span>Үндсэн мод</span><span aria-hidden="true">/</span><span>{context.targetName}</span><span aria-hidden="true">/</span><Link href={familyHref}>{context.family.name}</Link></nav>}
    {notice && <p className="shared-ancestry__notice" role="status">{notice}</p>}
    {error && <p className="shared-ancestry__alert" role="alert">{error} <button type="button" onClick={() => void load()}>Дахин оролдох</button></p>}
    {busy ? <p className="shared-ancestry__empty" role="status">Модыг ачаалж байна…</p> : !root ? <section className="shared-ancestry__empty"><h2>Үндсэн удмын эхийг тохируулж байна</h2><p>Админ үндсэн эхийг баталсны дараа мод энд харагдана.</p></section> : <section className="shared-tree-shell" aria-label="Гуулингийнхны үндсэн удмын мод">
      <div className="shared-tree-shell__intro"><span>Хүний дэргэдэх + товчоор хүүхэд, хань нэмэх хүсэлт илгээнэ үү.</span><button type="button" onClick={() => void load()}>Мод шинэчлэх</button></div>
      <FamilyMap data={mapData} familyId={familyId} selectedId={selectedId || root.id} mode={mapMode} zoom={zoom} focusDepth={focusDepth} activeGeneration={generation} canManageTree profileLinks={false} onAddRelative={(id) => openRequest(id)} onModeChange={setMapMode} onZoomChange={setZoom} onFocusDepthChange={setFocusDepth} onGenerationChange={setGeneration} onSelect={(id) => setSelectedId((current) => current === id ? null : id)} />
      {selected && <section ref={detailRef} tabIndex={-1} className="shared-detail" aria-label={`${label(selected)} · дэлгэрэнгүй`}>
        <div className="shared-detail__head"><div><span className="shared-person__generation">{selected.id === root.id || selected.id === partner?.id ? 'УДМЫН ЭХ' : `${generations.get(selected.id) || '—'}-Р ҮЕ`}</span><h2>{label(selected)}</h2><p>{years(selected)}</p></div><button type="button" className="shared-detail__close" aria-label="Дэлгэрэнгүй хаах" onClick={closeDetail}>×</button></div>
        <dl className="shared-detail__facts"><div><dt>Эцэг/эх</dt><dd>{(tree?.relationships || []).filter((edge) => edge.child_id === selected.id).length}</dd></div><div><dt>Хүүхэд</dt><dd>{(tree?.relationships || []).filter((edge) => edge.parent_id === selected.id).length}</dd></div><div><dt>Хань</dt><dd>{selectedSpouses.length ? selectedSpouses.map(label).join(' · ') : 'Бүртгэлгүй'}</dd></div></dl>
        {selected.id === tree?.my_person_id && <p className="shared-detail__mine">Таны бүртгэл</p>}
        <div className="shared-detail__actions"><button type="button" onClick={() => openRequest(selected.id, 'child')}>+ Хүүхэд</button><button type="button" onClick={() => openRequest(selected.id, 'spouse')}>+ Хань</button>{selected.shared_by_me && selected.id !== root.id && selected.id !== partner?.id && <button type="button" onClick={() => openRequest(selected.id, 'detach')}>Салгах хүсэлт</button>}</div>
      </section>}
    </section>}
    <nav className="shared-tree-shell__footer" aria-label="Модны нэмэлт холбоос"><span>Холболтын хүсэлтийг админ шалгаж батална.</span><Link href={familyHref}>Миний гэр бүлийн мод →</Link></nav>
    <SharedRequestStatus familyId={familyId} revision={requestRevision} />
    {requestTarget && <SharedRelativeRequest key={`${familyId}:${requestTarget.person.id}:${requestTarget.kind}`} familyId={familyId} canCreate={currentFamily?.role === 'owner' || currentFamily?.role === 'editor'} currentPersonAlreadyShared={currentPersonAlreadyShared} target={{ id: requestTarget.person.id, name: label(requestTarget.person) }} initialKind={requestTarget.kind} onClose={() => setRequestTarget(null)} onSubmitted={() => { setRequestRevision((value) => value + 1); setNotice('Хүсэлт илгээгдлээ. Админ баталсны дараа үндсэн мод шинэчлэгдэнэ.'); }} />}
  </main>;
}
