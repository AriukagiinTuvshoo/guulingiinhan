'use client';

import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import styles from '../app/admin/admin.module.css';

type Announcement = { id: string; title: string; body: string; is_published: boolean; created_at: string; expires_at: string | null };
type Summary = { published: number; drafts: number; archived: number };
type Filter = 'published' | 'drafts' | 'archived';

export default function AdminAnnouncements({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<Filter>('published');
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([api<Announcement[]>('/admin/announcements'), api<Summary>('/admin/announcements/summary')])
      .then(([rows, counts]) => { setItems(rows); setSummary(counts); })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Мэдэгдлийг ачаалж чадсангүй.'));
  }, []);

  async function save() {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/admin/announcements${selectedId ? `/${selectedId}` : ''}`, {
        method: selectedId ? 'PUT' : 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim(), is_published: published, expires_at: null }),
      });
      const [rows, counts] = await Promise.all([api<Announcement[]>('/admin/announcements'), api<Summary>('/admin/announcements/summary')]);
      setItems(rows); setSummary(counts);
      setSelectedId(''); setTitle(''); setBody(''); setPublished(false);
      setNotice('Мэдэгдэл хадгалагдлаа. Нийтэлсэн бол бүх нэвтэрсэн хэрэглэгчид харагдана.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хадгалж чадсангүй.'); }
    finally { setBusy(false); }
  }

  const visibleItems = items.filter((item) => {
    const expired = Boolean(item.expires_at && new Date(item.expires_at).getTime() <= Date.now());
    return filter === 'published' ? item.is_published && !expired : filter === 'archived' ? item.is_published && expired : !item.is_published;
  });
  return <div className={styles.studio}>
    <div className={styles.studioHero}><div><span className={styles.eyebrow}>📣 МЭДЭГДЛИЙН ТӨВ</span><h2>Гуулингийнхны мэдээ</h2><p>Нийтэлсэн мэдээ нэвтэрсэн бүх гишүүнд харагдана. Ноорог бусдад харагдахгүй.</p></div><div className={styles.studioHeroStats}><span><b>{summary?.published ?? '…'}</b> нийтэлсэн</span><span><b>{summary?.drafts ?? '…'}</b> ноорог</span><span><b>{summary?.archived ?? '…'}</b> архив</span></div></div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    <div className={styles.studioGrid}>
      {canEdit && <section className={styles.panel}><span className={styles.eyebrow}>✍️ {selectedId ? 'МЭДЭГДЭЛ ЗАСАХ' : 'ШИНЭ МЭДЭГДЭЛ'}</span><h3>{selectedId ? 'Засварлах' : 'Мэдэгдэл бичих'}</h3><label>Гарчиг<input maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Жишээ: Удмын уулзалтын мэдээ" /></label><label>Агуулга<textarea rows={7} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Гишүүдэд хүргэх мэдээгээ тодорхой бичнэ үү…" /></label><label className={styles.checkbox}><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} /> Бүх гишүүнд нийтлэх</label><div className={styles.panelActions}><button disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>{busy ? 'Хадгалж байна…' : published ? 'Нийтлэх' : 'Ноорог хадгалах'}</button>{selectedId && <button className={styles.secondaryButton} onClick={() => { setSelectedId(''); setTitle(''); setBody(''); setPublished(false); }}>Болих</button>}</div></section>}
      <section className={styles.panel}><span className={styles.eyebrow}>🗞️ МЭДЭЭНИЙ САН</span><h3>Мэдэгдлүүд</h3><div className={styles.panelActions} role="group" aria-label="Мэдэгдлийн төлөв"><button type="button" className={filter === 'published' ? undefined : styles.secondaryButton} onClick={() => setFilter('published')}>Нийтэлсэн</button><button type="button" className={filter === 'drafts' ? undefined : styles.secondaryButton} onClick={() => setFilter('drafts')}>Ноорог</button><button type="button" className={filter === 'archived' ? undefined : styles.secondaryButton} onClick={() => setFilter('archived')}>Архив</button></div><p className={styles.muted}>Сүүлийн 50 мэдээний {filter === 'published' ? 'нийтэлсэн' : filter === 'drafts' ? 'ноорог' : 'хугацаа дууссан'} бичлэг</p>{visibleItems.length ? <div className={styles.storyStack}>{visibleItems.map((item) => <article key={item.id}><small>{item.is_published ? '🟢 Нийтэлсэн' : '⚪ Ноорог'} · {new Date(item.created_at).toLocaleDateString('mn-MN')}</small><h4>{item.title}</h4><p>{item.body}</p>{canEdit && <button onClick={() => { setSelectedId(item.id); setTitle(item.title); setBody(item.body); setPublished(item.is_published); }}>Засах →</button>}</article>)}</div> : <p className={styles.state}>Энэ төлөвийн мэдээ алга.</p>}</section>
    </div>
  </div>;
}
