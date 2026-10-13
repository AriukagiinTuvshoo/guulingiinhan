'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { SharedRequest, requestKindLabel } from './shared-relative-request';
import styles from './shared-relative-request.module.css';

export default function SharedAncestryReview({ onApproved }: { onApproved?: () => void }) {
  const [rows, setRows] = useState<SharedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try { const result = await api<SharedRequest[]>('/admin/shared-lineage/requests?status=pending&limit=100'); if (version === request.current) setRows(result); }
    catch (cause) { if (version === request.current) setError(cause instanceof ApiError ? cause.message : 'Хүсэлтүүдийг ачаалж чадсангүй.'); }
    finally { if (version === request.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);
  async function decide(row: SharedRequest, approve: boolean) {
    if (busy) return;
    setBusy(row.id); setError(''); setNotice('');
    try {
      await api(`/admin/shared-lineage/requests/${encodeURIComponent(row.id)}/decision`, { method: 'POST', body: JSON.stringify({ approve }) });
      setConfirmId(''); setNotice(approve ? 'Хүсэлт батлагдлаа. Үндсэн мод шинэчлэгдсэн.' : 'Хүсэлтэд татгалзлаа. Хүний бүртгэл хадгалагдсан.');
      await reload(); if (approve) onApproved?.();
    } catch (cause) { setError(cause instanceof ApiError ? cause.validationMessage || cause.message : 'Шийдвэрийг хадгалж чадсангүй.'); }
    finally { setBusy(''); }
  }
  return <section className={styles.summary} aria-labelledby="ancestry-review-title">
    <div className={styles.reviewHeader}><div><span className={styles.kicker}>АДМИНЫ ШАЛГАЛТ</span><h2 id="ancestry-review-title">Хүн нэмэх, холбох хүсэлтүүд{rows.length ? ` · ${rows.length}` : ''}</h2></div><button type="button" disabled={loading || Boolean(busy)} onClick={() => void reload()}>Шинэчлэх</button></div>
    {loading && <p role="status">Хүсэлтүүдийг ачаалж байна…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.note} role="status">{notice}</p>}
    {!loading && !rows.length && !error && <p className={styles.note}>Шалгах шинэ хүсэлт алга.</p>}
    <ul>{rows.map((row) => <li key={row.id} className={styles.reviewRow}><div><strong>{row.person_name}</strong><p>{requestKindLabel[row.kind]}{row.target_name ? ` → ${row.target_name}` : ''}</p><small>{row.family_name} · {new Date(row.requested_at).toLocaleDateString('mn-MN')}</small>
      {row.kind === 'detach' && <p className={styles.note}>Хүний бүртгэл, гэр бүлийн холбоо, түүх, дурсамж хадгалагдана.</p>}
      {confirmId === row.id && <p className={styles.note}>Бүртгэл болон холбоог шалгасны дараа шийдвэрээ баталгаажуулна уу.</p>}
    </div><div className={styles.reviewActions}>
      {confirmId === row.id ? <><button type="button" disabled={Boolean(busy)} onClick={() => void decide(row, true)}>{busy === row.id ? 'Хадгалж байна…' : 'Баталгаажуулж батлах'}</button><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmId('')}>Болих</button></> : <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmId(row.id)}>Шалгаж батлах</button>}
      <button type="button" disabled={Boolean(busy)} onClick={() => void decide(row, false)}>Татгалзах</button>
    </div></li>)}</ul>
  </section>;
}
