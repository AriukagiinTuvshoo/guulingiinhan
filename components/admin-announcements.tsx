'use client';

import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import styles from '../app/admin/admin.module.css';

type Announcement = { id: string; title: string; body: string; is_published: boolean; created_at: string; expires_at: string | null };

export default function AdminAnnouncements({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<Announcement[]>('/admin/announcements').then(setItems)
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
      setItems(await api<Announcement[]>('/admin/announcements'));
      setSelectedId(''); setTitle(''); setBody(''); setPublished(false);
      setNotice('Мэдэгдэл хадгалагдлаа. Нийтэлсэн бол бүх нэвтэрсэн хэрэглэгчид харагдана.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Хадгалж чадсангүй.'); }
    finally { setBusy(false); }
  }

  return <div className={styles.studio}>
    <div className={styles.studioHero}><div><span className={styles.eyebrow}>📣 МЭДЭГДЛИЙН ТӨВ</span><h2>Хэрэглэгчдэд хүрэх мэдээ</h2><p>Нийтэлсэн мэдэгдэл апп дотор нэвтэрсэн бүх хүнд харагдана.</p></div><div className={styles.studioHeroStats}><span><b>{items.filter((item) => item.is_published).length}</b> нийтэлсэн</span><span><b>{items.filter((item) => !item.is_published).length}</b> ноорог</span></div></div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    <div className={styles.studioGrid}>
      {canEdit && <section className={styles.panel}><span className={styles.eyebrow}>✍️ {selectedId ? 'МЭДЭГДЭЛ ЗАСАХ' : 'ШИНЭ МЭДЭГДЭЛ'}</span><h3>{selectedId ? 'Засварлах' : 'Мэдэгдэл бичих'}</h3><label>Гарчиг<input maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Агуулга<textarea rows={7} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} /></label><label className={styles.checkbox}><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} /> Одоо нийтлэх</label><div className={styles.panelActions}><button disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>{busy ? 'Хадгалж байна…' : published ? 'Нийтлэх' : 'Ноорог хадгалах'}</button>{selectedId && <button className={styles.secondaryButton} onClick={() => { setSelectedId(''); setTitle(''); setBody(''); setPublished(false); }}>Болих</button>}</div></section>}
      <section className={styles.panel}><span className={styles.eyebrow}>🗞️ АРХИВ</span><h3>Мэдэгдлүүд</h3>{items.length ? <div className={styles.storyStack}>{items.map((item) => <article key={item.id}><small>{item.is_published ? '🟢 Нийтэлсэн' : '⚪ Ноорог'} · {new Date(item.created_at).toLocaleDateString('mn-MN')}</small><h4>{item.title}</h4><p>{item.body}</p>{canEdit && <button onClick={() => { setSelectedId(item.id); setTitle(item.title); setBody(item.body); setPublished(item.is_published); }}>Засах →</button>}</article>)}</div> : <p className={styles.state}>Мэдэгдэл байхгүй байна.</p>}</section>
    </div>
  </div>;
}
