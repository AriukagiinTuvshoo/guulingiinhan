'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import styles from '../admin.module.css';

type Candidate = { id: string; name: string; family_name: string; birth_date: string | null; is_alive: boolean };
type Tree = { root_person_id: string | null; persons: { id: string }[] };
type DonationInfo = { id?: number; title: string; purpose: string; currency: string; bank_name: string; account_name: string; account_number: string; qr_image_url: string | null; is_published: boolean };
const emptyDonation: DonationInfo = { title: '', purpose: '', currency: 'MNT', bank_name: '', account_name: '', account_number: '', qr_image_url: null, is_published: false };

export default function SharedAncestryAdminPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]); const [tree, setTree] = useState<Tree | null>(null);
  const [donation, setDonation] = useState<DonationInfo>(emptyDonation);
  const [selected, setSelected] = useState(''); const [busy, setBusy] = useState(true); const [saving, setSaving] = useState(false);
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
    if (tree?.root_person_id && selected !== tree.root_person_id) { setError('Үндсэн удмын эхийг өөрчлөх аюулгүй шилжүүлгийн урсгал хараахан байхгүй.'); return; }
    setSaving(true); setError(''); setNotice('');
    try { const changed = await api<Tree>('/admin/shared-lineage/root', { method: 'PUT', body: JSON.stringify({ person_id: selected }) }); setTree(changed); setNotice('Үндсэн удмын эхийг бүх account-д нийтлэг мод болголоо.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Үндсэн модыг хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  async function saveDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try { const updated = await api<DonationInfo>('/admin/shared-lineage/donation-info', { method: 'PUT', body: JSON.stringify(donation) }); setDonation(updated); setNotice(updated.is_published ? 'Хандивын мэдээлэл бүх account-д харагдахаар нийтлэгдлээ.' : 'Хандивын мэдээллийг хадгаллаа. Одоогоор нийтлээгүй.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хандивын мэдээллийг хадгалж чадсангүй.'); }
    finally { setSaving(false); }
  }
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><Link className={styles.brand} href="/admin">ГУУЛИНГИЙНХАН</Link><span className={styles.eyebrow}>НИЙТЛЭГ УДМЫН МОД</span></div><div className={styles.headerActions}><Link className={styles.back} href="/admin">← Админ руу буцах</Link></div></header>
    <section className={styles.content}><div className={styles.heading}><div><span className={styles.eyebrow}>🌳 ГУУЛИНГИЙНХНЫ ИХ МОД</span><h1>Үндсэн удмын эх</h1></div></div>
      {error && <div role="alert" className={styles.error}>{error}</div>}{notice && <div role="status" className={styles.notice}>{notice}</div>}
      {busy ? <p role="status" className={styles.state}>Ачаалж байна…</p> : <div className={styles.panel}>
        <h3>Нэг эх модыг бүх account-д харуулах</h3><p className={styles.muted}>Энд зөвхөн бодит, насанд хүрсэн, гэр бүлд харагдах Person сонгоно. Сонголт нийтлэг удмын модны эх болно. Хуучин айл тус бүрийн мэдээлэл хэвээр үлдэнэ.</p>
        {tree?.root_person_id ? <p className={styles.notice}>Үндсэн эх тохируулагдсан. Одоо {tree.persons.length} хүн зөвшөөрлөөр нийтлэг модонд харагдаж байна. Одоогийн хувилбарт эхийг сольж болохгүй.</p> : <>
          {candidates.length ? <label className={styles.profileEditor}>Удмын эхийн хүнийг сонгох<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Хүн сонгох</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.family_name}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label> : <p className={styles.state}>Сонгох боломжтой хүн алга. “Гэр бүл, удам” хэсгээс бодит эх хүний бүртгэл үүсгээд энд сонгоно уу.</p>}
          <div className={styles.panelActions}><button disabled={!selected || saving} onClick={() => void save()}>{saving ? 'Хадгалж байна…' : 'Нийтлэг эх мод үүсгэх'}</button><Link href="/admin">Хүмүүсээ админ удирдлагаас бэлдэх →</Link></div>
        </>}
      </div>}
      <div className={styles.panel}><h3>Салаа нэмж холбох дүрэм</h3><ol><li>Хэрэглэгч өөрийн аккаунттай холбосон хүнийг сонгоно.</li><li>Өөрийн хүн бусад account-д харагдах зөвшөөрлийг өөрөө өгнө.</li><li>Нийтлэг модонд байгаа эцэг/эхийг сонговол түүний салбар болж холбоно. Сонгохгүй бол одоогоор холбоогүй салаа хэвээр байна.</li><li>Хэрэглэгч салбараа салгахад зөвхөн нийтлэг модны холбоос арилна; өөрийн гэр бүлийн мод ба профайл хэвээр.</li></ol></div>
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
