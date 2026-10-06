'use client';

import Link from 'next/link';
import MemoryInteractions from '../../../../components/memory-interactions';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import ProfilePhoto from '../../../../components/profile-photo';
import StoryContent from '../../../../components/story-content';
import styles from './post.module.css';

type Kind = 'story' | 'memory' | 'archive';
type Post = {
  id: string; kind: Kind; title: string; content: string;
  family_name: string; author_name: string; created_at: string;
  event_date: string | null; photos: string[];
};
const titles: Record<Kind, string> = { story: '📜 Нийтийн түүх', memory: '📷 Нийтийн дурсамж', archive: '📁 Нийтийн архив' };

export default function PublicPostPage() {
  const params = useParams<{ kind: string; id: string }>();
  const kind = params.kind as Kind;
  const valid = kind === 'story' || kind === 'memory' || kind === 'archive';
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!valid) { setError('Бичлэгийн төрөл олдсонгүй.'); setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    void api<Post>(`/community/${kind}/${encodeURIComponent(params.id)}`)
      .then((item) => { if (active) setPost(item); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError && cause.status === 404 ? 'Энэ нийтлэл нийтэд харагдахгүй эсвэл олдсонгүй.' : 'Нийтлэлийг ачаалж чадсангүй.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, params.id, valid]);

  return <main className={styles.page}><div className={styles.shell}>
    <Link className={styles.back} href={`/community?kind=${valid ? kind : 'all'}`}>← Нийтийн өвийн сан</Link>
    {loading ? <p role="status" className={styles.state}>Унших хэсгийг ачаалж байна…</p> : error ? <p role="alert" className={styles.state}>{error}</p> : post && <article className={styles.article}>
      <header><span className={styles.eyebrow}>{titles[post.kind]}</span><h1>{post.title}</h1><p className={styles.meta}>{post.family_name} · {post.author_name} · <time dateTime={post.event_date || post.created_at}>{new Date(post.event_date || post.created_at).toLocaleDateString('mn-MN')}</time></p></header>
      {post.kind === 'memory' && post.photos.length > 0 && <div className={styles.gallery}>{post.photos.map((url, index) => <ProfilePhoto key={url} url={url} name={`${post.title} · зураг ${index + 1}`} fallback="" className={styles.image} />)}</div>}
      <div className={styles.body}>{post.kind !== 'memory' ? <StoryContent body={post.content} publicPhotoUrls={post.photos} /> : post.content || 'Тайлбар оруулаагүй байна.'}</div>
      {post.kind === 'memory' && <MemoryInteractions key={post.id} memoryId={post.id} />}
      <footer>Энэ бичлэгийг зохиогч нь нийтэд хуваалцсан. Хүний хувийн профайл болон гэр бүлийн хаалттай мэдээлэл энд харагдахгүй.</footer>
    </article>}
  </div></main>;
}
