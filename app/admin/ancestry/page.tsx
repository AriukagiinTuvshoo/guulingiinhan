'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import styles from '../admin.module.css';

type Candidate = { id: string; name: string; family_name: string; family_id: string; birth_date: string | null; is_alive: boolean };
type Tree = { root_person_id: string | null; root_partner_person_id: string | null; persons: { id: string; first_name: string; last_name: string; birth_date: string | null }[]; relationships: { id: string; parent_id: string; child_id: string; relationship_type: string; source: 'canonical' | 'legacy_projection' }[] };
type DonationInfo = { id?: number; title: string; purpose: string; currency: string; bank_name: string; account_name: string; account_number: string; qr_image_url: string | null; is_published: boolean };
type RootConnection = { family_id: string; family_name: string | null; status: string; person_id: string; person_name: string; target_person_id: string; target_name: string; relationship_type: string; requested_by_name: string | null; requested_at: string | null };
type AdminFamily = { id: string; name: string };
type WorkspacePerson = { id: string; first_name: string; last_name: string; birth_date: string | null; is_alive: boolean };
type AncestorDraft = { first_name: string; last_name: string; gender: string; birth_date: string; birth_place: string; is_alive: boolean; death_date: string; death_place: string; short_description: string };
const emptyDonation: DonationInfo = { title: '', purpose: '', currency: 'MNT', bank_name: '', account_name: '', account_number: '', qr_image_url: null, is_published: false };
const emptyAncestor: AncestorDraft = { first_name: '', last_name: '', gender: 'unknown', birth_date: '', birth_place: '', is_alive: false, death_date: '', death_place: '', short_description: '' };

async function listAdminFamilies(): Promise<AdminFamily[]> {
  const families: AdminFamily[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await api<AdminFamily[]>(`/admin/families?limit=50&offset=${offset}`);
    families.push(...page);
    if (page.length < 50) return families;
  }
}

export default function SharedAncestryAdminPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]); const [tree, setTree] = useState<Tree | null>(null);
  const [donation, setDonation] = useState<DonationInfo>(emptyDonation);
  const [connections, setConnections] = useState<RootConnection[]>([]);
  const [families, setFamilies] = useState<AdminFamily[]>([]);
  const [ancestorFamilyId, setAncestorFamilyId] = useState('');
  const [familyPeople, setFamilyPeople] = useState<WorkspacePerson[]>([]);
  const [familyPeopleBusy, setFamilyPeopleBusy] = useState(false);
  const [familyPeopleReady, setFamilyPeopleReady] = useState(false);
  const [ancestor, setAncestor] = useState<AncestorDraft>(emptyAncestor);
  const [connectionStatus, setConnectionStatus] = useState<'pending' | 'approved' | 'rejected' | 'disconnected'>('pending');
  const [selected, setSelected] = useState(''); const [busy, setBusy] = useState(true); const [saving, setSaving] = useState(false);
  const [parentId, setParentId] = useState(''); const [childId, setChildId] = useState('');
  const [publishId, setPublishId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [relationshipType, setRelationshipType] = useState('biological');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const [options, current, payment, rows, familyOptions] = await Promise.all([api<Candidate[]>('/admin/shared-lineage/candidates'), api<Tree>('/shared-lineage'), api<DonationInfo | null>('/admin/shared-lineage/donation-info'), api<RootConnection[]>(`/admin/shared-lineage/connections?status=${connectionStatus}`), listAdminFamilies()]); setCandidates(options); setTree(current); setSelected(current.root_person_id || ''); setDonation(payment ? { ...payment } : emptyDonation); setConnections(rows); setFamilies(familyOptions); setAncestorFamilyId((previous) => previous || options.find((person) => person.id === current.root_person_id)?.family_id || (familyOptions.length === 1 ? familyOptions[0].id : '')); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Нийтлэг модны тохиргоог ачаалж чадсангүй.'); }
    finally { setBusy(false); }
  }, [connectionStatus]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!ancestorFamilyId) { setFamilyPeople([]); setFamilyPeopleReady(false); return; }
    let active = true;
    setFamilyPeopleBusy(true); setFamilyPeopleReady(false);
    api<{ persons: WorkspacePerson[] }>(`/admin/families/${encodeURIComponent(ancestorFamilyId)}/workspace`)
      .then((workspace) => { if (active) { setFamilyPeople(workspace.persons); setFamilyPeopleReady(true); } })
      .catch(() => { if (active) { setFamilyPeople([]); setFamilyPeopleReady(false); setError('Сонгосон гэр бүлийн хүмүүсийг шалгаж чадсангүй. Давхардал шалгагдтал шинэ хүн хадгалахгүй.'); } })
      .finally(() => { if (active) setFamilyPeopleBusy(false); });
    return () => { active = false; };
  }, [ancestorFamilyId]);
  const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('mn-MN');
  const existingMatches = ancestor.first_name.trim() ? familyPeople.filter((person) =>
    normalizedName(person.first_name) === normalizedName(ancestor.first_name)
    && normalizedName(person.last_name) === normalizedName(ancestor.last_name)
  ) : [];
  const otherFamilyMatches = ancestor.first_name.trim() ? candidates.filter((person) =>
    person.family_id !== ancestorFamilyId
    && normalizedName(person.name) === normalizedName(`${ancestor.last_name} ${ancestor.first_name}`)
  ) : [];
  async function createAncestor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ancestorFamilyId || !ancestor.first_name.trim() || saving || !familyPeopleReady) return;
    if (ancestor.death_date && ancestor.birth_date && ancestor.death_date < ancestor.birth_date) {
      setError('Нас барсан огноо төрсөн огнооноос өмнө байж болохгүй.'); return;
    }
    if ((existingMatches.length || otherFamilyMatches.length) && !window.confirm(`Ижил нэртэй ${existingMatches.length + otherFamilyMatches.length} хүн бүртгэлтэй байна. Бүртгэлийг шалгасан уу? Үнэхээр өөр хүн бол шинээр үүсгэнэ.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const created = await api<WorkspacePerson>(`/admin/families/${encodeURIComponent(ancestorFamilyId)}/people`, {
        method: 'POST',
        body: JSON.stringify({
          first_name: ancestor.first_name.trim(), last_name: ancestor.last_name.trim(), gender: ancestor.gender,
          birth_date: ancestor.birth_date || null, birth_place: ancestor.birth_place.trim() || null,
          is_alive: ancestor.is_alive, death_date: ancestor.is_alive ? null : ancestor.death_date || null,
          death_place: ancestor.is_alive ? null : ancestor.death_place.trim() || null,
          short_description: ancestor.short_description.trim() || null, visibility: 'family',
        }),
      });
      setFamilyPeople((people) => [...people, created]); setAncestor(emptyAncestor);
      if (!tree?.root_person_id) setSelected(created.id);
      else setPublishId(created.id);
      setNotice(`${created.last_name} ${created.first_name} хүний бүртгэл аккаунтгүйгээр үүслээ. Одоо доорх сонголтоор үндсэн эх болгох эсвэл нийтлэг модонд оруулаад бодит холбоог нь тусад нь батална уу.`.trim());
      try {
        const [options, workspace] = await Promise.all([
          api<Candidate[]>('/admin/shared-lineage/candidates'),
          api<{ persons: WorkspacePerson[] }>(`/admin/families/${encodeURIComponent(ancestorFamilyId)}/workspace`),
        ]);
        setCandidates(options); setFamilyPeople(workspace.persons);
      } catch {
        setNotice('Хүний бүртгэл амжилттай үүслээ. Жагсаалт шинэчлэгдэхгүй бол хуудсыг дахин ачаална уу. Дахин шинэ хүн үүсгэх шаардлагагүй.');
      }
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Өвөг дээдсийн бүртгэлийг хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function save() {
    if (!selected || saving) return;
    if (tree?.root_person_id && selected !== tree.root_person_id) {
      const previous = candidates.find((person) => person.id === tree.root_person_id)?.name || 'одоогийн удмын эх';
      const next = candidates.find((person) => person.id === selected)?.name || 'сонгосон хүн';
      if (!window.confirm(`${previous} хүнийг ${next} хүнээр солих уу? Одоогийн холбоос, айл бүрийн мод хэвээр үлдэж, энэ өөрчлөлт админы түүхэнд бүртгэгдэнэ.`)) return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const changed = await api<Tree>('/admin/shared-lineage/root', {
        method: 'PUT', body: JSON.stringify({ person_id: selected, expected_root_person_id: tree?.root_person_id || null }),
      });
      setTree(changed);
      setNotice(tree?.root_person_id ? 'Үндсэн удмын эхийг шинэчиллээ. Өмнөх хүн болон бүх салааны холбоос хадгалагдсан.' : 'Үндсэн удмын эхийг бүх account-д нийтлэг мод болголоо.');
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Үндсэн модыг хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function saveDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setSaving(true); setError(''); setNotice('');
    const payload: Omit<DonationInfo, 'id'> = {
      title: donation.title, purpose: donation.purpose, currency: donation.currency,
      bank_name: donation.bank_name, account_name: donation.account_name,
      account_number: donation.account_number, qr_image_url: donation.qr_image_url,
      is_published: donation.is_published,
    };
    try { const updated = await api<DonationInfo>('/admin/shared-lineage/donation-info', { method: 'PUT', body: JSON.stringify(payload) }); setDonation(updated); setNotice(updated.is_published ? 'Хандивын мэдээлэл бүх account-д харагдахаар нийтлэгдлээ.' : 'Хандивын мэдээллийг хадгаллаа. Одоогоор нийтлээгүй.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хандивын мэдээллийг хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function changeRelationship(action: 'add' | 'remove', relationshipId?: string) {
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<Tree>(action === 'add' ? '/admin/shared-lineage/relationships' : `/admin/shared-lineage/relationships/${relationshipId}`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        ...(action === 'add' ? { body: JSON.stringify({ parent_person_id: parentId, child_person_id: childId, relationship_type: relationshipType }) } : {}),
      });
      setTree(updated); setChildId(''); setNotice(action === 'add' ? 'Бодит эцэг/эх–хүүхдийн холбоос бүртгэгдлээ.' : 'Нийтлэг модны хуучин харагдацын холбоос салгагдлаа. Гэр бүлийн бодит холбоос хадгалагдсан.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Холбоосыг шинэчилж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function deleteCanonicalRelationship(relationshipId: string) {
    if (saving) return;
    const confirmation = window.prompt('⚠ Энэ бол бодит эцэг/эх–хүүхдийн холбоо. Устгавал холбогдох гэр бүлийн модонд мөн өөрчлөлт орно. Үргэлжлүүлэх бол УСТГАХ гэж бичнэ үү.');
    if (confirmation !== 'УСТГАХ') return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<Tree>(`/admin/shared-lineage/canonical-relationships/${relationshipId}/delete`, {
        method: 'POST', body: JSON.stringify({ confirmation: 'DELETE_CANONICAL_RELATIONSHIP' }),
      });
      setTree(updated); setNotice('Бодит холбоосыг админы баталгаатай засвараар салгалаа. Гэр бүлийн модны холбоос мөн өөрчлөгдсөн.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Бодит холбоосыг салгаж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function publishPerson() {
    const candidate = candidates.find((person) => person.id === publishId);
    if (!candidate || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<Tree>('/admin/shared-lineage/people', {
        method: 'POST', body: JSON.stringify({ person_id: candidate.id, family_id: candidate.family_id }),
      });
      setTree(updated); setPublishId('');
      setNotice(`${candidate.name} нийтлэг модонд нэмэгдлээ. Одоо бодит эцэг/эхийг нь сонгон холбоно уу.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хүнийг нийтлэг модонд оруулж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function connectPartner() {
    if (!tree?.root_person_id || !partnerId || saving) return;
    const partner = tree.persons.find((person) => person.id === partnerId);
    if (!partner || !window.confirm(`${sharedName(tree.root_person_id)} болон ${sharedName(partnerId)} хоёрын бодит гэрлэлтийн холбоог бүртгэх үү? Энэ нь гэр бүлийн үндсэн бүртгэлд хадгалагдана.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<Tree>('/admin/shared-lineage/root-partner', {
        method: 'POST', body: JSON.stringify({ person_id: partnerId, expected_root_person_id: tree.root_person_id }),
      });
      setTree(updated); setPartnerId(''); setNotice('Бодит гэрлэлтийн холбоо бүртгэгдлээ. Одоо хоёр эхийн хүүхдүүдийг бодит эцэг/эхийн холбоогоор нэмнэ үү.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Үндсэн эхийн хосыг холбож чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function decideConnection(familyId: string, approve: boolean) {
    if (saving || !window.confirm(approve ? 'Энэ хүний бодит эцэг/эхийн холбоог шалгаад батлах уу?' : 'Энэ холболтын хүсэлтийг татгалзах уу?')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await api(`/admin/shared-lineage/connections/${encodeURIComponent(familyId)}/decision`, {
        method: 'POST', body: JSON.stringify({ approve }),
      });
      const [rows, updated] = await Promise.all([
        api<RootConnection[]>(`/admin/shared-lineage/connections?status=${connectionStatus}`), api<Tree>('/shared-lineage'),
      ]);
      setConnections(rows); setTree(updated);
      setNotice(approve ? 'Гэр бүлийн салбар баталгаажлаа.' : 'Хүсэлт татгалзагдлаа.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хүсэлтийг шийдвэрлэж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function disconnectConnection(familyId: string) {
    if (saving || !window.confirm('Энэ гэр бүлийн зөвшөөрөгдсөн холболтыг зөвхөн нийтлэг үндэс модноос салгах уу? Бодит эцэг/эх–хүүхдийн холбоо, гэр бүлийн мод, хүмүүс болон хувийн агуулга хадгалагдана.')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await api(`/admin/shared-lineage/connections/${encodeURIComponent(familyId)}`, { method: 'DELETE' });
      const [rows, updated] = await Promise.all([
        api<RootConnection[]>(`/admin/shared-lineage/connections?status=${connectionStatus}`), api<Tree>('/shared-lineage'),
      ]);
      setConnections(rows); setTree(updated);
      setNotice('Зөвхөн нийтлэг модны холболт саллаа. Гэр бүлийн бодит холбоос хадгалагдсан.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Нийтлэг модны холболтыг салгаж чадсангүй.'); }
    finally { setSaving(false); }
  }
  const sharedName = (id: string) => { const person = tree?.persons.find((item) => item.id === id); return person ? `${person.last_name} ${person.first_name}`.trim() : 'Хүн олдсонгүй'; };
  const firstGeneration = tree?.relationships.filter((edge) => edge.parent_id === tree.root_person_id || edge.parent_id === tree.root_partner_person_id).map((edge) => edge.child_id) ?? [];
  const firstGenerationIds = [...new Set(firstGeneration)];
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><Link className={styles.brand} href="/admin">ГУУЛИНГИЙНХАН</Link><span className={styles.eyebrow}>НИЙТЛЭГ УДМЫН МОД</span></div><div className={styles.headerActions}><Link className={styles.back} href="/admin">← Админ руу буцах</Link></div></header>
    <section className={styles.content}><div className={styles.heading}><div><span className={styles.eyebrow}>🌳 ГУУЛИНГИЙНХНЫ ИХ МОД</span><h1>Үндсэн удмын эх</h1></div></div>
      {error && <div role="alert" className={styles.error}>{error}</div>}{notice && <div role="status" className={styles.notice}>{notice}</div>}
      <div className={styles.panel}><h3>Гэр бүлийн баталсан эхлэл</h3><p className={styles.muted}>Энэ нэрсийг эзэн өгсөн. Доорх бодит бүртгэл, гэрлэлт, эцэг/эх–хүүхдийн холбоог баталж байж нийтлэг модонд харагдана; зөвхөн ижил нэрээр автоматаар холбохгүй.</p><p><strong>Ядамсүрэн + Гүнд</strong> → Долгор · Нансалмаа · Баавай · Бадамдорж</p><p className={styles.muted}>Одоогийн баталгаажсан үндэс: <strong>{tree?.root_person_id ? sharedName(tree.root_person_id) : 'тохируулаагүй'}</strong>{tree?.root_partner_person_id ? ` + ${sharedName(tree.root_partner_person_id)}` : ' · хосын холбоо дутуу'}. Эхний үеийн бодит холбоотой хүн: {firstGenerationIds.length ? firstGenerationIds.map(sharedName).join(' · ') : 'одоогоор алга'}.</p></div>
      <form className={styles.panel} onSubmit={(event) => void createAncestor(event)}>
        <span className={styles.eyebrow}>01 · ХҮНИЙ БҮРТГЭЛ</span><h3>Өвөг дээдсээ гараар бүртгэх</h3>
        <p className={styles.muted}>Нас барсан хүнд аккаунт, имэйл, утасны дугаар хэрэггүй. Энд оруулсан хүн зөвхөн сонгосон гэр бүлд бүртгэгдэнэ. Үндсэн модонд холбохыг дараагийн алхамд тусад нь шийднэ.</p>
        <div className={styles.formGrid}>
          <label className={styles.wide}>Бүртгэх гэр бүл<select required value={ancestorFamilyId} onChange={(event) => setAncestorFamilyId(event.target.value)}><option value="">Гэр бүл сонгох</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>
          <label>Нэр *<input required maxLength={120} value={ancestor.first_name} onChange={(event) => setAncestor({ ...ancestor, first_name: event.target.value })} placeholder="Жишээ: Ядамсүрэн" /></label>
          <label>Овог, эцгийн нэр<input maxLength={120} value={ancestor.last_name} onChange={(event) => setAncestor({ ...ancestor, last_name: event.target.value })} placeholder="Мэдэхгүй бол хоосон үлдээнэ" /></label>
          <label>Хүйс<select value={ancestor.gender} onChange={(event) => setAncestor({ ...ancestor, gender: event.target.value })}><option value="unknown">Тодорхойгүй</option><option value="male">Эрэгтэй</option><option value="female">Эмэгтэй</option><option value="other">Бусад</option></select></label>
          <label>Амьдралын төлөв<select value={ancestor.is_alive ? 'alive' : 'deceased'} onChange={(event) => setAncestor({ ...ancestor, is_alive: event.target.value === 'alive', death_date: '', death_place: '' })}><option value="deceased">Нас барсан</option><option value="alive">Амьд</option></select></label>
          <label>Төрсөн огноо<input type="date" value={ancestor.birth_date} onChange={(event) => setAncestor({ ...ancestor, birth_date: event.target.value })} /></label>
          <label>Төрсөн газар<input maxLength={240} value={ancestor.birth_place} onChange={(event) => setAncestor({ ...ancestor, birth_place: event.target.value })} /></label>
          {!ancestor.is_alive && <><label>Нас барсан огноо<input type="date" min={ancestor.birth_date || undefined} value={ancestor.death_date} onChange={(event) => setAncestor({ ...ancestor, death_date: event.target.value })} /></label><label>Нас барсан газар<input maxLength={240} value={ancestor.death_place} onChange={(event) => setAncestor({ ...ancestor, death_place: event.target.value })} /></label></>}
          <label className={styles.wide}>Товч намтар, тодорхой бус он<textarea rows={3} maxLength={1000} value={ancestor.short_description} onChange={(event) => setAncestor({ ...ancestor, short_description: event.target.value })} placeholder="Он сар яг тодорхойгүй бол энд тайлбарлаж болно. Таамаг огноог яг огноо мэт бүү хадгал." /></label>
        </div>
        {familyPeopleBusy && <p role="status" className={styles.muted}>Энэ гэр бүлийн бүртгэлийг давхардалтай эсэхийг шалгаж байна…</p>}
        {existingMatches.length > 0 && <div className={styles.duplicateWarning} role="status"><strong>Ижил нэртэй хүн аль хэдийн байна</strong><p>Шинэ хүн үүсгэхээсээ өмнө дараах бүртгэлийг шалгана уу.</p><ul>{existingMatches.map((person) => <li key={person.id}>{person.last_name} {person.first_name}{person.birth_date ? ` · ${person.birth_date}` : ''} · {person.is_alive ? 'Амьд' : 'Нас барсан'}{candidates.some((candidate) => candidate.id === person.id) && <button type="button" onClick={() => { if (tree?.root_person_id) setPublishId(person.id); else setSelected(person.id); setNotice('Одоо байгаа хүнийг доорх модны сонголтод шилжүүллээ.'); }}>Одоо байгаа хүнийг сонгох</button>}</li>)}</ul></div>}
        {otherFamilyMatches.length > 0 && <div className={styles.duplicateWarning} role="status"><strong>Өөр гэр бүлд ижил нэртэй хүн байна</strong><ul>{otherFamilyMatches.map((person) => <li key={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date}` : ''}<button type="button" onClick={() => { if (tree?.root_person_id) setPublishId(person.id); else setSelected(person.id); setNotice('Одоо байгаа хүнийг доорх модны сонголтод шилжүүллээ.'); }}>Одоо байгаа хүнийг сонгох</button></li>)}</ul></div>}
        <div className={styles.panelActions}><button type="submit" disabled={saving || !familyPeopleReady || !ancestorFamilyId || !ancestor.first_name.trim()}>{saving ? 'Хадгалж байна…' : 'Хүнийг гараар бүртгэх'}</button></div>
        <p className={styles.muted}>Хүн бүртгэснээр гэрлэлт, эцэг/эх–хүүхдийн холбоо автоматаар үүсэхгүй. Эдгээрийг бодит баримтаар доорх хэсэгт холбоно.</p>
      </form>
      {busy ? <p role="status" className={styles.state}>Ачаалж байна…</p> : <div className={styles.panel}>
        <h3>Нэг эх модыг бүх account-д харуулах</h3><p className={styles.muted}>Энд зөвхөн бодит, насанд хүрсэн, гэр бүлд харагдах Person сонгоно. Сонголт нийтлэг удмын модны эх болно. Хуучин айл тус бүрийн мэдээлэл хэвээр үлдэнэ.</p>
        {tree?.root_person_id && <p className={styles.notice}>Үндсэн эх одоо тохируулагдсан. {tree.persons.length} зөвшөөрөгдсөн хүн нийтлэг модонд байна. Шинэ эх сонгоход хуучин хүн, салааны холбоос болон айл бүрийн мод хэвээр үлдэнэ.</p>}
        {candidates.length ? <label className={styles.profileEditor}>Удмын эхийн хүнийг сонгох<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Хүн сонгох</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label> : <p className={styles.state}>Сонгох боломжтой хүн алга. Дээрх хэсэгт бодит эх хүний бүртгэлийг гараар үүсгээд энд сонгоно уу.</p>}
        <div className={styles.panelActions}><button disabled={!selected || selected === tree?.root_person_id || saving} onClick={() => void save()}>{saving ? 'Хадгалж байна…' : tree?.root_person_id ? 'Үндсэн эхийг шинэчлэх' : 'Нийтлэг эх мод үүсгэх'}</button><Link href="/admin">Хүмүүсээ админ удирдлагаас бэлдэх →</Link></div>
      </div>}
      <div className={styles.panel}><h3>Үндсэн эхийн хосыг холбох</h3><p className={styles.muted}>Гүнд хүний бодит Person бүртгэлийг эхлээд нийтлэг модонд зөвшөөрлөөр оруулна. Дараа нь энд Ядамсүрэнгийн бодит хосоор сонгоно. Хоёр хүн нэг идэвхтэй гэр бүлд бүртгэлтэй байх ёстой.</p>{tree?.root_partner_person_id ? <p className={styles.notice}>Одоогийн баталгаажсан хос: {sharedName(tree.root_partner_person_id)}</p> : <div className={styles.formGrid}><label>Одоо байгаа хосын бүртгэл<select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.filter((person) => person.id !== tree.root_person_id).map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}</option>)}</select></label><div className={styles.panelActions}><button type="button" disabled={!tree?.root_person_id || !partnerId || saving} onClick={() => void connectPartner()}>Бодит хосыг холбох</button></div></div>}</div>
      <div className={styles.panel}><h3>Салаа нэмж холбох дүрэм</h3><ol><li>Хэрэглэгч өөрийн аккаунттай холбосон хүнийг сонгоно.</li><li>Өөрийн хүн бусад account-д харагдах зөвшөөрлийг өөрөө өгнө.</li><li>Нийтлэг модонд байгаа эцэг/эхийг сонговол түүний салбар болж холбоно. Сонгохгүй бол одоогоор холбоогүй салаа хэвээр байна.</li><li>Хэрэглэгч салбараа салгахад зөвхөн нийтлэг модны холбоос арилна; өөрийн гэр бүлийн мод ба профайл хэвээр.</li></ol></div>
      <div className={styles.panel}>
        <h3>Гэр бүлүүдийн холболтын хяналт</h3>
        <p className={styles.muted}>Батлахад бодит эцэг/эх–хүүхдийн холбоо бүртгэгдэнэ. Дараа нь нийтлэг модноос салгасан ч гэр бүлийн бодит холбоо хадгалагдана.</p>
        <label>Хүсэлтийн төлөв<select value={connectionStatus} onChange={(event) => setConnectionStatus(event.target.value as typeof connectionStatus)}><option value="pending">Шалгах</option><option value="approved">Батлагдсан</option><option value="rejected">Татгалзсан</option><option value="disconnected">Салгасан</option></select></label>
        {connections.length ? <div className={styles.linkList}>{connections.map((row) => <div key={row.family_id} className={styles.reviewRow}>
          <span><b>{row.family_name || 'Гэр бүл'} · {row.person_name}</b> → <b>{row.target_name}</b><small>{row.relationship_type === 'step' ? 'Дагавар' : row.relationship_type === 'adoptive' ? 'Үрчилсэн' : 'Төрсөн'} · Хүсэлт гаргасан: {row.requested_by_name || 'Тодорхойгүй'}{row.requested_at ? ` · ${new Date(row.requested_at).toLocaleDateString('mn-MN')}` : ''}</small><small>Баталбал нийтлэг модонд зөвшөөрөгдсөн хүн харагдана; гэр бүлийн хувийн түүх, зураг, архив нээгдэхгүй.</small></span>
          {connectionStatus === 'pending' && <div className={styles.reviewActions}><button type="button" disabled={saving} onClick={() => void decideConnection(row.family_id, true)}>Шалгаад батлах</button><button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => void decideConnection(row.family_id, false)}>Татгалзах</button></div>}
          {connectionStatus === 'approved' && <button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => void disconnectConnection(row.family_id)}>Зөвхөн үндэс модноос салгах</button>}
        </div>)}</div> : <p className={styles.state}>Энэ төлөвийн хүсэлт алга.</p>}
      </div>
      <div className={styles.panel}><h3>Дөрвөн үндсэн салааны бодит хүнийг сонгох</h3><p className={styles.muted}>Долгор, Нансалмаа, Баавай, Бадамдоржийн бүртгэлийг нэрээр нь таамаглахгүй. “Гэр бүл, удам” хэсэгт хүнээ шалгаад, нэг нэгээр нь нийтлэг модонд оруулж, доор Ядамсүрэн эсвэл Гүндтэй эцэг/эх–хүүхдийн бодит холбоо үүсгэнэ. Амьд хүний нийтлэх зөвшөөрлийг шалгана.</p><div className={styles.formGrid}><label>Одоо байгаа бодит хүн<select value={publishId} onChange={(event) => setPublishId(event.target.value)}><option value="">Хүн сонгох</option>{candidates.filter((person) => !tree?.persons.some((item) => item.id === person.id)).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.family_name}</option>)}</select></label></div><div className={styles.panelActions}><button type="button" disabled={!publishId || saving} onClick={() => void publishPerson()}>Нийтлэг модонд оруулах</button></div></div>
      <div className={styles.panel}><h3>🌿 Нийтлэг модны салаа холбох</h3><p className={styles.muted}>Энд үүсгэсэн эцэг–хүүхдийн холбоо бодит хүний бүртгэлд хадгалагдаж, гэр бүлийн мод болон нийтлэг модонд ижил харагдана. Эхлээд дөрвөн хүүхдийг зөв эцэг/эхтэй нь холбоод, дараагийн үеийг тухайн хүүхдийн доор холбоно.</p><div className={styles.formGrid}>
        <label>Эцэг / эх<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{person.id === tree.root_person_id ? ' · Үндсэн эх' : ''}</option>)}</select></label>
        <label>Хүүхэд<select value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.filter((person) => person.id !== tree.root_person_id).map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label>
        <label>Холбооны төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select></label>
      </div><div className={styles.panelActions}><button type="button" disabled={saving || !parentId || !childId || parentId === childId} onClick={() => void changeRelationship('add')}>Хүүхэд холбох</button></div>
      {tree?.relationships.length ? <div className={styles.linkList}>{tree.relationships.map((edge) => <div key={edge.id}><span><b>{sharedName(edge.parent_id)}</b> → <b>{sharedName(edge.child_id)}</b><small>{edge.relationship_type === 'step' ? 'Дагавар' : edge.relationship_type === 'adoptive' ? 'Үрчилсэн' : 'Төрсөн'} · {edge.source === 'canonical' ? 'Бодит холбоо · гэр бүлийн модонд хадгалагдсан' : 'Хуучин нийтлэг харагдацын холбоо'}</small></span>{edge.source === 'legacy_projection' ? <button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => { if (window.confirm('Зөвхөн нийтлэг модны хуучин харагдацын холбоосыг салгах уу? Гэр бүлийн бодит холбоо хадгалагдана.')) void changeRelationship('remove', edge.id); }}>Харагдацаас салгах</button> : <button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => void deleteCanonicalRelationship(edge.id)}>Бодит холбоог засах</button>}</div>)}</div> : <p className={styles.state}>Нийтлэг модны холбоос одоогоор алга.</p>}</div>
      <form className={styles.panel} onSubmit={(event) => void saveDonation(event)}><h3>💚 Бүх гишүүнд харагдах хандив</h3><p className={styles.muted}>Энд оруулсан банк, дансны дугаар болон QR бүх нэвтэрсэн account-ийн дээд хэсэгт харагдана. Нууц мэдээлэл оруулахгүй.</p><div className={styles.formGrid}>
        <label>Хандивын гарчиг<input maxLength={180} value={donation.title} onChange={(event) => setDonation({ ...donation, title: event.target.value })} placeholder="Жишээ: Гуулингийнхан удмын сан" /></label>
        <label>Валют<input maxLength={3} value={donation.currency} onChange={(event) => setDonation({ ...donation, currency: event.target.value.toUpperCase() })} /></label>
        <label>Банк<input maxLength={120} value={donation.bank_name} onChange={(event) => setDonation({ ...donation, bank_name: event.target.value })} /></label>
        <label>Данс эзэмшигч<input maxLength={180} value={donation.account_name} onChange={(event) => setDonation({ ...donation, account_name: event.target.value })} /></label>
        <label>Дансны дугаар<input maxLength={80} value={donation.account_number} onChange={(event) => setDonation({ ...donation, account_number: event.target.value })} /></label>
        <label>QR зургийн HTTPS холбоос<input maxLength={1000} type="url" value={donation.qr_image_url || ''} onChange={(event) => setDonation({ ...donation, qr_image_url: event.target.value || null })} placeholder="https://…" /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={donation.is_published} onChange={(event) => setDonation({ ...donation, is_published: event.target.checked })} /> Бүх account-д нийтлэх</label>
        <label className={styles.wide}>Зориулалт<textarea maxLength={4000} rows={3} value={donation.purpose} onChange={(event) => setDonation({ ...donation, purpose: event.target.value })} /></label>
      </div><div className={styles.panelActions}><button disabled={saving}>{saving ? 'Хадгалж байна…' : donation.is_published ? 'Хадгалаад нийтлэх' : 'Хадгалах'}</button></div></form>
    </section>
  </div></main>;
}
