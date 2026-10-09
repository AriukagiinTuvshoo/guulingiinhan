'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useDialogFocus } from './use-dialog-focus';
import styles from './shared-relative-request.module.css';

export type SharedRequestKind = 'child' | 'spouse' | 'detach';
export type SharedRequest = {
  id: string; family_id: string; family_name: string; person_id: string; person_name: string;
  target_person_id: string | null; target_name: string | null; kind: SharedRequestKind;
  relationship_type: string | null; status: string; requested_at: string;
};
type Candidate = { person_id: string; first_name: string; last_name: string; middle_name?: string | null; is_alive: boolean; is_current_user: boolean };
const name = (person: Candidate) => [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ');
const statusLabel: Record<string, string> = { pending: 'Админ шалгаж байна', approved: 'Батлагдсан', rejected: 'Татгалзсан', cancelled: 'Хүсэлт цуцлагдсан' };
export const requestKindLabel: Record<SharedRequestKind, string> = { child: 'Хүүхдийн холбоо', spouse: 'Ханийн холбоо', detach: 'Үндсэн модноос салгах' };

export function SharedRequestStatus({ familyId, revision }: { familyId: string; revision: number }) {
  const [rows, setRows] = useState<SharedRequest[]>([]);
  const [cancelBusy, setCancelBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRows([]);
    setError('');
    if (familyId) void api<SharedRequest[]>(`/families/${encodeURIComponent(familyId)}/shared-ancestry-requests`)
      .then((result) => { if (active) setRows(result); }).catch(() => { if (active) setError('Хүсэлтийн төлөв ачаалагдсангүй. Хуудсаа дахин ачаална уу.'); });
    return () => { active = false; };
  }, [familyId, revision]);
  async function cancel(row: SharedRequest) {
    if (cancelBusy) return;
    setCancelBusy(row.id); setError('');
    try {
      const result = await api<SharedRequest>(`/families/${encodeURIComponent(familyId)}/shared-ancestry-requests/${encodeURIComponent(row.id)}/cancel`, { method: 'POST' });
      setRows((current) => current.map((item) => item.id === result.id ? result : item));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хүсэлтийг цуцалж чадсангүй.'); }
    finally { setCancelBusy(''); }
  }
  if (!rows.length && !error) return null;
  return <section className={styles.summary} aria-label="Миний холболтын хүсэлтүүд">
    <h2>Миний хүсэлтүүд</h2>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <ul>{rows.slice(0, 10).map((row) => <li key={row.id}><span><strong>{row.person_name}</strong><small>{requestKindLabel[row.kind]}{row.target_name ? ` · ${row.target_name}` : ''}</small></span><div className={styles.reviewActions}><span className={styles.status}>{statusLabel[row.status] || row.status}</span>{row.status === 'pending' && <button type="button" disabled={Boolean(cancelBusy)} onClick={() => void cancel(row)}>{cancelBusy === row.id ? 'Цуцалж байна…' : 'Хүсэлт цуцлах'}</button>}</div></li>)}</ul>
  </section>;
}

export default function SharedRelativeRequest({ familyId, canCreate, target, initialKind = 'child', onClose, onSubmitted }: {
  familyId: string; canCreate: boolean; target: { id: string; name: string }; initialKind?: SharedRequestKind;
  onClose: () => void; onSubmitted: () => void;
}) {
  const [kind, setKind] = useState<SharedRequestKind>(initialKind);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [personId, setPersonId] = useState('');
  const [loading, setLoading] = useState(Boolean(familyId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedPerson, setSavedPerson] = useState(false);
  const [consent, setConsent] = useState(false);
  useDialogFocus(true, '#shared-relative-dialog', () => { if (!saving) onClose(); });
  useEffect(() => {
    let active = true;
    if (familyId && initialKind !== 'detach') void api<Candidate[]>(`/families/${encodeURIComponent(familyId)}/root-connection/candidates`)
      .then((rows) => { if (active) setCandidates(rows); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Хүмүүсийг ачаалж чадсангүй.'); })
      .finally(() => { if (active) setLoading(false); });
    else setLoading(false);
    return () => { active = false; };
  }, [familyId, initialKind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!familyId || !consent || saving || loading) return;
    const values = new FormData(event.currentTarget);
    setSaving(true); setError('');
    let requestPersonId = kind === 'detach' ? target.id : personId;
    try {
      if (kind !== 'detach' && mode === 'new') {
        const firstName = String(values.get('first_name') || '').trim();
        const birthDate = String(values.get('birth_date') || '');
        const deathDate = String(values.get('death_date') || '');
        if (!firstName) throw new Error('Хүний нэрийг оруулна уу.');
        if (birthDate && deathDate && deathDate < birthDate) throw new Error('Нас барсан огноо төрсөн огнооноос өмнө байж болохгүй.');
        const person = await api<{ id: string; first_name: string; last_name: string }>(`/families/${encodeURIComponent(familyId)}/persons`, {
          method: 'POST', body: JSON.stringify({
            first_name: firstName, last_name: String(values.get('last_name') || '').trim(),
            gender: String(values.get('gender') || 'unknown'), is_alive: false,
            birth_date: birthDate || null, death_date: deathDate || null,
            short_description: String(values.get('description') || '').trim() || null, visibility: 'family',
          }),
        });
        requestPersonId = person.id;
        setPersonId(person.id); setMode('existing'); setSavedPerson(true);
        setCandidates((rows) => [...rows, { person_id: person.id, first_name: person.first_name, last_name: person.last_name, is_alive: false, is_current_user: false }]);
      }
      if (!requestPersonId) throw new Error('Гэр бүлийнхээ бүртгэлээс хүнийг сонгоно уу.');
      await api<SharedRequest>(`/families/${encodeURIComponent(familyId)}/shared-ancestry-requests`, {
        method: 'POST', body: JSON.stringify({ person_id: requestPersonId, target_person_id: kind === 'detach' ? null : target.id,
          kind, relationship_type: kind === 'detach' ? null : String(values.get('relationship_type') || (kind === 'spouse' ? 'married' : 'biological')), share_consent: kind !== 'detach' }),
      });
      onSubmitted(); onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.validationMessage || cause.message : cause instanceof Error ? cause.message : 'Хүсэлтийг илгээж чадсангүй.');
    } finally { setSaving(false); }
  }

  return <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section id="shared-relative-dialog" className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="shared-relative-title">
      <header><div><span className={styles.kicker}>ҮНДСЭН УДМЫН МОД</span><h2 id="shared-relative-title">{kind === 'detach' ? 'Модноос салгах хүсэлт' : 'Хүнтэй холбоо нэмэх'}</h2><p>{target.name}</p></div><button type="button" className={styles.close} aria-label="Хүсэлтийн цонх хаах" disabled={saving} onClick={onClose}>×</button></header>
      {!familyId ? <div className={styles.note}><p>Эхлээд өөрийн гэр бүлийн орчноо нээж, хүний бүртгэлээ оруулна уу.</p><Link href="/families">Гэр бүлийн орчин →</Link></div> : <form onSubmit={(event) => void submit(event)}>
        {kind !== 'detach' && <>
          <fieldset className={styles.options}><legend>Ямар холбоо нэмэх вэ?</legend>{(['child', 'spouse'] as const).map((value) => <label key={value}><input type="radio" name="kind" checked={kind === value} disabled={saving} onChange={() => { setKind(value); setConsent(false); }} />{value === 'child' ? 'Хүүхэд' : 'Хань'}</label>)}</fieldset>
          <div className={styles.tabs} role="group" aria-label="Хүнийг сонгох арга"><button type="button" aria-pressed={mode === 'existing'} disabled={saving} onClick={() => setMode('existing')}>Бүртгэлтэй хүн сонгох</button>{canCreate && <button type="button" aria-pressed={mode === 'new'} disabled={saving} onClick={() => { setMode('new'); setConsent(false); }}>Нас барсан хүн бүртгэх</button>}</div>
          {mode === 'existing' ? <label>Миний гэр бүлийн хүн<select value={personId} disabled={loading || saving} required onChange={(event) => { setPersonId(event.target.value); setConsent(false); }}><option value="">{loading ? 'Ачаалж байна…' : 'Хүн сонгох'}</option>{candidates.map((person) => <option key={person.person_id} value={person.person_id}>{name(person)}{person.is_current_user ? ' · Миний профайл' : ' · Нас барсан'}</option>)}</select></label> : <div className={styles.fields}>
            <label>Нэр<input name="first_name" required maxLength={120} disabled={saving} autoComplete="off" /></label><label>Овог<input name="last_name" maxLength={120} disabled={saving} autoComplete="off" /></label>
            <label>Хүйс<select name="gender" defaultValue="unknown" disabled={saving}><option value="unknown">Тодорхойгүй</option><option value="male">Эрэгтэй</option><option value="female">Эмэгтэй</option><option value="other">Бусад</option></select></label>
            <label>Төрсөн огноо<input name="birth_date" type="date" disabled={saving} /></label><label>Нас барсан огноо<input name="death_date" type="date" disabled={saving} /></label><label className={styles.wide}>Товч намтар<textarea name="description" rows={3} maxLength={1000} disabled={saving} /></label>
            <p className={`${styles.note} ${styles.wide}`}>Энэ бүртгэл аккаунт шаардахгүй. Амьд хүн өөрийн аккаунтаар зөвшөөрлөө өгнө.</p>
          </div>}
          {mode === 'existing' && !loading && !candidates.length && <p className={styles.note}>Өөрийн баталгаажсан профайл эсвэл таны оруулсан нас барсан хүнийг сонгох боломжтой. <Link href={`/people?family=${encodeURIComponent(familyId)}`}>Хүний бүртгэл рүү →</Link></p>}
          {savedPerson && <p className={styles.note}>Хүний мэдээлэл гэр бүлийн бүртгэлд хадгалагдсан. Холболтын хүсэлтээ илгээнэ үү.</p>}
          <label>{kind === 'child' ? 'Хүүхдийн холбоо' : 'Ханийн холбоо'}<select name="relationship_type" key={kind} defaultValue={kind === 'spouse' ? 'married' : 'biological'} disabled={saving}>{kind === 'child' ? <><option value="biological">Төрсөн хүүхэд</option><option value="adoptive">Үрчилсэн хүүхэд</option><option value="step">Дагавар хүүхэд</option></> : <><option value="married">Гэрлэсэн</option><option value="widowed">Бэлэвсэн</option></>}</select></label>
        </>}
        {kind === 'detach' && <p className={styles.note}>Админ баталсны дараа {target.name} үндсэн модноос сална. Хүний бүртгэл, гэр бүлийн холбоо, түүх, дурсамж хадгалагдана.</p>}
        <label className={styles.consent}><input type="checkbox" checked={consent} disabled={saving} onChange={(event) => setConsent(event.target.checked)} required /><span>{kind === 'detach' ? 'Үндсэн модноос салгах хүсэлтээ баталгаажуулж байна.' : 'Энэ холбоог шалгасан бөгөөд сонгосон хүний нэр, холбоог үндсэн модонд харуулахыг зөвшөөрч байна.'}</span></label>
        <p className={styles.hint}>Админ баталсны дараа үндсэн мод шинэчлэгдэнэ.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={onClose}>Болих</button><button type="submit" className={styles.primary} disabled={saving || loading || !consent}>{saving ? 'Илгээж байна…' : 'Хүсэлт илгээх'}</button></footer>
      </form>}
    </section>
  </div>;
}
