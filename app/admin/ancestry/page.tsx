'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import styles from '../admin.module.css';

type Candidate = { id: string; name: string; family_name: string; birth_date: string | null; is_alive: boolean };
type Tree = { root_person_id: string | null; persons: { id: string; first_name: string; last_name: string; birth_date: string | null }[]; relationships: { id: string; parent_id: string; child_id: string; relationship_type: string }[] };
type DonationInfo = { id?: number; title: string; purpose: string; currency: string; bank_name: string; account_name: string; account_number: string; qr_image_url: string | null; is_published: boolean };
const emptyDonation: DonationInfo = { title: '', purpose: '', currency: 'MNT', bank_name: '', account_name: '', account_number: '', qr_image_url: null, is_published: false };

export default function SharedAncestryAdminPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]); const [tree, setTree] = useState<Tree | null>(null);
  const [donation, setDonation] = useState<DonationInfo>(emptyDonation);
  const [selected, setSelected] = useState(''); const [busy, setBusy] = useState(true); const [saving, setSaving] = useState(false);
  const [parentId, setParentId] = useState(''); const [childId, setChildId] = useState('');
  const [relationshipType, setRelationshipType] = useState('biological');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const [options, current, payment] = await Promise.all([api<Candidate[]>('/admin/shared-lineage/candidates'), api<Tree>('/shared-lineage'), api<DonationInfo | null>('/admin/shared-lineage/donation-info')]); setCandidates(options); setTree(current); setSelected(current.root_person_id || ''); setDonation(payment ? { ...payment } : emptyDonation); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Нийтлэг модны тохиргоог ачаалж чадсангүй.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
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
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try { const updated = await api<DonationInfo>('/admin/shared-lineage/donation-info', { method: 'PUT', body: JSON.stringify(donation) }); setDonation(updated); setNotice(updated.is_published ? 'Хандивын мэдээлэл бүх account-д харагдахаар нийтлэгдлээ.' : 'Хандивын мэдээллийг хадгаллаа. Одоогоор нийтлээгүй.'); }
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
      setTree(updated); setChildId(''); setNotice(action === 'add' ? 'Нийтлэг модны эцэг эх, хүүхдийн холбоос нэмэгдлээ.' : 'Алдаатай холбоос салгагдлаа. Хүмүүсийн профайл хадгалагдсан.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Холбоосыг шинэчилж чадсангүй.'); }
    finally { setSaving(false); }
  }
  const sharedName = (id: string) => { const person = tree?.persons.find((item) => item.id === id); return person ? `${person.last_name} ${person.first_name}`.trim() : 'Хүн олдсонгүй'; };
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><Link className={styles.brand} href="/admin">ГУУЛИНГИЙНХАН</Link><span className={styles.eyebrow}>НИЙТЛЭГ УДМЫН МОД</span></div><div className={styles.headerActions}><Link className={styles.back} href="/admin">← Админ руу буцах</Link></div></header>
    <section className={styles.content}><div className={styles.heading}><div><span className={styles.eyebrow}>🌳 ГУУЛИНГИЙНХНЫ ИХ МОД</span><h1>Үндсэн удмын эх</h1></div></div>
      {error && <div role="alert" className={styles.error}>{error}</div>}{notice && <div role="status" className={styles.notice}>{notice}</div>}
      {busy ? <p role="status" className={styles.state}>Ачаалж байна…</p> : <div className={styles.panel}>
        <h3>Нэг эх модыг бүх account-д харуулах</h3><p className={styles.muted}>Энд зөвхөн бодит, насанд хүрсэн, гэр бүлд харагдах Person сонгоно. Сонголт нийтлэг удмын модны эх болно. Хуучин айл тус бүрийн мэдээлэл хэвээр үлдэнэ.</p>
        {tree?.root_person_id && <p className={styles.notice}>Үндсэн эх одоо тохируулагдсан. {tree.persons.length} зөвшөөрөгдсөн хүн нийтлэг модонд байна. Шинэ эх сонгоход хуучин хүн, салааны холбоос болон айл бүрийн мод хэвээр үлдэнэ.</p>}
        {candidates.length ? <label className={styles.profileEditor}>Удмын эхийн хүнийг сонгох<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Хүн сонгох</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label> : <p className={styles.state}>Сонгох боломжтой хүн алга. “Гэр бүл, удам” хэсгээс бодит эх хүний бүртгэл үүсгээд энд сонгоно уу.</p>}
        <div className={styles.panelActions}><button disabled={!selected || selected === tree?.root_person_id || saving} onClick={() => void save()}>{saving ? 'Хадгалж байна…' : tree?.root_person_id ? 'Үндсэн эхийг шинэчлэх' : 'Нийтлэг эх мод үүсгэх'}</button><Link href="/admin">Хүмүүсээ админ удирдлагаас бэлдэх →</Link></div>
      </div>}
      <div className={styles.panel}><h3>Салаа нэмж холбох дүрэм</h3><ol><li>Хэрэглэгч өөрийн аккаунттай холбосон хүнийг сонгоно.</li><li>Өөрийн хүн бусад account-д харагдах зөвшөөрлийг өөрөө өгнө.</li><li>Нийтлэг модонд байгаа эцэг/эхийг сонговол түүний салбар болж холбоно. Сонгохгүй бол одоогоор холбоогүй салаа хэвээр байна.</li><li>Хэрэглэгч салбараа салгахад зөвхөн нийтлэг модны холбоос арилна; өөрийн гэр бүлийн мод ба профайл хэвээр.</li></ol></div>
      <div className={styles.panel}><h3>🌿 Нийтлэг модны салаа холбох</h3><p className={styles.muted}>Нэг Гуулингийнхны эх модноос хүүхдүүд, тэдний хүүхдүүдээр салаална. Зөвхөн нийтлэг модонд зөвшөөрлөөр орсон хүмүүсийг холбоно; хувийн мод, бүртгэлийг өөрчлөхгүй.</p><div className={styles.formGrid}>
        <label>Эцэг / эх<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{person.id === tree.root_person_id ? ' · Үндсэн эх' : ''}</option>)}</select></label>
        <label>Хүүхэд<select value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">Хүн сонгох</option>{tree?.persons.filter((person) => person.id !== tree.root_person_id).map((person) => <option key={person.id} value={person.id}>{sharedName(person.id)}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label>
        <label>Холбооны төрөл<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн</option><option value="adoptive">Үрчилсэн</option><option value="step">Дагавар</option></select></label>
      </div><div className={styles.panelActions}><button type="button" disabled={saving || !parentId || !childId || parentId === childId} onClick={() => void changeRelationship('add')}>Хүүхэд холбох</button></div>
      {tree?.relationships.length ? <div className={styles.linkList}>{tree.relationships.map((edge) => <div key={edge.id}><span><b>{sharedName(edge.parent_id)}</b> → <b>{sharedName(edge.child_id)}</b><small>{edge.relationship_type === 'step' ? 'Дагавар' : edge.relationship_type === 'adoptive' ? 'Үрчилсэн' : 'Төрсөн'}</small></span><button type="button" className={styles.outlineDanger} disabled={saving} onClick={() => { if (window.confirm('Зөвхөн энэ нийтлэг модны холбоосыг салгах уу?')) void changeRelationship('remove', edge.id); }}>Салгах</button></div>)}</div> : <p className={styles.state}>Нийтлэг модны холбоос одоогоор алга.</p>}</div>
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
