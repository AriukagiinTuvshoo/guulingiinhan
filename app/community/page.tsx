'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import ProfilePhoto from '../../components/profile-photo';
import styles from './community.module.css';

type Post = {
  id: string; kind: 'story' | 'memory' | 'archive'; family_id: string;
  family_name: string; author_name: string; title: string; content: string;
  event_date: string | null; created_at: string;
  thumbnail_url: string | null;
};
type Feed = { items: Post[]; page: number; page_size: number; total: number; has_next: boolean };
const labels = { story: 'Түүх', memory: 'Дурсамж', archive: 'Архив' };
type Kind = 'all' | Post['kind'];
const sections: { kind: Kind; label: string }[] = [
  { kind: 'all', label: 'Бүгд' }, { kind: 'story', label: '📜 Нийтийн түүх' },
  { kind: 'memory', label: '📷 Нийтийн дурсамж' }, { kind: 'archive', label: '📁 Нийтийн архив' },
];

export default function CommunityPage() {
  const { familyId } = useAppShellContext();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('kind');
    setKind(sections.some((section) => section.kind === requested) ? requested as Kind : 'all');
  }, []);
  const load = useCallback(async (nextPage: number, selectedKind: Kind) => {
    setLoading(true); setError('');
    try {
      const result = await api<Feed>(`/community/feed?page=${nextPage}&page_size=12&kind=${selectedKind}`);
      setFeed(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Нийтийн нийтлэлийг ачаалж чадсангүй.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (kind) void load(page, kind); }, [kind, load, page]);

  return <main className={styles.page}>
    <header className={styles.hero}>
      <span className={styles.eyebrow}>ГҮҮЛИНГИЙНХАН · НИЙТИЙН САН</span>
      <h1>Бидний хуваалцсан түүх</h1>
      <p>Гэр бүлүүдийн нийтэд зориулж хуваалцсан түүх, дурсамж, архивыг нэг дороос уншаарай.</p>
      {familyId && <div className={styles.actions}>
        <Link href={`/stories/new?family=${encodeURIComponent(familyId)}`}>+ Түүх нийтлэх</Link>
        <Link href={`/memories?family=${encodeURIComponent(familyId)}`}>Дурсамж нэмэх</Link>
        <Link href={`/archives/new?family=${encodeURIComponent(familyId)}`}>Архив нэмэх</Link>
      </div>}
    </header>
    <nav className={styles.sections} aria-label="Нийтийн өвийн төрлүүд">{sections.map((section) => <Link key={section.kind} href={section.kind === 'all' ? '/community' : `/community?kind=${section.kind}`} onClick={() => { setKind(section.kind); setPage(1); }} aria-current={kind === section.kind ? 'page' : undefined}>{section.label}</Link>)}</nav>
    <div className={styles.note}>Зөвхөн “Нийтийн” гэж тохируулсан бичлэг энд гарна. Гэр бүлийн болон хувийн бичлэг бусад аккаунтад харагдахгүй.</div>
    {error && <div role="alert" className={styles.error}>{error} <button type="button" onClick={() => { if (kind) void load(page, kind); }}>Дахин оролдох</button></div>}
    {loading ? <p role="status">Нийтлэлийг ачаалж байна…</p> : feed?.items.length ? <>
      <div className={styles.count}>{feed.total} нийтлэл</div>
      <div className={styles.list}>{feed.items.map((post) => <article key={`${post.kind}-${post.id}`} className={styles.card}>
        <div className={styles.meta}><span className={styles.kind}>{labels[post.kind]}</span><span>{post.family_name}</span><span>·</span><span>{post.author_name}</span></div>
        {post.thumbnail_url && <ProfilePhoto url={post.thumbnail_url} name={post.title} fallback="" className={styles.photo} />}
        <h2><Link href={`/community/${post.kind}/${encodeURIComponent(post.id)}`}>{post.title}</Link></h2>
        <p className={styles.date}>{new Date(post.event_date ?? post.created_at).toLocaleDateString('mn-MN')}</p>
        {post.content && <p className={styles.content}>{post.content}</p>}
        <Link href={`/community/${post.kind}/${encodeURIComponent(post.id)}`}>Бүтнээр унших →</Link>
      </article>)}</div>
      <nav className={styles.pagination} aria-label="Нийтлэлийн хуудас">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Өмнөх</button>
        <span>{page} / {Math.max(1, Math.ceil(feed.total / feed.page_size))}</span>
        <button type="button" disabled={!feed.has_next} onClick={() => setPage(page + 1)}>Дараах</button>
      </nav>
    </> : !error && <div className={styles.empty}><h2>{kind === 'memory' ? '📷 Нийтийн дурсамж хараахан алга' : kind === 'archive' ? '📁 Нийтийн архив хараахан алга' : '📜 Нийтийн түүх одоогоор алга'}</h2><p>Нийтэд хуваалцахдаа харагдах хүрээг “Нийтийн” гэж сонгоорой.</p></div>}
  </main>;
}
