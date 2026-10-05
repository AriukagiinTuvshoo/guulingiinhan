'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import Link from 'next/link';
import ArchiveFamilyControl from './admin-family-archive';
import StoryContent from './story-content';
import styles from '../app/admin/admin.module.css';

type Person = {
  id: string; first_name: string; last_name: string; gender: string;
  birth_date: string | null; birth_place: string | null; is_alive: boolean;
  death_date: string | null; short_description: string | null; visibility: string;
  updated_at: string;
};
type Edge = { id: string; parent_id: string; child_id: string; relationship_type: string };
type Story = { id: string; title: string; body: string; visibility: string; created_at: string };
type Event = { id: string; action: string; target_type: string; target_id: string | null; actor_name: string; created_at: string };
type Lineage = { id: string; name: string; description: string | null };
type Branch = { id: string; lineage_id: string; name: string; description?: string | null };
type Assignment = { person_id: string; lineage_id: string; branch_id: string | null };
type PersonDependencies = {
  account_link: boolean; parent_child_count: number; marriage_count: number;
  story_count: number; memory_count: number; archive_count: number;
  in_shared_ancestry: boolean; root_connection: boolean; pending_claim: boolean;
  family_root: boolean; shared_root: boolean; can_detach: boolean;
};
type Workspace = {
  family: { id: string; name: string; description: string | null; root_person_id: string | null; people_count: number; relationship_count: number; story_count: number; members_count: number };
  people: Person[]; relationships: Edge[]; stories: Story[]; history: Event[];
  lineages: Lineage[]; branches: Branch[]; assignments: Assignment[];
};
type PersonForm = {
  first_name: string; last_name: string; gender: string; birth_date: string;
  birth_place: string; is_alive: boolean; death_date: string; short_description: string;
  visibility: string;
};

const emptyPerson: PersonForm = {
  first_name: '', last_name: '', gender: 'unknown', birth_date: '', birth_place: '',
  is_alive: true, death_date: '', short_description: '', visibility: 'family',
};

const actionLabels: Record<string, string> = {
  'admin.person_created': 'Хүн нэмсэн', 'admin.person_edited': 'Хүний мэдээлэл зассан',
  'admin.person_detached': 'Хүнийг гэр бүлээс салгасан',
  'admin.relationship_created': 'Хамаарал холбосон',
  'admin.relationship_deleted': 'Хамаарал салгасан',
  'admin.lineage_root_changed': 'Удмын эхийг өөрчилсөн',
  'admin.family_edited': 'Гэр бүлийн мэдээлэл зассан',
  'admin.story_created': 'Түүх нэмсэн', 'admin.story_edited': 'Түүх зассан',
  'admin.lineage_created': 'Удам нэмсэн', 'admin.branch_created': 'Салаа нэмсэн',
  'admin.lineage_edited': 'Удмын нэрийн бүртгэл зассан', 'admin.lineage_deleted': 'Ашиглаагүй нэрийн бүртгэл устгасан',
  'admin.branch_edited': 'Салааны нэрийн бүртгэл зассан', 'admin.branch_deleted': 'Ашиглаагүй салааны нэр устгасан',
  'admin.family_archived': 'Гэр бүлийг архивласан', 'admin.family_restored': 'Гэр бүлийг сэргээсэн',
  'admin.lineage_assignment_saved': 'Хүний удмын багцлалт зассан',
  'admin.lineage_assignment_cleared': 'Хүний удмын багцлалт цэвэрлэсэн',
};

function displayName(person: Person) {
  return `${person.last_name} ${person.first_name}`.trim();
}

function message(cause: unknown) {
  return cause instanceof ApiError ? cause.message : 'Үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.';
}

export default function AdminFamilyStudio({ familyId, onBack }: { familyId: string; onBack: () => void }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'people' | 'links' | 'lineages' | 'stories' | 'history'>('people');
  const [familyName, setFamilyName] = useState('');
  const [familyDescription, setFamilyDescription] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [dependencies, setDependencies] = useState<PersonDependencies | null>(null);
  const [dependencyError, setDependencyError] = useState('');
  const [personForm, setPersonForm] = useState<PersonForm>(emptyPerson);
  const [rootId, setRootId] = useState('');
  const [parentId, setParentId] = useState('');
  const [childId, setChildId] = useState('');
  const [relationshipType, setRelationshipType] = useState('biological');
  const [lineageName, setLineageName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [lineageId, setLineageId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [assignmentPersonId, setAssignmentPersonId] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [storyBody, setStoryBody] = useState('');
  const [storyVisibility, setStoryVisibility] = useState('family');
  const [editingStoryId, setEditingStoryId] = useState('');
  const [editingLabel, setEditingLabel] = useState<{ id: string; kind: 'lineages' | 'branches'; name: string; description: string } | null>(null);

  const reload = useCallback(async () => {
    const result = await api<Workspace>(`/admin/families/${familyId}/workspace`);
    setData(result);
    setFamilyName(result.family.name);
    setFamilyDescription(result.family.description || '');
    setRootId(result.family.root_person_id || '');
  }, [familyId]);

  useEffect(() => {
    let active = true;
    api<Workspace>(`/admin/families/${familyId}/workspace`)
      .then((result) => {
        if (!active) return;
        setData(result); setFamilyName(result.family.name);
        setFamilyDescription(result.family.description || '');
        setRootId(result.family.root_person_id || '');
      })
      .catch((cause) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [familyId]);

  useEffect(() => {
    if (!selectedId) { setDependencies(null); setDependencyError(''); return; }
    let active = true;
    setDependencies(null); setDependencyError('');
    void api<PersonDependencies>(`/admin/families/${familyId}/people/${selectedId}/dependencies`)
      .then((value) => { if (active) setDependencies(value); })
      .catch((cause) => { if (active) setDependencyError(message(cause)); });
    return () => { active = false; };
  }, [familyId, selectedId, data]);

  async function run(action: () => Promise<unknown>, success: string) {
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try { await action(); await reload(); setNotice(success); }
    catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }

  function selectPerson(person: Person | null) {
    setSelectedId(person?.id || '');
    setPersonForm(person ? {
      first_name: person.first_name, last_name: person.last_name, gender: person.gender,
      birth_date: person.birth_date || '', birth_place: person.birth_place || '',
      is_alive: person.is_alive, death_date: person.death_date || '',
      short_description: person.short_description || '', visibility: person.visibility,
    } : emptyPerson);
    setError('');
  }

  async function savePerson() {
    if (!personForm.first_name.trim()) { setError('Нэрийг бөглөнө үү.'); return; }
    const payload = {
      ...personForm, first_name: personForm.first_name.trim(), last_name: personForm.last_name.trim(),
      birth_date: personForm.birth_date || null, birth_place: personForm.birth_place || null,
      death_date: personForm.is_alive ? null : personForm.death_date || null,
      short_description: personForm.short_description || null,
    };
    await run(async () => {
      await api(`/admin/families/${familyId}/people${selectedId ? `/${selectedId}` : ''}`, {
        method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      selectPerson(null);
    }, selectedId ? 'Хүний мэдээллийг хадгаллаа.' : 'Шинэ хүн нэмэгдлээ.');
  }

  if (busy) return <p className={styles.state}>Удмын орчныг ачаалж байна…</p>;
  if (!data) return <div className={styles.error} role="alert">{error || 'Гэр бүлийн мэдээлэл олдсонгүй.'}</div>;
  const selectedPerson = data.people.find((person) => person.id === selectedId);
  const root = data.people.find((person) => person.id === data.family.root_person_id);
  const selectedLinks = data.relationships.filter((edge) => edge.parent_id === selectedId || edge.child_id === selectedId);
  const rootChildren = data.relationships.filter((edge) => edge.parent_id === data.family.root_person_id)
    .map((edge) => data.people.find((person) => person.id === edge.child_id)).filter((person): person is Person => Boolean(person));
  return <div className={styles.studio}>
    <button className={styles.textButton} type="button" onClick={onBack}>← Гэр бүлүүд рүү буцах</button>
    <div className={styles.studioHero}>
      <div><span className={styles.eyebrow}>🌳 УДМЫН УДИРДЛАГА</span><h2>{data.family.name}</h2><p>{data.family.description || 'Гэр бүлийн түүх, хүмүүс, холбоосыг нэг дороос удирдана.'}</p></div>
      <div className={styles.studioHeroStats}><span><b>{data.family.people_count}</b> хүн</span><span><b>{data.family.relationship_count}</b> холбоос</span><span><b>{data.family.story_count}</b> түүх</span><span><b>{data.family.members_count}</b> гишүүн</span></div>
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    <div className={styles.studioTabs} role="tablist" aria-label="Удмын удирдлага">
      {([['people', '👥 Хүмүүс'], ['links', '🌿 Удмын мод'], ['lineages', '🪴 Удам ба салаа'], ['stories', '📖 Түүх'], ['history', '🕘 Өөрчлөлт']] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    {tab === 'people' && <div className={styles.studioGrid}>
      <section className={styles.panel}><div className={styles.panelTitle}><div><span className={styles.eyebrow}>БҮРТГЭЛ</span><h3>Гэр бүлийн хүмүүс</h3></div><button type="button" onClick={() => selectPerson(null)}>+ Хүн нэмэх</button></div>
        {data.people.length ? <div className={styles.personList}>{data.people.map((person) =>
          <button key={person.id} type="button" className={selectedId === person.id ? styles.personSelected : ''} onClick={() => selectPerson(person)}><span className={styles.personAvatar}>{person.first_name[0]}</span><span><b>{displayName(person)}</b><small>{person.birth_date?.slice(0, 4) || 'Он тодорхойгүй'} · {person.visibility === 'private' ? 'Хувийн' : 'Гэр бүлд'}</small></span><span>→</span></button>)}</div> : <p className={styles.state}>Хүн бүртгээгүй байна.</p>}
      </section>
      <section className={styles.panel}><span className={styles.eyebrow}>✍️ {selectedPerson ? 'МЭДЭЭЛЭЛ ЗАСАХ' : 'ШИНЭ ХҮН'}</span><h3>{selectedPerson ? displayName(selectedPerson) : 'Удмын хүн нэмэх'}</h3>
        <div className={styles.formGrid}>
          <label>Нэр<input value={personForm.first_name} maxLength={120} onChange={(event) => setPersonForm({ ...personForm, first_name: event.target.value })} /></label>
          <label>Овог<input value={personForm.last_name} maxLength={120} onChange={(event) => setPersonForm({ ...personForm, last_name: event.target.value })} /></label>
          <label>Хүйс<select value={personForm.gender} onChange={(event) => setPersonForm({ ...personForm, gender: event.target.value })}><option value="unknown">Тодорхойгүй</option><option value="female">Эмэгтэй</option><option value="male">Эрэгтэй</option><option value="other">Бусад</option></select></label>
          <label>Төрсөн огноо<input type="date" value={personForm.birth_date} onChange={(event) => setPersonForm({ ...personForm, birth_date: event.target.value })} /></label>
          <label>Төрсөн газар<input value={personForm.birth_place} maxLength={240} onChange={(event) => setPersonForm({ ...personForm, birth_place: event.target.value })} /></label>
          <label>Харагдах хүрээ<select value={personForm.visibility} onChange={(event) => setPersonForm({ ...personForm, visibility: event.target.value })}><option value="family">Гэр бүлд</option><option value="private">Хувийн</option><option value="public">Нээлттэй</option></select></label>
          <label className={styles.checkbox}><input type="checkbox" checked={personForm.is_alive} onChange={(event) => setPersonForm({ ...personForm, is_alive: event.target.checked, death_date: '' })} /> Амьд</label>
          {!personForm.is_alive && <label>Нас барсан огноо<input type="date" value={personForm.death_date} onChange={(event) => setPersonForm({ ...personForm, death_date: event.target.value })} /></label>}
          <label className={styles.wide}>Товч тайлбар<textarea rows={4} maxLength={1000} value={personForm.short_description} onChange={(event) => setPersonForm({ ...personForm, short_description: event.target.value })} /></label>
        </div>
        {selectedPerson && <div className={styles.muted} role="status">
          {dependencyError ? `Холбоотой мэдээллийг шалгаж чадсангүй: ${dependencyError}` : !dependencies ? 'Холбоотой мэдээллийг шалгаж байна…' : <>
            <p>Эцэг эх/хүүхдийн холбоос {dependencies.parent_child_count}, гэрлэлт {dependencies.marriage_count}, түүх {dependencies.story_count}, дурсамж {dependencies.memory_count}, архив {dependencies.archive_count}.</p>
            <p>{dependencies.can_detach ? 'Гэр бүлээс салгавал энэ гэр бүлийн түүх, дурсамж, архивын хүний тэмдэглэгээ арилна. Хүний үндсэн бүртгэл болон бодит холбоос хадгалагдана.' : `Салгахын өмнө хамгаалалттай холбоосыг цэгцэлнэ үү: ${[dependencies.family_root && 'гэр бүлийн эх', dependencies.shared_root && 'нийтлэг модны эх', dependencies.account_link && 'аккаунт', dependencies.in_shared_ancestry && 'нийтлэг мод', dependencies.root_connection && 'үндэс модны хүсэлт', dependencies.pending_claim && 'аккаунт холбох хүсэлт'].filter(Boolean).join(', ')}.`}</p>
          </>}
        </div>}
        <div className={styles.panelActions}><button type="button" disabled={saving} onClick={() => void savePerson()}>{saving ? 'Хадгалж байна…' : selectedPerson ? 'Өөрчлөлт хадгалах' : 'Хүн нэмэх'}</button>{selectedPerson && selectedLinks.length > 0 && <button type="button" className={styles.secondaryButton} onClick={() => { setParentId(selectedId); setTab('links'); }}>Холбоосыг шалгах →</button>}{selectedPerson && <button type="button" className={styles.outlineDanger} disabled={saving || !dependencies?.can_detach} onClick={() => { if (window.confirm(`${displayName(selectedPerson)}-г энэ гэр бүлээс салгах уу? Энэ гэр бүл дэх түүх, дурсамж, архивын хүний тэмдэглэгээ арилна. Хүн, агуулга, аккаунт болон бусад гэр бүлийн мэдээлэл хадгалагдана.`)) void run(() => api(`/admin/families/${familyId}/people/${selectedId}`, { method: 'DELETE' }).then(() => selectPerson(null)), 'Хүнийг гэр бүлээс салгалаа.'); }}>Гэр бүлээс салгах</button>}</div>
      </section>
    </div>}
    {tab === 'links' && <div className={styles.studioGrid}>
      <section className={styles.panel}><span className={styles.eyebrow}>🌲 УДМЫН ЭХ</span><h3>{root ? displayName(root) : 'Удмын эх сонгоогүй'}</h3><p className={styles.muted}>Энэ гэр бүлийн эх хүнийг сонгоно. Нийтлэг Гуулингийнхны эх мод тусдаа бөгөөд бүх account-д харагдана.</p><label>Удмын эх<select value={rootId} onChange={(event) => setRootId(event.target.value)}><option value="">Хүн сонгох</option>{data.people.map((person) => <option key={person.id} value={person.id}>{displayName(person)}</option>)}</select></label><div className={styles.panelActions}><button disabled={saving || !rootId || rootId === data.family.root_person_id} onClick={() => { if (window.confirm('Удмын эхийг өөрчлөх үү?')) void run(() => api(`/admin/families/${familyId}/root`, { method: 'PUT', body: JSON.stringify({ person_id: rootId }) }), 'Удмын эхийг хадгаллаа.'); }}>Эхийг хадгалах</button></div><p className={styles.muted}>Эх хүний шууд хүүхэд: {rootChildren.length ? rootChildren.map(displayName).join(' · ') : 'хараахан холбогоогүй'}</p><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} disabled={!root} onClick={() => { setParentId(root!.id); setChildId(''); }}>Эх хүний хүүхэд холбох ↓</button></div></section>
      <section className={styles.panel}><span className={styles.eyebrow}>🌿 ЭЦЭГ ЭХ · ХҮҮХЭД</span><h3>Хамаарал холбох</h3><p className={styles.muted}>Салааллыг холбож, алдаатай холбоосыг салгана. Эргэлттэй удам үүсгэхийг систем шалгана.</p><div className={styles.formGrid}><label>Эцэг / эх<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Хүн сонгох</option>{data.people.map((person) => <option key={person.id} value={person.id}>{displayName(person)}</option>)}</select></label><label>Хүүхэд<select value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">Хүн сонгох</option>{data.people.map((person) => <option key={person.id} value={person.id}>{displayName(person)}</option>)}</select></label><label>Төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Өргөмөл</option></select></label></div><div className={styles.panelActions}><button disabled={saving || !parentId || !childId || parentId === childId} onClick={() => void run(() => api(`/admin/families/${familyId}/relationships`, { method: 'POST', body: JSON.stringify({ parent_id: parentId, child_id: childId, relationship_type: relationshipType }) }), 'Хамаарал нэмэгдлээ.')}>Холбоос нэмэх</button></div></section>
      <section className={`${styles.panel} ${styles.fullWidth}`}><h3>Бүртгэлтэй холбоосууд</h3>{data.relationships.length ? <div className={styles.linkList}>{data.relationships.map((edge) => <div key={edge.id}><span><b>{displayName(data.people.find((person) => person.id === edge.parent_id)!)}</b> → <b>{displayName(data.people.find((person) => person.id === edge.child_id)!)}</b><small>{edge.relationship_type === 'step' ? 'Дагавар' : edge.relationship_type === 'adoptive' ? 'Үрчилсэн' : 'Төрсөн'}</small></span><button className={styles.outlineDanger} disabled={saving} onClick={() => { if (window.confirm('Энэ эцэг эх, хүүхдийн холбоосыг салгах уу?')) void run(() => api(`/admin/families/${familyId}/relationships/${edge.id}`, { method: 'DELETE' }), 'Холбоос салгагдлаа.'); }}>Салгах</button></div>)}</div> : <p className={styles.state}>Холбоос бүртгээгүй байна.</p>}</section>
    </div>}
    {tab === 'stories' && <div className={styles.studioGrid}>
      <section className={styles.panel}>
        <span className={styles.eyebrow}>📜 ТҮҮХЭН САН</span><h3>{editingStoryId ? 'Түүх засах' : 'Түүх оруулах'}</h3>
        <p className={styles.muted}>Түүхийн гарчиг, агуулга, харагдах хүрээг энд удирдана. Зөвхөн “Нийтийн” гэж сонгосон түүх бусад гэр бүлд харагдана.</p>
        <label>Гарчиг<input value={storyTitle} maxLength={180} onChange={(event) => setStoryTitle(event.target.value)} /></label>
        <label>Харагдах хүрээ<select value={storyVisibility} onChange={(event) => setStoryVisibility(event.target.value)}><option value="family">Зөвхөн гэр бүлд</option><option value="public">Нийтийн түүх</option>{storyVisibility === 'private' && <option value="private">Хувийн</option>}</select></label>
        <div className={styles.panelActions} role="group" aria-label="Түүхийн бичвэр форматлах">
          <button type="button" className={styles.secondaryButton} onClick={() => setStoryBody((text) => `${text}\n\n## Дэд гарчиг\n`)}>Дэд гарчиг</button>
          <button type="button" className={styles.secondaryButton} onClick={() => setStoryBody((text) => `${text}\n\n> Ишлэл\n`)}>Ишлэл</button>
          <button type="button" className={styles.secondaryButton} onClick={() => setStoryBody((text) => `${text}\n\n- Жагсаалтын мөр\n`)}>Жагсаалт</button>
        </div>
        <label>Агуулга<textarea rows={12} maxLength={100000} value={storyBody} onChange={(event) => setStoryBody(event.target.value)} /></label>
        {storyBody.trim() && <div className={styles.muted}><strong>Урьдчилан харах</strong><StoryContent body={storyBody} familyId={familyId} /></div>}
        <div className={styles.panelActions}><button type="button" disabled={saving || !storyTitle.trim() || !storyBody.trim()} onClick={() => void run(async () => {
          const payload = { title: storyTitle.trim(), body: storyBody.trim(), visibility: storyVisibility };
          if (editingStoryId) await api(`/admin/stories/${editingStoryId}`, { method: 'PUT', body: JSON.stringify(payload) });
          else await api(`/admin/families/${familyId}/stories`, { method: 'POST', body: JSON.stringify(payload) });
          setStoryTitle(''); setStoryBody(''); setStoryVisibility('family'); setEditingStoryId('');
        }, storyVisibility === 'public' ? 'Нийтийн түүх хадгалагдлаа.' : 'Гэр бүлийн түүх хадгалагдлаа.')}>{editingStoryId ? 'Засварыг хадгалах' : storyVisibility === 'public' ? 'Нийтийн түүх нийтлэх' : 'Гэр бүлийн түүх хадгалах'}</button>{editingStoryId && <button type="button" className={styles.secondaryButton} onClick={() => { setEditingStoryId(''); setStoryTitle(''); setStoryBody(''); setStoryVisibility('family'); }}>Болих</button>}</div>
      </section>
      <section className={styles.panel}><span className={styles.eyebrow}>📚 БҮРТГЭЛТЭЙ ТҮҮХ</span><h3>Гэр бүлийн түүхүүд</h3>{data.stories.length ? <div className={styles.storyStack}>{data.stories.map((story) => <article key={story.id}><small>{new Date(story.created_at).toLocaleDateString('mn-MN')} · {story.visibility === 'public' ? 'Нийтийн' : story.visibility === 'private' ? 'Хувийн' : 'Гэр бүлд'}</small><h4>{story.title}</h4><p>{story.body.slice(0, 180)}{story.body.length > 180 ? '…' : ''}</p><button type="button" onClick={() => { setEditingStoryId(story.id); setStoryTitle(story.title); setStoryBody(story.body); setStoryVisibility(story.visibility); }}>Бичвэр засах →</button></article>)}</div> : <p className={styles.state}>Түүх оруулаагүй байна.</p>}</section>
    </div>}
    {tab === 'lineages' && <>
      <section className={styles.panel}><span className={styles.eyebrow}>ҮНДСЭН ЭХ → САЛАА → ГЭР БҮЛ</span><h3>Гуулингийнхны нэг үндсэн мод</h3><p>Ядамсүрэн + Гүнд → Долгор, Нансалмаа, Баавай, Бадамдоржийн үндсэн салаа → гэр бүлүүд.</p><p className={styles.muted}>Хүний байрлалыг бодит эцэг/эх, хань, хүүхдийн холбоо тогтооно. Үндсэн эх, дөрвөн салааг нийтлэг удмын админ хуудсаас удирдана.</p><div className={styles.panelActions}><Link className={styles.back} href="/admin/ancestry">Үндсэн эх, салааг удирдах →</Link><button type="button" onClick={() => setTab('links')}>Энэ гэр бүлийн бодит холбоог засах</button></div><p>Энэ гэр бүлийн эх: <strong>{root ? displayName(root) : 'Сонгоогүй'}</strong></p>{root && <p>Хүүхдүүд: {data.relationships.filter(edge => edge.parent_id === root.id).map(edge => data.people.find(person => person.id === edge.child_id)).filter(Boolean).map(person => displayName(person!)).join(' · ') || 'Холбоо бүртгэгдээгүй'}</p>}</section>
      <details className={styles.advanced}><summary>Хуучин нэр, салааны шошгыг засах ба цэвэрлэх</summary><p className={styles.muted}>Эдгээр нэрийн шошго хүний бүртгэл биш. Нэр, тайлбарыг засаж, ашиглаагүй загвар шошгыг устгаж болно. Бодит хүн болон эцэг/эхийн холбоо өөрчлөгдөхгүй.</p>
      {data.lineages.map(lineage => <div className={styles.panel} key={lineage.id}><h4>{lineage.name}</h4>{lineage.description && <p>{lineage.description}</p>}<div className={styles.panelActions}><button type="button" disabled={saving} onClick={() => setEditingLabel({ id: lineage.id, kind: 'lineages', name: lineage.name, description: lineage.description || '' })}>Нэр, тайлбар засах</button><button type="button" className={styles.outlineDanger} disabled={saving || data.branches.some(branch => branch.lineage_id === lineage.id) || data.assignments.some(row => row.lineage_id === lineage.id)} onClick={() => { if (window.confirm(`${lineage.name} ашиглаагүй нэрийн шошгыг устгах уу? Хүмүүс болон бодит холбоо хадгалагдана.`)) void run(() => api(`/admin/families/${familyId}/lineages/${lineage.id}`, { method: 'DELETE' }), 'Ашиглаагүй нэрийн шошго устгагдлаа.'); }}>Ашиглаагүй нэрийг устгах</button></div>{data.branches.filter(branch => branch.lineage_id === lineage.id).map(branch => <div className={styles.row} key={branch.id}><span><strong>{branch.name}</strong><small>{data.assignments.filter(row => row.branch_id === branch.id).length} хүний багцлалт</small></span><div className={styles.panelActions}><button type="button" disabled={saving} onClick={() => setEditingLabel({ id: branch.id, kind: 'branches', name: branch.name, description: branch.description || '' })}>Засах</button><button type="button" className={styles.outlineDanger} disabled={saving || data.assignments.some(row => row.branch_id === branch.id)} onClick={() => { if (window.confirm(`${branch.name} ашиглаагүй салааны шошгыг устгах уу? Хүний үндсэн бүртгэл болон бодит холбоо хадгалагдана.`)) void run(() => api(`/admin/families/${familyId}/branches/${branch.id}`, { method: 'DELETE' }), 'Ашиглаагүй салааны шошго устгагдлаа.'); }}>Шошгыг устгах</button></div></div>)}</div>)}
      {editingLabel && <section className={styles.panel}><h4>Нэрийн бүртгэл засах</h4><label>Нэр<input maxLength={180} value={editingLabel.name} onChange={event => setEditingLabel({ ...editingLabel, name: event.target.value })} /></label><label>Тайлбар<textarea maxLength={4000} value={editingLabel.description} onChange={event => setEditingLabel({ ...editingLabel, description: event.target.value })} /></label><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} disabled={saving} onClick={() => setEditingLabel(null)}>Болих</button><button type="button" disabled={saving || !editingLabel.name.trim()} onClick={() => void run(async () => { await api(`/admin/families/${familyId}/${editingLabel.kind}/${editingLabel.id}`, { method: 'PATCH', body: JSON.stringify({ name: editingLabel.name.trim(), description: editingLabel.description.trim() || null }) }); setEditingLabel(null); }, 'Нэр, тайлбар хадгалагдлаа.')}>Хадгалах</button></div></section>}
      <div className={styles.studioGrid}>
      <section className={styles.panel}><span className={styles.eyebrow}>🪴 НЭГ ҮНДЭС</span><h3>Гуулингийнхны нэг удам</h3><p className={styles.muted}>Үндсэн модны жинхэнэ салааллыг “Удмын мод” хэсэгт эцэг эх → хүүхдийн холбоосоор тогтооно. Энэ хэсгийн хуучин багцлалтыг зөвхөн бүртгэлийн шошго болгон хадгална.</p>{data.lineages.length === 0 && <><label>Хуучин багцлалтад ашиглах нэр<input maxLength={180} value={lineageName} onChange={(event) => setLineageName(event.target.value)} /></label><div className={styles.panelActions}><button disabled={saving || !lineageName.trim()} onClick={() => void run(async () => { await api(`/admin/families/${familyId}/lineages`, { method: 'POST', body: JSON.stringify({ name: lineageName.trim() }) }); setLineageName(''); }, 'Багцлалт бүртгэгдлээ.')}>Багцлалт нэмэх</button></div></>}
        <div className={styles.storyStack}>{data.lineages.map((lineage) => <article key={lineage.id}><h4>{lineage.name}</h4><small>{data.branches.filter((branch) => branch.lineage_id === lineage.id).map((branch) => branch.name).join(' · ') || 'Салаа бүртгээгүй'}</small></article>)}</div>
      </section>
      <section className={styles.panel}><span className={styles.eyebrow}>🌱 САЛАА</span><h3>Салаа нэмэх</h3><label>Удам<select value={lineageId} onChange={(event) => { setLineageId(event.target.value); setBranchId(''); }}><option value="">Удам сонгох</option>{data.lineages.map((lineage) => <option key={lineage.id} value={lineage.id}>{lineage.name}</option>)}</select></label><label>Салааны нэр<input maxLength={180} value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label><div className={styles.panelActions}><button disabled={saving || !lineageId || !branchName.trim()} onClick={() => void run(async () => { await api(`/admin/families/${familyId}/lineages/${lineageId}/branches`, { method: 'POST', body: JSON.stringify({ name: branchName.trim() }) }); setBranchName(''); }, 'Салаа бүртгэгдлээ.')}>Салаа нэмэх</button></div></section>
      <section className={`${styles.panel} ${styles.fullWidth}`}><span className={styles.eyebrow}>🌳 ХҮНИЙ ХАРЬЯАЛАЛ</span><h3>Удам, салаанд хуваарилах</h3><p className={styles.muted}>Энэ багцлалт нь эцэг эхийн холбоосыг орлохгүй; удмын модны харагдацыг цэгцэлнэ.</p><div className={styles.formGrid}><label>Хүн<select value={assignmentPersonId} onChange={(event) => { const id = event.target.value; const current = data.assignments.find((row) => row.person_id === id); setAssignmentPersonId(id); setLineageId(current?.lineage_id || ''); setBranchId(current?.branch_id || ''); }}><option value="">Хүн сонгох</option>{data.people.map((person) => <option key={person.id} value={person.id}>{displayName(person)}</option>)}</select></label><label>Удам<select value={lineageId} onChange={(event) => { setLineageId(event.target.value); setBranchId(''); }}><option value="">Удам сонгох</option>{data.lineages.map((lineage) => <option key={lineage.id} value={lineage.id}>{lineage.name}</option>)}</select></label><label>Салаа<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Салаа сонгоогүй</option>{data.branches.filter((branch) => branch.lineage_id === lineageId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div><div className={styles.panelActions}><button disabled={saving || !assignmentPersonId || !lineageId} onClick={() => void run(() => api(`/admin/families/${familyId}/people/${assignmentPersonId}/lineage-assignment`, { method: 'PUT', body: JSON.stringify({ lineage_id: lineageId, branch_id: branchId || null }) }), 'Хүний удмын багцлалт хадгалагдлаа.')}>Хуваарилалт хадгалах</button><button className={styles.outlineDanger} disabled={saving || !assignmentPersonId || !data.assignments.some((row) => row.person_id === assignmentPersonId)} onClick={() => { if (window.confirm('Энэ хүний удмын багцлалтыг цэвэрлэх үү?')) void run(() => api(`/admin/families/${familyId}/people/${assignmentPersonId}/lineage-assignment`, { method: 'DELETE' }), 'Багцлалт цэвэрлэгдлээ.'); }}>Багцлалт цэвэрлэх</button></div></section>
    </div></details></>}
    {tab === 'history' && <div className={styles.studioGrid}>
      <section className={`${styles.panel} ${styles.fullWidth}`}><span className={styles.eyebrow}>🕘 ХЯНАЛТЫН БҮРТГЭЛ</span><h3>Сүүлийн өөрчлөлтүүд</h3><p className={styles.muted}>Үйлдэл бүрийн хийсэн хүн, хугацаа болон объектын ID хадгалагдана.</p>{data.history.length ? <div className={styles.timeline}>{data.history.map((event) => <div key={event.id}><span className={styles.timelineDot} /><div><b>{actionLabels[event.action] || event.action}</b><p>{event.actor_name} · {new Date(event.created_at).toLocaleString('mn-MN')}</p><small>{event.target_type}{event.target_id ? ` · ${event.target_id}` : ''}</small></div></div>)}</div> : <p className={styles.state}>Өөрчлөлт бүртгэгдээгүй байна.</p>}</section>
      <section className={`${styles.panel} ${styles.fullWidth}`}><span className={styles.eyebrow}>⚙️ ГЭР БҮЛИЙН ТОХИРГОО</span><h3>Ерөнхий мэдээлэл</h3><div className={styles.formGrid}><label>Гэр бүлийн нэр<input value={familyName} maxLength={180} onChange={(event) => setFamilyName(event.target.value)} /></label><label className={styles.wide}>Тайлбар<textarea rows={4} maxLength={10000} value={familyDescription} onChange={(event) => setFamilyDescription(event.target.value)} /></label></div><div className={styles.panelActions}><button disabled={saving || !familyName.trim()} onClick={() => void run(() => api(`/admin/families/${familyId}`, { method: 'PATCH', body: JSON.stringify({ name: familyName.trim(), description: familyDescription.trim() || null }) }), 'Гэр бүлийн мэдээлэл хадгалагдлаа.')}>Өөрчлөлт хадгалах</button></div></section>
      <div className={styles.fullWidth}><ArchiveFamilyControl familyId={familyId} onArchived={onBack} /></div>
    </div>}
  </div>;
}
