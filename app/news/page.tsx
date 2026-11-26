'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import styles from './news.module.css';

type Announcement = {
  id: string; title: string; body: string; created_at: string;
  is_published: boolean; expires_at: string | null;
};

const pageSize = 12;

export default function NewsPage() {
  const { familyId, currentFamily } = useAppShellContext();
  const [items, setItems] = useState<Announcement[]>([]);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async (next: number) => {
    setLoading(true); setError('');
    try {
      const rows = await api<Announcement[]>(`/announcements?limit=${pageSize}&offset=${(next - 1) * pageSize}`);
      setItems(rows);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Мэдээг ачаалж чадсангүй.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(page); }, [load, page]);

  useEffect(() => {
    let active = true;
    void api('/admin/me')
      .then(() => { if (active) setIsAdmin(true); })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, []);

  const canPublish = isAdmin || currentFamily?.role === 'owner';
  const treeHref = familyId ? `/tree?family=${encodeURIComponent(familyId)}` : '/tree';
  const publishHref = familyId ? `/admin?family=${encodeURIComponent(familyId)}&tab=content` : '/admin?tab=content';

  return <main className={styles.page}>
    <nav style={{ marginBottom: 12 }} aria-label="Замын мөр">
      <Link href={treeHref} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ui-text-secondary, var(--ink))', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 40 }}>
        ← Удмын мод руу буцах
      </Link>
    </nav>
    <header className={styles.hero} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <span>📣 ГУУЛИНГИЙНХНЫ МЭДЭЭ</span>
        <h1>Мэдэгдлийн төв</h1>
        <p>Гэр бүлийнхэнтэйгээ хуваалцах зар, уулзалт, чухал мэдээлэл нэг дор.</p>
      </div>
      {canPublish && (
        <Link
          href={publishHref}
          className="ui-btn ui-btn--primary"
          style={{ minHeight: 44, padding: '10px 18px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        >
          <Plus size={16} aria-hidden="true" /> Шинэ мэдээ нийтлэх
        </Link>
      )}
    </header>
    {error && <div role="alert" className={styles.error}>{error} <button type="button" onClick={() => void load(page)}>Дахин оролдох</button></div>}
    {loading ? <p role="status" className={styles.state}>Мэдээг ачаалж байна…</p> : items.length === 0 && !error ? (
      <section className={styles.state}>
        <h2>📣 Одоогоор шинэ мэдээ алга</h2>
        <p>Админ нийтэлсэн мэдээ энд харагдана.</p>
        {canPublish && (
          <div style={{ marginTop: 14 }}>
            <Link
              href={publishHref}
              className="ui-btn ui-btn--primary"
              style={{ minHeight: 44, padding: '10px 18px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Plus size={16} aria-hidden="true" /> Анхны мэдээгээ нийтлэх
            </Link>
          </div>
        )}
      </section>
    ) : <div className={styles.list}>{items.map((item) => <article className={styles.article} key={item.id}>
      <div className={styles.meta}><span>МЭДЭЭ</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('mn-MN')}</time></div>
      <h2>{item.title}</h2><p>{openId === item.id ? item.body : item.body.slice(0, 180) + (item.body.length > 180 ? '…' : '')}</p>
      {item.body.length > 180 && <button type="button" aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? null : item.id)}>{openId === item.id ? 'Хураах ↑' : 'Бүтнээр унших →'}</button>}
    </article>)}</div>}
    {!loading && items.length > 0 && <nav className={styles.pagination} aria-label="Мэдээний хуудас"><button type="button" disabled={page === 1} onClick={() => { setPage(page - 1); setOpenId(null); }}>Өмнөх</button><span>{page}-р хуудас</span><button type="button" disabled={items.length < pageSize} onClick={() => { setPage(page + 1); setOpenId(null); }}>Дараах</button></nav>}
  </main>;
}
