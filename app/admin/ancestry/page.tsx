'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { sharedAncestryPaths } from '../../../lib/shared-ancestry';
import { readWorkspacePeople, type FamilyWorkspacePeople, type WorkspacePerson } from '../../../lib/admin-workspace';
import styles from '../admin.module.css';

type Candidate = { id: string; name: string; family_name: string; family_id: string; birth_date: string | null; is_alive: boolean; account_linked: boolean; eligible_for_admin_link: boolean };
type Tree = { root_person_id: string | null; root_partner_person_id: string | null; persons: { id: string; first_name: string; last_name: string; birth_date: string | null }[]; relationships: { id: string; parent_id: string; child_id: string; relationship_type: string; source: 'canonical' | 'legacy_projection' }[]; spouses: { person_1_id: string; person_2_id: string }[] };
type DonationInfo = { id?: number; title: string; purpose: string; currency: string; bank_name: string; account_name: string; account_number: string; qr_image_url: string | null; is_published: boolean };
type RootConnection = { family_id: string; family_name: string | null; status: string; person_id: string; person_name: string; target_person_id: string; target_name: string; relationship_type: string; requested_by_name: string | null; requested_at: string | null };
type AdminFamily = { id: string; name: string };
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
  const [relationshipType, setRelationshipType] = useState('biological');
  const [rootDraftId, setRootDraftId] = useState('');
  const [rootPartnerDraftId, setRootPartnerDraftId] = useState('');
  const [rootCoupleStatus, setRootCoupleStatus] = useState<'married' | 'widowed'>('married');
  const [connectPersonId, setConnectPersonId] = useState('');
  const [connectRelatedId, setConnectRelatedId] = useState('');
  const [connectSecondParentId, setConnectSecondParentId] = useState('');
  const [connectKind, setConnectKind] = useState<'child' | 'spouse'>('child');
  const [connectSpouseStatus, setConnectSpouseStatus] = useState<'married' | 'widowed'>('married');
  const [connectStep, setConnectStep] = useState<1 | 2 | 3>(1);
  const [createFor, setCreateFor] = useState<'person' | 'root' | 'partner' | 'connection'>('person');
  const [showAncestorForm, setShowAncestorForm] = useState(false);
  const [firstBranchName, setFirstBranchName] = useState('');
  const [createdPerson, setCreatedPerson] = useState<WorkspacePerson | null>(null);
  const [inspectedPersonId, setInspectedPersonId] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [loadReady, setLoadReady] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setLoadReady(false); setError('');
    try { const [options, current, payment, rows, familyOptions] = await Promise.all([api<Candidate[]>('/admin/shared-lineage/candidates'), api<Tree>('/shared-lineage'), api<DonationInfo | null>('/admin/shared-lineage/donation-info'), api<RootConnection[]>(`/admin/shared-lineage/connections?status=${connectionStatus}`), listAdminFamilies()]); setCandidates(options); setTree(current); setSelected(current.root_person_id || ''); setRootDraftId((previous) => previous || current.root_person_id || ''); setRootPartnerDraftId((previous) => previous || current.root_partner_person_id || ''); setDonation(payment ? { ...payment } : emptyDonation); setConnections(rows); setFamilies(familyOptions); setLoadReady(true); setAncestorFamilyId((previous) => previous || options.find((person) => person.id === current.root_person_id)?.family_id || (familyOptions.length === 1 ? familyOptions[0].id : '')); }
    catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Нийтлэг модны тохиргоог ачаалж чадсангүй.'); }
    finally { setBusy(false); }
  }, [connectionStatus]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!error) return;
    const alert = document.getElementById('ancestry-error');
    alert?.focus({ preventScroll: true }); alert?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);
  useEffect(() => {
    if (!ancestorFamilyId) { setFamilyPeople([]); setFamilyPeopleReady(false); return; }
    let active = true;
    setFamilyPeopleBusy(true); setFamilyPeopleReady(false);
    api<FamilyWorkspacePeople>(`/admin/families/${encodeURIComponent(ancestorFamilyId)}/workspace`)
      .then((workspace) => { const people = readWorkspacePeople(workspace); if (active) { setFamilyPeople(people); setFamilyPeopleReady(true); } })
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
      if (createFor === 'root') setRootDraftId(created.id);
      else if (createFor === 'partner') setRootPartnerDraftId(created.id);
      else if (createFor === 'connection') { setConnectPersonId(created.id); setConnectStep(2); }
      else setCreatedPerson(created);
      setShowAncestorForm(false);
      setNotice(`${created.last_name} ${created.first_name} хүний бүртгэл аккаунтгүйгээр үүслээ. Хэнтэй яаж холбохыг доороос сонгож батална уу. Холбохгүй бол гэр бүлийн бүртгэлд хэвээр үлдэнэ.`.trim());
      try {
        const [options, workspace] = await Promise.all([
          api<Candidate[]>('/admin/shared-lineage/candidates'),
          api<FamilyWorkspacePeople>(`/admin/families/${encodeURIComponent(ancestorFamilyId)}/workspace`),
        ]);
        setCandidates(options); setFamilyPeople(readWorkspacePeople(workspace));
      } catch {
        setNotice('Хүний бүртгэл амжилттай үүслээ. Жагсаалт шинэчлэгдэхгүй бол хуудсыг дахин ачаална уу. Дахин шинэ хүн үүсгэх шаардлагагүй.');
      }
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Өвөг дээдсийн бүртгэлийг хадгалж чадсангүй.'); }
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
    catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Үндсэн модыг хадгалж чадсангүй.'); }
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
    catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Хандивын мэдээллийг хадгалж чадсангүй.'); }
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
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Холбоосыг шинэчилж чадсангүй.'); }
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
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Бодит холбоосыг салгаж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function saveRootCouple() {
    if (!rootDraftId || !rootPartnerDraftId || rootDraftId === rootPartnerDraftId || !ancestorFamilyId || saving) return;
    const first = familyPeople.find((person) => person.id === rootDraftId);
    const second = familyPeople.find((person) => person.id === rootPartnerDraftId);
    if (!first || !second) { setError('Үндсэн эхийн хоёр хүн сонгосон нэг гэр бүлд бүртгэлтэй байх ёстой.'); return; }
    if (!window.confirm(`${first.last_name} ${first.first_name} болон ${second.last_name} ${second.first_name} хоёрын бодит хосын холбоог бүртгэж, Үндсэн модны эх болгох уу? Одоогийн модны бүртгэлүүд хадгалагдана.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<Tree>('/admin/shared-lineage/root-couple', {
        method: 'PUT', body: JSON.stringify({ root_person_id: rootDraftId, partner_person_id: rootPartnerDraftId, family_id: ancestorFamilyId, expected_root_person_id: tree?.root_person_id || null, status: rootCoupleStatus }),
      });
      setTree(updated); setSelected(updated.root_person_id || '');
      setNotice('Үндсэн эхийн хоёр хүний холбоо баталгаажлаа. Одоо хүүхдүүдийг доорх урсгалаар эцэг/эхэд нь холбоно уу.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Үндсэн эхийн хосыг хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function saveGuidedConnection() {
    const person = candidates.find((item) => item.id === connectPersonId);
    if (!person || !connectRelatedId || saving) return;
    const relation = connectKind === 'child' ? 'хүүхэд' : 'хань';
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await api<Tree>('/admin/shared-lineage/connect-person', {
        method: 'POST', body: JSON.stringify({ person_id: person.id, family_id: person.family_id, related_person_id: connectRelatedId, second_parent_person_id: connectKind === 'child' ? connectSecondParentId || null : null, connection_kind: connectKind, relationship_type: relationshipType, spouse_status: connectSpouseStatus }),
      });
      setTree(updated); setConnectPersonId(''); setConnectRelatedId(''); setConnectSecondParentId(''); setConnectStep(1);
      setNotice(`${person.name} · ${relation} гэсэн бодит холбоо баталгаажлаа. Хувийн түүх, архив, аккаунтын мэдээлэл нийтлэгдээгүй.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Хүний холбоог хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function detachPerson(personId: string) {
    if (saving || !window.confirm(`${sharedName(personId)} хүнийг зөвхөн Үндсэн модноос салгах уу? Хүний бүртгэл, гэр бүлийн бодит эцэг/эх, хань, хүүхдийн холбоо болон хувийн агуулга хадгалагдана. Үлдсэн хүүхдүүдийн нийтлэг модны байрлал өөрчлөгдөж болно.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      setTree(await api<Tree>(`/admin/shared-lineage/people/${encodeURIComponent(personId)}`, { method: 'DELETE' }));
      setInspectedPersonId(''); setNotice('Зөвхөн Үндсэн модны холбоос саллаа. Хүний бүртгэл, гэр бүлийн бодит холбоо хадгалагдсан.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Үндсэн модноос салгаж чадсангүй.'); }
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
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Хүсэлтийг шийдвэрлэж чадсангүй.'); }
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
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Нийтлэг модны холболтыг салгаж чадсангүй.'); }
    finally { setSaving(false); }
  }
  const sharedName = (id: string) => { const person = tree?.persons.find((item) => item.id === id); return person ? `${person.last_name} ${person.first_name}`.trim() : 'Хүн олдсонгүй'; };
  const chosenPerson = candidates.find((person) => person.id === connectPersonId);
  const eligibleSecondParents = (tree?.spouses || []).filter((pair) => pair.person_1_id === connectRelatedId || pair.person_2_id === connectRelatedId).map((pair) => pair.person_1_id === connectRelatedId ? pair.person_2_id : pair.person_1_id);
  const ancestryPaths = sharedAncestryPaths(tree);
  const reachableIds = new Set(ancestryPaths.keys());
  const rootCandidates = familyPeople.filter((person) => candidates.some((candidate) => candidate.id === person.id && candidate.eligible_for_admin_link));
  const firstGeneration = tree?.relationships.filter((edge) => edge.parent_id === tree.root_person_id || edge.parent_id === tree.root_partner_person_id).map((edge) => edge.child_id) ?? [];
  const firstGenerationIds = [...new Set(firstGeneration)];
  const placementPath = (ancestryPaths.get(connectRelatedId) || []).filter((id) => id !== tree?.root_person_id && id !== tree?.root_partner_person_id).map(sharedName);
  function branchStatus(name: string) {
    const matches = tree?.persons.filter((person) => normalizedName(person.first_name) === normalizedName(name) && firstGenerationIds.includes(person.id)) || [];
    if (matches.length > 1) return 'Ижил нэртэй холбоосууд · шалгана уу';
    if (matches.length === 1) {
      const parents = new Set(tree?.relationships.filter((edge) => edge.child_id === matches[0].id).map((edge) => edge.parent_id));
      return tree?.root_person_id && tree.root_partner_person_id && parents.has(tree.root_person_id) && parents.has(tree.root_partner_person_id) ? 'Хоёр эхтэй холбогдсон' : 'Эцэг/эхийн холбоо дутуу';
    }
    return familyPeople.some((person) => normalizedName(person.first_name) === normalizedName(name)) ? 'Бүртгэл байгаа · холбоог шалгана' : 'Бүртгэгдээгүй';
  }
  function startCreation(purpose: typeof createFor, name = '') {
    setCreateFor(purpose); setAncestor({ ...emptyAncestor, first_name: name }); setShowAncestorForm(true);
    window.setTimeout(() => document.getElementById('ancestor-registration')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
  function chooseExistingPerson(id: string) {
    if (createFor === 'root') setRootDraftId(id);
    else if (createFor === 'partner') setRootPartnerDraftId(id);
    else { setConnectPersonId(id); setConnectStep(2); }
    setShowAncestorForm(false); setNotice('Одоо байгаа хүнийг сонголоо. Холбоог шалгаж байж батална уу.');
  }
  function startConnection(relatedId = '', kind: 'child' | 'spouse' = 'child', firstName = '') {
    setFirstBranchName(firstName); setConnectPersonId(''); setConnectRelatedId(relatedId); setConnectKind(kind); setConnectSpouseStatus('married');
    setConnectSecondParentId(firstName ? tree?.root_partner_person_id || '' : ''); setConnectStep(1);
    window.setTimeout(() => document.getElementById('relationship-workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><Link className={styles.brand} href="/admin">ГУУЛИНГИЙНХАН</Link><span className={styles.eyebrow}>НИЙТЛЭГ УДМЫН МОД</span></div><div className={styles.headerActions}><Link className={styles.back} href="/admin">← Админ руу буцах</Link></div></header>
    <section className={styles.content}><div className={styles.heading}><div><span className={styles.eyebrow}>УДМЫН БҮРТГЭЛ</span><h1>Үндсэн удмын эх</h1></div></div>
      {error && <div id="ancestry-error" tabIndex={-1} role="alert" className={styles.error}>{error}</div>}{notice && <div role="status" className={styles.notice}>{notice}</div>}
      {!loadReady && <div className={styles.panel} aria-busy={busy}>{busy ? <p role="status">Удмын эх, гэр бүлийн бүртгэл болон сангийн мэдээллийг ачаалж байна…</p> : <><h3>Бүртгэлийн мэдээлэл ачаалагдсангүй</h3><p className={styles.muted}>Одоогийн эх, хүмүүс болон дансны мэдээллийг шалгасны дараа засварлах боломж нээгдэнэ. Ачаалалт амжилтгүй болсон нь бүртгэл байхгүй гэсэн үг биш.</p><div className={styles.panelActions}><button type="button" onClick={() => void load()}>Дахин ачаалах</button><Link href="/login">Нэвтрэлтээ шалгах →</Link></div></>}</div>}
      {loadReady && <>
      <p className={styles.ancestryLead}>Эхлээд гэр бүлээ сонгож, үндсэн эх болон ханийг баталгаажуулна. Дараа нь хүүхэд, үр удмын холбоог бодит бүртгэлээр нэмнэ.</p>
      <div className={styles.panel}><span className={styles.eyebrow}>01 · ҮНДСЭН ЭХ</span><h3>Үндсэн эхийн хоёр хүнийг батлах</h3><p className={styles.muted}>Эх хүн, ханийг гараар бүртгээд хоёр хүний холбоог шалгаж батална. Бүртгэлтэй хүн байвал дахин үүсгэхгүйгээр сонгоно.</p><label>Бүртгэлийн гэр бүл<select value={ancestorFamilyId} onChange={(event) => { setAncestorFamilyId(event.target.value); setRootDraftId(''); setRootPartnerDraftId(''); }}><option value="">Гэр бүл сонгох</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label><div className={styles.formGrid}>
        <label>Эх хүн<select value={rootDraftId} onChange={(event) => setRootDraftId(event.target.value)}><option value="">Хүн сонгох</option>{rootCandidates.map((person) => <option key={person.id} value={person.id}>{person.last_name} {person.first_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label>
        <label>Хань<select value={rootPartnerDraftId} onChange={(event) => setRootPartnerDraftId(event.target.value)}><option value="">Хүн сонгох</option>{rootCandidates.filter((person) => person.id !== rootDraftId).map((person) => <option key={person.id} value={person.id}>{person.last_name} {person.first_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label>
        <label>Хосын төлөв<select value={rootCoupleStatus} onChange={(event) => setRootCoupleStatus(event.target.value as 'married' | 'widowed')}><option value="married">Гэрлэсэн</option><option value="widowed">Бэлэвсэн</option></select></label>
      </div><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} disabled={!ancestorFamilyId || saving} onClick={() => startCreation('root', 'Ядамсүрэн')}>1. Эх хүнийг бүртгэх</button><button type="button" className={styles.secondaryButton} disabled={!ancestorFamilyId || saving} onClick={() => startCreation('partner', 'Гүнд')}>2. Ханийг бүртгэх</button><button type="button" disabled={saving || busy || !familyPeopleReady || !rootDraftId || !rootPartnerDraftId || rootDraftId === rootPartnerDraftId || (rootDraftId === tree?.root_person_id && rootPartnerDraftId === tree?.root_partner_person_id)} onClick={() => void saveRootCouple()}>3. Үндсэн эх болгох</button></div><p className={styles.muted}>Одоогийн үндэс: <strong>{tree?.root_person_id ? sharedName(tree.root_person_id) : 'тохируулаагүй'}</strong>{tree?.root_partner_person_id ? ` + ${sharedName(tree.root_partner_person_id)}` : ' · хос бүртгэгдээгүй'}</p></div>
      <div className={styles.panel}><span className={styles.eyebrow}>ХҮНИЙ БҮРТГЭЛ</span><h3>Аккаунтгүйгээр хүн бүртгэх</h3><div className={styles.panelActions}><button type="button" disabled={saving} onClick={() => startCreation('person')}>+ Хүнийг гараар бүртгэх</button></div>{createdPerson && <div role="status" className={styles.connectionPreview}><strong>✓ {createdPerson.last_name} {createdPerson.first_name} бүртгэгдлээ</strong><p>Гэр бүлийн бүртгэлд хадгалагдсан. Үндсэн модны байрлал хараахан тогтоогүй.</p><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} onClick={() => setCreatedPerson(null)}>Гэр бүлийн модонд үлдээх</button><button type="button" onClick={() => { setConnectPersonId(createdPerson.id); setFirstBranchName(''); setConnectStep(2); setCreatedPerson(null); document.getElementById('relationship-workflow')?.scrollIntoView({ behavior: 'smooth' }); }}>Үндсэн удамтай холбох</button></div></div>}</div>
      {showAncestorForm && <form id="ancestor-registration" className={styles.panel} onSubmit={(event) => void createAncestor(event)}>
        <span className={styles.eyebrow}>02 · ХҮНИЙ БҮРТГЭЛ</span><h3>Өвөг дээдсээ гараар бүртгэх</h3>
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
         {existingMatches.length > 0 && <div className={styles.duplicateWarning} role="status"><strong>Ижил нэртэй хүн аль хэдийн байна</strong><p>Шинэ хүн үүсгэхээсээ өмнө дараах бүртгэлийг шалгана уу.</p><ul>{existingMatches.map((person) => <li key={person.id}>{person.last_name} {person.first_name}{person.birth_date ? ` · ${person.birth_date}` : ''} · {person.is_alive ? 'Амьд' : 'Нас барсан'}{candidates.some((candidate) => candidate.id === person.id) && <button type="button" onClick={() => { chooseExistingPerson(person.id); }}>Одоо байгаа хүнийг сонгох</button>}</li>)}</ul></div>}
         {otherFamilyMatches.length > 0 && <div className={styles.duplicateWarning} role="status"><strong>Өөр гэр бүлд ижил нэртэй хүн байна</strong><ul>{otherFamilyMatches.map((person) => <li key={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date}` : ''}<button type="button" onClick={() => { chooseExistingPerson(person.id); }}>Одоо байгаа хүнийг сонгох</button></li>)}</ul></div>}
        <div className={styles.panelActions}><button type="submit" disabled={saving || !familyPeopleReady || !ancestorFamilyId || !ancestor.first_name.trim()}>{saving ? 'Хадгалж байна…' : 'Хүнийг гараар бүртгэх'}</button><button type="button" className={styles.secondaryButton} disabled={saving} onClick={() => setShowAncestorForm(false)}>Болих</button></div>
        <p className={styles.muted}>Хүн бүртгэснээр гэрлэлт, эцэг/эх–хүүхдийн холбоо автоматаар үүсэхгүй. Эдгээрийг бодит баримтаар доорх хэсэгт холбоно.</p>
      </form>}
      {busy ? <p role="status" className={styles.state}>Ачаалж байна…</p> : <details className={styles.advanced}><summary>Өмнөх эхийн бүртгэлийг засах</summary><div className={styles.panel}>
        <h3>Нэг эх модыг бүх account-д харуулах</h3><p className={styles.muted}>Энд зөвхөн бодит, насанд хүрсэн, гэр бүлд харагдах Person сонгоно. Сонголт нийтлэг удмын модны эх болно. Хуучин айл тус бүрийн мэдээлэл хэвээр үлдэнэ.</p>
        {tree?.root_person_id && <p className={styles.notice}>Үндсэн эх одоо тохируулагдсан. {tree.persons.length} зөвшөөрөгдсөн хүн нийтлэг модонд байна. Шинэ эх сонгоход хуучин хүн, салааны холбоос болон айл бүрийн мод хэвээр үлдэнэ.</p>}
        {candidates.length ? <label className={styles.profileEditor}>Удмын эхийн хүнийг сонгох<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Хүн сонгох</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label> : <p className={styles.state}>Сонгох боломжтой хүн алга. Дээрх хэсэгт бодит эх хүний бүртгэлийг гараар үүсгээд энд сонгоно уу.</p>}
        <div className={styles.panelActions}><button disabled={!tree?.root_person_id || !selected || selected === tree.root_person_id || saving} onClick={() => void save()}>{saving ? 'Хадгалж байна…' : tree?.root_person_id ? 'Үндсэн эхийг шинэчлэх' : 'Нийтлэг эх мод үүсгэх'}</button><Link href="/admin">Хүмүүсээ админ удирдлагаас бэлдэх →</Link></div>
      </div></details>}
      <div className={styles.panel}><span className={styles.eyebrow}>03 · ЭХНИЙ ДӨРВӨН САЛАА</span><h3>Үндсэн эхийн хүүхдүүд</h3><p className={styles.muted}>Доорх нэрсийг нэг нэгээр нь бодит хүнтэй холбож батална. Нэр давхцсан нь өөрөө холбооны нотолгоо болохгүй.</p><div className={styles.branchSlots}>{['Долгор', 'Нансалмаа', 'Баавай', 'Бадамдорж'].map((name) => <div key={name}><strong>{name}</strong><small>{branchStatus(name)}</small><button type="button" disabled={saving || !tree?.root_person_id || !tree.root_partner_person_id} onClick={() => startConnection(tree?.root_person_id || '', 'child', name)}>{name} нэмэх / шалгах</button></div>)}</div><p className={styles.muted}>Баталгаажсан хүүхдүүд: {firstGenerationIds.length ? firstGenerationIds.map(sharedName).join(' · ') : 'Одоогоор холбоо бүртгэгдээгүй.'}</p></div>
      <section id="relationship-workflow" className={styles.panel} aria-busy={saving}><span className={styles.eyebrow}>04 · ХҮН ХООРОНД ХОЛБОХ</span><h3>{firstBranchName ? `${firstBranchName} · эхний салаа` : 'Хэнийг, хэнтэй холбох вэ?'}</h3><ol className={styles.workflowSteps} aria-label="Холбох алхмууд">{['Хүн сонгох', 'Холбоо сонгох', 'Шалгаж батлах'].map((label, index) => <li key={label} aria-current={connectStep === index + 1 ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol>
        {!tree?.root_person_id ? <p className={styles.state}>Эхлээд үндсэн эхийн хоёр хүнийг батална уу.</p> : <>
        {connectStep === 1 && <><p className={styles.muted}>Бүртгэлтэй хүнээ сонгох эсвэл эндээс шинэ хүн бүртгэнэ. Аккаунттай холбогдсон хүн өөрийн зөвшөөрлөөр хүсэлт илгээнэ.</p><label>Хэнийг нэмэх вэ?<select value={connectPersonId} onChange={(event) => setConnectPersonId(event.target.value)}><option value="">Одоо байгаа хүн сонгох</option>{candidates.filter((person) => person.eligible_for_admin_link && person.id !== tree.root_person_id && person.id !== tree.root_partner_person_id).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} disabled={saving} onClick={() => startCreation('connection', firstBranchName)}>+ Шинэ хүн бүртгэх</button><button type="button" disabled={!chosenPerson || saving} onClick={() => setConnectStep(2)}>Холбоог сонгох →</button></div></>}
        {connectStep === 2 && <><p><strong>{chosenPerson?.name}</strong> хүнийг хаана байрлуулах вэ?</p><div className={styles.formGrid}><label>Ямар холбоотой вэ?<select value={connectKind} disabled={Boolean(firstBranchName)} onChange={(event) => { setConnectKind(event.target.value as 'child' | 'spouse'); setConnectRelatedId(''); setConnectSecondParentId(''); }}><option value="child">Хүүхэд</option><option value="spouse">Хань</option></select></label><label>{connectKind === 'child' ? 'Хэний хүүхэд вэ?' : 'Хэний хань вэ?'}<select value={connectRelatedId} disabled={Boolean(firstBranchName)} onChange={(event) => { setConnectRelatedId(event.target.value); setConnectSecondParentId(''); }}><option value="">Хүн сонгох</option>{tree.persons.filter((person) => reachableIds.has(person.id) && person.id !== connectPersonId).map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{firstGenerationIds.includes(person.id) ? ' · Үндсэн салаа' : ''}</option>)}</select></label>{connectKind === 'child' && <><label>Хоёр дахь эцэг/эх<select value={connectSecondParentId} disabled={Boolean(firstBranchName)} onChange={(event) => setConnectSecondParentId(event.target.value)}><option value="">Одоогоор холбохгүй</option>{eligibleSecondParents.filter((id) => reachableIds.has(id) && id !== connectPersonId).map((id) => <option key={id} value={id}>{sharedName(id)}</option>)}</select></label><label>Хүүхдийн холбоо<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select></label></>}</div><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} onClick={() => setConnectStep(1)}>← Буцах</button><button type="button" disabled={!chosenPerson || !connectRelatedId || connectPersonId === connectRelatedId || saving} onClick={() => setConnectStep(3)}>Урьдчилан харах →</button></div></>}
        {connectStep === 2 && connectKind === 'spouse' && <label>Хосын төлөв<select value={connectSpouseStatus} onChange={(event) => setConnectSpouseStatus(event.target.value as 'married' | 'widowed')}><option value="married">Гэрлэсэн</option><option value="widowed">Бэлэвсэн</option></select></label>}
        {connectStep === 3 && <><h4>Энэ холбоог хадгалах уу?</h4><p className={styles.muted}>Үндсэн эх: {tree.root_person_id ? sharedName(tree.root_person_id) : ""}{tree.root_partner_person_id ? ` + ${sharedName(tree.root_partner_person_id)}` : ""}{placementPath.length ? ` → ${placementPath.join(" → ")}` : ""}</p><div className={styles.connectionPreview}><strong>{sharedName(connectRelatedId)}{connectSecondParentId && connectKind === 'child' ? ` + ${sharedName(connectSecondParentId)}` : ''}</strong><span aria-hidden="true">{connectKind === 'child' ? '↓' : '+'}</span><strong>{chosenPerson?.name}</strong><small>{connectKind === 'spouse' ? (connectSpouseStatus === 'widowed' ? 'Бэлэвсэн хос' : 'Гэрлэсэн хос') : relationshipType === 'biological' ? 'Төрсөн хүүхэд' : relationshipType === 'adoptive' ? 'Үрчилсэн хүүхэд' : 'Дагавар хүүхэд'}</small></div><p className={styles.muted}>Холбоо гэр бүлийн бодит бүртгэлд хадгалагдаж, хүн Үндсэн модонд энэ байрлалд харагдана. Хувийн түүх, архив нийтлэгдэхгүй.</p><div className={styles.panelActions}><button type="button" className={styles.secondaryButton} disabled={saving} onClick={() => setConnectStep(2)}>← Засах</button><button type="button" disabled={saving || !chosenPerson || !connectRelatedId} onClick={() => void saveGuidedConnection()}>{saving ? 'Хадгалж байна…' : connectKind === 'spouse' ? 'Гэрлэсэн хос болгох' : 'Хүүхдийг Үндсэн модонд холбох'}</button></div></>}
        </>}
      </section>
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
      <div className={styles.panel}><h3>Баталгаажсан модны хүмүүс</h3><p className={styles.muted}>Хүнээ нээгээд эцэг/эх, хань, хүүхдүүдийг шалгаж, дараагийн хүнийг тухайн салаанд нэмнэ.</p><div className={styles.branchSlots}>{tree?.persons.filter((person) => reachableIds.has(person.id)).map((person) => <div key={person.id}><button type="button" aria-expanded={inspectedPersonId === person.id} onClick={() => setInspectedPersonId(inspectedPersonId === person.id ? '' : person.id)}>{sharedName(person.id)}</button>{inspectedPersonId === person.id && <><small>Эцэг/эх: {tree.relationships.filter((edge) => edge.child_id === person.id).map((edge) => sharedName(edge.parent_id)).join(' · ') || 'Бүртгэлгүй'}</small><small>Хань: {tree.spouses.filter((pair) => pair.person_1_id === person.id || pair.person_2_id === person.id).map((pair) => sharedName(pair.person_1_id === person.id ? pair.person_2_id : pair.person_1_id)).join(' · ') || 'Бүртгэлгүй'}</small><small>Хүүхэд: {[...new Set(tree.relationships.filter((edge) => edge.parent_id === person.id).map((edge) => edge.child_id))].map(sharedName).join(' · ') || 'Бүртгэлгүй'}</small><button type="button" disabled={saving} onClick={() => startConnection(person.id, 'child')}>+ Хүүхэд нэмэх</button><button type="button" disabled={saving} onClick={() => startConnection(person.id, 'spouse')}>+ Хань нэмэх</button>{person.id !== tree.root_person_id && person.id !== tree.root_partner_person_id && <button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => void detachPerson(person.id)}>Үндсэн модноос салгах</button>}</>}</div>)}</div><Link href="/ancestry">Бүх модыг харах →</Link></div>
      <details className={styles.advanced}><summary>Бүртгэлтэй холбоог засах, салгах</summary><div className={styles.panel}><h3>Бодит холбооны засвар</h3><p className={styles.muted}>Өмнө бүртгэгдсэн хүний холбоог засах хэсэг. Бодит холбоог устгах нь гэр бүлийн модонд нөлөөлнө; Үндсэн модноос салгах үйлдэл нь зөвхөн нийтлэг холболтыг салгана.</p><div className={styles.formGrid}>
        <label>Эцэг / эх<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{person.id === tree.root_person_id ? ' · Үндсэн эх' : ''}</option>)}</select></label>
        <label>Хүүхэд<select value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.filter((person) => person.id !== tree.root_person_id).map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label>
        <label>Холбооны төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select></label>
      </div>{parentId && childId && <div className={styles.connectionPreview}><strong>{sharedName(parentId)}</strong><span aria-hidden="true">↓</span><strong>{sharedName(childId)}</strong><small>Эцэг/эх → хүүхэд</small></div>}<div className={styles.panelActions}><button type="button" disabled={saving || !parentId || !childId || parentId === childId} onClick={() => void changeRelationship('add')}>Хүүхэд холбох</button></div>
      {tree?.relationships.length ? <div className={styles.linkList}>{tree.relationships.map((edge) => <div key={edge.id}><span><b>{sharedName(edge.parent_id)}</b> → <b>{sharedName(edge.child_id)}</b><small>{edge.relationship_type === 'step' ? 'Дагавар' : edge.relationship_type === 'adoptive' ? 'Үрчилсэн' : 'Төрсөн'} · {edge.source === 'canonical' ? 'Бодит холбоо · гэр бүлийн модонд хадгалагдсан' : 'Үндсэн модны хуучин холбоо'}</small></span>{edge.source === 'legacy_projection' ? <button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => { if (window.confirm('Зөвхөн Үндсэн модны хуучин холбоосыг салгах уу? Гэр бүлийн бодит холбоо хадгалагдана.')) void changeRelationship('remove', edge.id); }}>Үндсэн модноос салгах</button> : <button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => void deleteCanonicalRelationship(edge.id)}>Бодит холбоог засах</button>}</div>)}</div> : <p className={styles.state}>Нийтлэг модны холбоос одоогоор алга.</p>}</div></details>
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
      </>}
    </section>
  </div></main>;
}

