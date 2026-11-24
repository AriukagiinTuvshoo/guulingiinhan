'use client';

import { FormEvent, useState } from 'react';
import { ApiError, api } from '../lib/api';
import styles from '../app/admin/admin.module.css';

type Preview = {
  family_id: string; family_name: string; people: number; members: number;
  stories: number; memories: number; archives: number; photos: number;
  shared_people: number; active_connections: number; shared_root: boolean; can_archive: boolean;
};
const errorMessage = (cause: unknown) => cause instanceof ApiError
  ? cause.validationMessage || cause.message : 'Үйлдлийг дуусгаж чадсангүй. Дахин оролдоно уу.';

export default function ArchiveFamilyControl({ familyId, onArchived }: { familyId: string; onArchived: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function inspect() {
    setBusy(true); setError('');
    try { setPreview(await api<Preview>(`/admin/families/${familyId}/archive-preview`)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function archive(event: FormEvent) {
    event.preventDefault();
    if (busy || !preview?.can_archive || confirmation.trim() !== preview.family_name) return;
    setBusy(true); setError('');
    try {
      await api(`/admin/families/${familyId}/archive`, { method: 'POST', body: JSON.stringify({ confirm_name: confirmation.trim() }) });
      onArchived();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel}>
    <h3>Туршилтын гэр бүлийн бүртгэлийг цэгцлэх</h3>
    <p className={styles.muted}>Архивласан гэр бүл идэвхтэй жагсаалт болон нийтийн сангаас хасагдана. Хүмүүс, аккаунт, бодит холбоо, түүх, зураг хадгалагдаж, дараа сэргээх боломжтой.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!preview ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void inspect()}>{busy ? 'Холбоотой мэдээллийг шалгаж байна…' : 'Архивлахаас өмнө шалгах'}</button> : <form onSubmit={archive}>
      <h4>{preview.family_name}</h4>
      <p>Хүмүүс {preview.people} · Гишүүн {preview.members} · Түүх {preview.stories} · Дурсамж {preview.memories} · Архив {preview.archives} · Зураг {preview.photos}</p>
      {!preview.can_archive && <p role="status">Үндсэн модны эх эсвэл нийтлэг модтой холбогдсон бүртгэл байна. Эхлээд тэр холбоог админ удмын хуудсаас шалгана уу.</p>}
      <label>Баталгаажуулах гэр бүлийн нэр<input value={confirmation} onChange={event => setConfirmation(event.target.value)} maxLength={180} autoComplete="off" placeholder={preview.family_name} disabled={busy || !preview.can_archive} /></label>
      <div className={styles.panelActions}>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { setPreview(null); setConfirmation(''); setError(''); }}>Болих</button>
        <button type="submit" className={styles.outlineDanger} disabled={busy || !preview.can_archive || confirmation.trim() !== preview.family_name}>{busy ? 'Архивлаж байна…' : 'Энэ гэр бүлийг архивлах'}</button>
      </div>
    </form>}
  </section>;
}

export function ArchivedFamilies({ onRestored }: { onRestored: () => void }) {
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    if (busy) return;
    setBusy(true); setError('');
    try { setRows(await api('/admin/archived-families?limit=100')); setLoaded(true); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function restore(row: { id: string; name: string }) {
    if (busy || !window.confirm(`${row.name} гэр бүлийг сэргээх үү? Өмнөх гишүүд дахин хандаж, нийтэд тэмдэглэсэн агуулга нийтийн санд дахин харагдана.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/admin/families/${row.id}/restore`, { method: 'POST', body: JSON.stringify({ confirm_name: row.name }) });
      setRows(current => current.filter(family => family.id !== row.id)); onRestored();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <details className={styles.advanced} onToggle={event => { if (event.currentTarget.open && !loaded) void load(); }}>
    <summary>Архивласан гэр бүлүүдийг сэргээх</summary>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {busy && <p role="status">Мэдээллийг шалгаж байна…</p>}
    {loaded && !rows.length && <p className={styles.state}>Архивласан гэр бүл алга.</p>}
    {rows.map(row => <div className={styles.row} key={row.id}><strong>{row.name}</strong><button type="button" disabled={busy} onClick={() => void restore(row)}>Сэргээх</button></div>)}
  </details>;
}
