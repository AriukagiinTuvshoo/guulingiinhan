'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, api, Family } from '../../../lib/api';
import { sharedAncestryGenerations, sharedAncestryPaths } from '../../../lib/shared-ancestry';
import styles from './root-connection.module.css';

type Person = { id: string; first_name: string; last_name: string; middle_name?: string | null; birth_date?: string | null };
type SharedPerson = Person & { birth_date: string | null };
type SharedTree = {
  root_person_id: string | null;
  root_partner_person_id: string | null;
  my_person_id: string | null;
  persons: SharedPerson[];
  relationships: { parent_id: string; child_id: string; relationship_type?: string }[];
  spouses: { person_1_id: string; person_2_id: string }[];
};
type FamilyTree = {
  persons: Person[];
  parent_child_relationships: { parent_id: string; child_id: string; relationship_type: string }[];
};
type Candidate = {
  person_id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  birth_date: string | null;
  death_date: string | null;
  is_alive: boolean;
  is_current_user: boolean;
  parent_person_ids: string[];
};
type Connection = {
  family_id: string;
  status: 'not_connected' | 'pending' | 'approved' | 'rejected' | 'disconnected';
  person_id: string | null;
  person_name: string | null;
  target_person_id: string | null;
  target_name: string | null;
  relationship_type: string | null;
  can_request: boolean;
};

const relationshipLabel: Record<string, string> = {
  biological: 'Төрсөн хүүхэд', adoptive: 'Үрчилсэн хүүхэд', step: 'Дагавар хүүхэд',
};

function personName(person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) {
  return [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ').trim();
}

function year(value?: string | null) {
  return value ? value.slice(0, 4) : '';
}

function RootConnectionContent() {
  const search = useSearchParams();
  const requestedFamily = search.get('family')?.trim() || '';
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [tree, setTree] = useState<SharedTree | null>(null);
  const [familyTree, setFamilyTree] = useState<FamilyTree | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [joinParentId, setJoinParentId] = useState('');
  const [step, setStep] = useState(1);
  const [relationshipType, setRelationshipType] = useState('biological');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [familyTreeBusy, setFamilyTreeBusy] = useState(false);
  const [familyLoadFailed, setFamilyLoadFailed] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const [familyResult, treeResult] = await Promise.allSettled([
        api<Family[]>('/families'), api<SharedTree>('/shared-lineage'),
      ]);
      if (!active) return;
      if (familyResult.status === 'fulfilled') {
        setFamilies(familyResult.value);
        setFamilyId(requestedFamily || familyResult.value[0]?.id || '');
      } else {
        setFamilyLoadFailed(true);
        setError(familyResult.reason instanceof ApiError ? familyResult.reason.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
      }
      if (treeResult.status === 'fulfilled') setTree(treeResult.value);
      else setError(treeResult.reason instanceof ApiError ? treeResult.reason.message : 'Үндэс модыг ачаалж чадсангүй.');
      setBusy(false);
    }
    void load();
    return () => { active = false; };
  }, [requestedFamily]);

  useEffect(() => {
    let active = true;
    setConnection(null);
    setCandidates([]);
    setFamilyTree(null);
    setFamilyTreeBusy(false);
    setCandidateBusy(false);
    setCandidateId('');
    setTargetId('');
    setJoinParentId('');
    setCandidateQuery('');
    setStep(1);
    setConsent(false);
    setJoinSuccess(false);
    setConnectionError(false);
    setCandidateError('');
    if (!familyId || !families.some((family) => family.id === familyId)) return;
    setCandidateBusy(true);
    void Promise.allSettled([
      api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`),
      api<Candidate[]>(`/families/${encodeURIComponent(familyId)}/root-connection/candidates`),
    ]).then(async ([connectionResult, candidateResult]) => {
      if (!active) return;
      if (connectionResult.status === 'fulfilled') setConnection(connectionResult.value);
      else {
        setConnectionError(true);
        setError(connectionResult.reason instanceof ApiError ? connectionResult.reason.message : 'Холболтын төлөвийг ачаалж чадсангүй.');
      }
      if (candidateResult.status === 'fulfilled') {
        setCandidates(candidateResult.value);
        const own = candidateResult.value.find((candidate) => candidate.is_current_user);
        if (own) {
          setFamilyTreeBusy(true);
          try {
            const localTree = await api<FamilyTree>(
              `/families/${encodeURIComponent(familyId)}/tree?person_id=${encodeURIComponent(own.person_id)}&depth=1&scope=context`,
            );
            if (active) setFamilyTree(localTree);
          } catch (cause) {
            if (active) setCandidateError(cause instanceof ApiError ? cause.message : 'Гэр бүлийн холбоог ачаалж чадсангүй.');
          } finally {
            if (active) setFamilyTreeBusy(false);
          }
        }
      } else {
        setCandidateError(candidateResult.reason instanceof ApiError ? candidateResult.reason.message : 'Гэр бүлийн хүмүүсийг ачаалж чадсангүй.');
      }
      if (active) setCandidateBusy(false);
    });
    return () => { active = false; };
  }, [familyId, families]);

  const family = families.find((item) => item.id === familyId);
  const invalidFamily = !busy && !familyLoadFailed && Boolean(requestedFamily) && !families.some((item) => item.id === requestedFamily);
  const selectedCandidate = candidates.find((person) => person.person_id === candidateId);
  const targetPeople = useMemo(() => {
    const paths = sharedAncestryPaths(tree);
    const knownParents = selectedCandidate?.parent_person_ids || [];
    return tree?.persons.filter((person) => paths.has(person.id)
      && person.id !== candidateId
      && (!knownParents.length || knownParents.includes(person.id))) || [];
  }, [tree, candidateId, selectedCandidate]);
  const target = tree?.persons.find((person) => person.id === targetId);
  const generations = useMemo(() => sharedAncestryGenerations(tree), [tree]);
  const targetGeneration = targetId ? generations.get(targetId) : undefined;
  const candidateGeneration = targetGeneration ? targetGeneration + 1 : undefined;
  const filteredCandidates = candidates.filter((person) => personName(person).toLowerCase().includes(candidateQuery.trim().toLowerCase()));
  const ownCandidate = candidates.find((person) => person.is_current_user);
  const ownPersonId = tree?.my_person_id || ownCandidate?.person_id || null;
  const isOwnPersonShared = Boolean(ownPersonId && tree?.persons.some((person) => person.id === ownPersonId));
  const sharedPaths = useMemo(() => sharedAncestryPaths(tree), [tree]);
  const joinableParents = useMemo(() => {
    if (!ownPersonId || !familyTree || !tree) return [];
    const people = new Map(familyTree.persons.map((person) => [person.id, person]));
    return familyTree.parent_child_relationships
      .filter((edge) => edge.child_id === ownPersonId && sharedPaths.has(edge.parent_id))
      .map((edge) => ({ person: people.get(edge.parent_id), relationshipType: edge.relationship_type }))
      .filter((edge): edge is { person: Person; relationshipType: string } => Boolean(edge.person));
  }, [ownPersonId, familyTree, tree, sharedPaths]);
  const selectedJoinParent = joinableParents.find((parent) => parent.person.id === joinParentId);
  const joinedCurrentUser = Boolean(joinSuccess || isOwnPersonShared);

  async function submitRootConnection() {
    if (!familyId || !selectedCandidate || !targetId || !consent || saving) return;
    setSaving(true); setError('');
    try {
      const value = await api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`, {
        method: 'POST',
        body: JSON.stringify({
          person_id: selectedCandidate.person_id, target_person_id: targetId,
          relationship_type: relationshipType, share_consent: true,
        }),
      });
      setConnection(value);
      setStep(1);
      setConsent(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Холболтын хүсэлтийг илгээж чадсангүй.');
    } finally { setSaving(false); }
  }

  async function joinCurrentUser() {
    if (!ownPersonId || !selectedJoinParent || saving) return;
    setSaving(true); setError('');
    try {
      const updated = await api<SharedTree>('/shared-lineage/join', {
        method: 'POST',
        body: JSON.stringify({
          person_id: ownPersonId,
          parent_person_id: selectedJoinParent.person.id,
          relationship_type: selectedJoinParent.relationshipType,
          share_consent: true,
        }),
      });
      setTree(updated);
      setJoinSuccess(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Таны хүнийг үндэс модонд холбож чадсангүй.');
    } finally { setSaving(false); }
  }

  async function disconnect() {
    if (!familyId || saving || !window.confirm('Үндэс модны холболтыг салгах уу? Хүмүүс болон бодит гэр бүлийн холбоос хэвээр үлдэнэ.')) return;
    setSaving(true); setError('');
    try {
      setConnection(await api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`, { method: 'DELETE' }));
      setJoinSuccess(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Холболтыг салгаж чадсангүй.');
    } finally { setSaving(false); }
  }

  const existingParentsNeedAnchor = Boolean(selectedCandidate?.parent_person_ids.length && !targetPeople.length);

  return <main className={styles.page}>
    <header className={styles.hero}>
      <span>ГУУЛИНГИЙНХАН · УДАМ УГСАА</span>
      <h1>Гэр бүлийн модоо үндэс модтой холбох</h1>
      <p>Гэр бүлдээ бүртгэсэн хүнээ нийтлэг модны баталгаатай эцэг эсвэл эхтэй залгана. Дараа нь хүн бүр өөрийн профайлыг бодит гэр бүлийн холбоогоор нэмж, үе нь автоматаар тооцогдоно.</p>
    </header>
    <div className={styles.layout}>
      <aside className={styles.aside}>
        <h2>Холболтын зам</h2>
        <ol><li>Гэр бүлийн хүн</li><li>Үндэс модны эцэг/эх</li><li>Бодит холбоо</li><li>Зөвшөөрч илгээх</li></ol>
        <p className={styles.note}>Үеийн дугаарыг гараар оруулахгүй. Үндэс модноос эхэлсэн баталгаажсан эцэг/эхийн холбоосоор тооцно.</p>
        <Link href={familyId ? `/tree?family=${encodeURIComponent(familyId)}` : '/tree'}>← Гэр бүлийн мод</Link>
        <Link href="/ancestry">Үндэс модыг харах →</Link>
      </aside>
      <section className={styles.panel} aria-busy={busy || saving}>
        {busy ? <p role="status">Ачаалж байна…</p> : familyLoadFailed ? <div role="alert"><h2>Гэр бүлийн мэдээлэл ачаалагдсангүй</h2><p>{error}</p></div> : invalidFamily ? <div role="alert"><h2>Гэр бүл олдсонгүй</h2><p>Энэ гэр бүлд хандах эрх алга.</p></div> : !family ? <p>Эхлээд гэр бүл үүсгэх эсвэл урилгаар нэгдэнэ үү. <Link href="/families">Гэр бүлүүд →</Link></p> : <>
          {families.length > 1 && <label>Миний гэр бүл<select value={familyId} onChange={(event) => { setFamilyId(event.target.value); setError(''); }}><option value="">Сонгох</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {connectionError ? <div role="alert"><h2>Холболтын төлөв ачаалагдсангүй</h2><p>Түр хүлээгээд хуудсыг дахин ачаална уу.</p></div> : !tree ? <div role="alert"><h2>Үндэс мод ачаалагдсангүй</h2><p>Түр хүлээгээд хуудсыг дахин ачаална уу.</p></div> : !tree.root_person_id ? <div><h2>Үндэс модны эхийг тохируулж байна</h2><p>Админ бодит эх хүнийг баталсны дараа салбар сонгож болно.</p></div> : <>
            {connection?.status === 'pending' ? <div role="status">
              <span className={styles.kicker}>ХҮЛЭЭГДЭЖ БАЙНА</span><h2>Салбарын эхийг админ шалгаж байна</h2>
              <p><strong>{connection.person_name}</strong> хүнийг <strong>{connection.target_name}</strong> хүний хүүхэд болгож холбох хүсэлт хүлээгдэж байна. Батлагдах хүртэл нийтлэг модонд харагдахгүй.</p>
            </div> : connection?.status === 'approved' ? <div>
              <span className={styles.kicker}>САЛБАРЫН ЭХ ХОЛБОГДСОН</span><h2>{family.name} · {connection.person_name}</h2>
              <p><strong>{connection.target_name}</strong> хүний {relationshipLabel[connection.relationship_type || 'biological']?.toLowerCase()} холбоогоор салбарын эх батлагдлаа.</p>
              <div className={styles.actions}><Link className={styles.primary} href={`/ancestry?focus=${encodeURIComponent(connection.person_id || '')}&family=${encodeURIComponent(familyId)}`}>Нийтлэг модыг харах →</Link><Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Гэр бүлийн мод →</Link><button type="button" disabled={saving} onClick={() => void disconnect()}>Холболтыг салгах</button></div>
              <div className={styles.joinCard}>
                <span className={styles.kicker}>ДАРААГИЙН АЛХАМ · ӨӨРИЙГӨӨ НЭМЭХ</span>
                <h2>Өөрийн баталгаажсан хүнийг холбоно уу</h2>
                {!ownPersonId ? <p>Өөрийн профайлыг эхлээд гэр бүлийн модны хүнтэй холбосны дараа эндээс нэмнэ.</p> : joinedCurrentUser ? <p role="status">Таны хүн нийтлэг модонд холбогдсон байна. Таны үе бодит холбоосоор автоматаар тооцогдоно.</p> : familyTreeBusy ? <p role="status">Гэр бүлийн холбоог шалгаж байна…</p> : joinableParents.length ? <>
                  <p>Өөрийн бүртгэлтэй эцэг/эхээс нийтлэг модонд аль хэдийн холбогдсон хүнийг сонгоно. Хүүхдийн бодит холбоог дахин үүсгэхгүй.</p>
                  <label>Миний эцэг/эх<select value={joinParentId} onChange={(event) => setJoinParentId(event.target.value)}><option value="">Эцэг/эхээ сонгоно уу</option>{joinableParents.map(({ person }) => <option key={person.id} value={person.id}>{personName(person)}{person.birth_date ? ` · ${year(person.birth_date)}` : ''}</option>)}</select></label>
                  {selectedJoinParent && ownCandidate && <div className={styles.generationCard}><span>{personName(selectedJoinParent.person)} · {generations.get(selectedJoinParent.person.id)}-р үе</span><b>↓</b><strong>{personName(ownCandidate)} · {(generations.get(selectedJoinParent.person.id) || 0) + 1}-р үе</strong></div>}
                  <label className={styles.check}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Миний нэр болон энэ холбоог нийтлэг модонд харуулахыг зөвшөөрч байна.</label>
                  <div className={styles.actions}><button className={styles.primary} type="button" disabled={!selectedJoinParent || !consent || saving} onClick={() => void joinCurrentUser()}>{saving ? 'Холбож байна…' : 'Миний хүнийг нэмэх'}</button></div>
                </> : <div className={styles.note}>
                  <p>Таны бүртгэлтэй хүн нийтлэг модонд хараахан холбогдсон эцэг/эхгүй байна. Эхлээд гэр бүлийн модонд эцэг/эхийн бодит холбоог бүртгэх эсвэл тэр эцэг/эхийг салбарын эхээр холбож батлуулна.</p>
                  <Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Гэр бүлийн модны холбоог шалгах →</Link>
                </div>}
              </div>
            </div> : <>
              {connection?.status === 'rejected' && <p className={styles.error}>Өмнөх хүсэлт зөвшөөрөгдөөгүй. Холбоо, хүнээ шалгаад дахин илгээж болно.</p>}
              {connection?.status === 'disconnected' && <p className={styles.note}>Өмнөх үндэс модны холболт салсан. Хүмүүс болон гэр бүлийн бодит холбоос хадгалагдсан.</p>}
              <div className={styles.flowIntro}><span className={styles.kicker}>ҮНДСЭН МОД → САЛБАРЫН ЭХ → ГЭР БҮЛ</span><h2>Холбох хүнийг сонгоно уу</h2><p>Анх нэг хүнийг салбарын эх болгож батлуулна. Түүний үр хүүхэд бүр өөрийн баталгаажсан профайлаар бодит эцэг/эх дээрээсээ нэмж орно.</p></div>
              <div className={styles.stepHeader}><span>АЛХАМ {step} / 4</span><div aria-hidden="true"><i className={step >= 1 ? styles.stepActive : ''}/><i className={step >= 2 ? styles.stepActive : ''}/><i className={step >= 3 ? styles.stepActive : ''}/><i className={step >= 4 ? styles.stepActive : ''}/></div></div>
              {step === 1 && <>
                <h2>Гэр бүлийн модноос хүнээ сонго</h2><p>Та өөрийн баталгаажсан хүнийг, эсвэл эзэн/засварлагчийн эрхтэй бол аккаунтгүй, насанд хүрсэн нас барсан хүнийг салбарын эхээр сонгож болно.</p>
                {candidateBusy ? <p role="status">Гэр бүлийн хүмүүсийг ачаалж байна…</p> : candidateError ? <p className={styles.error} role="alert">{candidateError}</p> : candidates.length === 0 ? <div className={styles.note}><p>Холбох боломжтой хүн олдсонгүй. Өөрийн хүнийг профайлаас гэр бүлийн модтой холбох эсвэл нас барсан хүнийг энэ гэр бүлийн модонд бүртгэнэ үү.</p><Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Хүмүүсээ шалгах →</Link></div> : <>
                  <label>Нэрээр хайх<input type="search" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Жишээ: ээжийн нэр" /></label>
                  <div className={styles.choiceList} role="listbox" aria-label="Гэр бүлийн хүн сонгох">
                    {filteredCandidates.slice(0, 8).map((person) => <button key={person.person_id} type="button" role="option" aria-selected={person.person_id === candidateId} className={person.person_id === candidateId ? styles.choiceSelected : styles.choice} onClick={() => { setCandidateId(person.person_id); setTargetId(''); setConsent(false); }}>
                      <span className={styles.personMark}>{person.first_name.slice(0, 1)}</span><span><strong>{personName(person)}</strong><small>{person.is_current_user ? 'Таны баталгаажсан профайл' : person.is_alive ? 'Амьд хүн' : 'Нас барсан · аккаунтгүй'}{person.birth_date ? ` · ${year(person.birth_date)}` : ''}</small></span><span aria-hidden="true">{person.person_id === candidateId ? '✓' : '→'}</span>
                    </button>)}
                  </div>
                  {filteredCandidates.length > 8 && <p className={styles.muted}>Эхний 8 хүнийг харууллаа. Нэрээр нарийвчилна уу.</p>}
                  {filteredCandidates.length === 0 && <p className={styles.muted}>Ийм нэртэй хүн олдсонгүй.</p>}
                  {selectedCandidate && <div className={styles.selection}><strong>{personName(selectedCandidate)}</strong><span>{selectedCandidate.is_current_user ? 'Энэ бол таны аккаунттай баталгаажсан хүн.' : 'Энэ хүний салбарын холболтыг админ шалгана.'}</span>{selectedCandidate.parent_person_ids.length > 0 && <small>Гэр бүлийн модонд {selectedCandidate.parent_person_ids.length} эцэг/эхийн холбоо бүртгэлтэй.</small>}</div>}
                </>}
              </>}
              {step === 2 && <>
                <h2>{selectedCandidate ? `${personName(selectedCandidate)} хэний хүүхэд вэ?` : 'Үндэс модны эцэг/эхийг сонго'}</h2><p>Нийтлэг модонд харагдаж буй бодит эцэг эсвэл эхийг сонгоно. Хүний нэр, үеийг таамгаар тааруулахгүй.</p>
                {!selectedCandidate ? <p className={styles.error}>Өмнөх алхамд хүн сонгоно уу.</p> : existingParentsNeedAnchor ? <div className={styles.note}><p>Энэ хүн гэр бүлийн модонд эцэг/эхтэй бүртгэлтэй боловч тэдгээрийн аль нь ч нийтлэг модонд холбогдоогүй байна. Бүртгэлтэй эцэг/эхээ эхлээд үндэс модтой холбох хэрэгтэй.</p><Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Гэр бүлийн холбоог харах →</Link></div> : <>
                  <label>Үндэс модны эцэг/эх<select value={targetId} onChange={(event) => { setTargetId(event.target.value); setConsent(false); }}><option value="">Хүнийг сонгоно уу</option>{targetPeople.map((person) => <option key={person.id} value={person.id}>{personName(person)}{person.birth_date ? ` · ${year(person.birth_date)}` : ''}</option>)}</select></label>
                  {target && <div className={styles.generationCard}><span>{personName(target)} · {targetGeneration ? `${targetGeneration}-р үе` : 'Үе тодорхойгүй'}</span><b>↓</b><strong>{personName(selectedCandidate)} · {candidateGeneration ? `${candidateGeneration}-р үе` : 'дараагийн үе'}</strong></div>}
                </>}
              </>}
              {step === 3 && <>
                <h2>Бодит эцэг/эхийн холбоогоо баталгаажуул</h2><p><strong>{selectedCandidate ? personName(selectedCandidate) : 'Сонгосон хүн'}</strong> нь <strong>{target ? personName(target) : 'сонгосон хүн'}</strong>-ий хүүхэд гэдгийг өөрийн мэдлэгээрээ шалгана уу.</p>
                <label>Хүүхдийн холбооны төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн хүүхэд</option><option value="adoptive">Үрчилсэн хүүхэд</option><option value="step">Дагавар хүүхэд</option></select></label>
                {target && selectedCandidate && <div className={styles.generationCard}><span>{personName(target)} · {targetGeneration || 1}-р үе</span><b>↓</b><strong>{personName(selectedCandidate)} · {candidateGeneration || (targetGeneration || 1) + 1}-р үе</strong><small>Үеийг бодит модны холбоосоос тооцлоо.</small></div>}
              </>}
              {step === 4 && <>
                <h2>Хүсэлтээ шалгана уу</h2>
                <div className={styles.path}><span>Үндэс модонд байгаа эцэг/эх<br/><strong>{target ? personName(target) : 'Сонгосон хүн'}{targetGeneration ? ` · ${targetGeneration}-р үе` : ''}</strong></span><span>{relationshipLabel[relationshipType]} ↓<br/><strong>{selectedCandidate ? personName(selectedCandidate) : 'Гэр бүлийн хүн'}{candidateGeneration ? ` · ${candidateGeneration}-р үе` : ''}</strong></span></div>
                <p>{family.name} гэр бүлийн <strong>{selectedCandidate ? personName(selectedCandidate) : 'сонгосон хүн'}</strong>-ийг энэ салбарын эх болгон холбох хүсэлтийг эрх бүхий админ шалгана. Зөвшөөрсний дараа гэр бүлийн бусад хүн өөрийн профайлаар эцэг/эхээ сонгон, тусдаа зөвшөөрлөөр нэмэгдэнэ. Хувийн зураг, түүх, архив бусдад нээгдэхгүй.</p>
                <label className={styles.check}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Сонгосон хүний нэр болон энэ удмын холбоог нийтлэг модонд харуулах эрхтэйгээ баталж, нийтлэхийг зөвшөөрч байна.</label>
              </>}
              <div className={styles.actions}>
                {step > 1 && <button type="button" onClick={() => setStep(step - 1)}>← Өмнөх</button>}
                {step < 4 ? <button className={styles.primary} type="button" disabled={(step === 1 && !candidateId) || (step === 2 && (!targetId || !target)) || (step === 2 && existingParentsNeedAnchor)} onClick={() => setStep(step + 1)}>Дараах →</button> : <button className={styles.primary} type="button" disabled={!consent || saving} onClick={() => void submitRootConnection()}>{saving ? 'Хүсэлт илгээж байна…' : 'Админд шалгуулах'}</button>}
              </div>
            </>}
          </>}
        </>}
      </section>
    </div>
  </main>;
}

export default function RootConnectionPage() {
  return <Suspense fallback={<main className={styles.page}>Ачаалж байна…</main>}><RootConnectionContent /></Suspense>;
}
