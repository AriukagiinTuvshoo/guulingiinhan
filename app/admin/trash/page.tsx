'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import '../admin.css';

type TrashItem = { id: string; person_id: string; first_name: string; last_name: string; deleted_at: string };
type TrashPageData = { items: TrashItem[]; page: number; page_size: number; total: number; has_next: boolean };

const empty: TrashPageData = { items: [], page: 1, page_size: 25, total: 0, has_next: false };

export default function TrashPage() {
  const [family, setFamily] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TrashPageData>(empty);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setFamily(new URLSearchParams(window.location.search).get('family') ?? '');
  }, []);

  const load = useCallback(() => {
    if (!family) { setError('Гэр бүл сонгоно уу.'); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api<TrashPageData>(`/families/${encodeURIComponent(family)}/trash?page=${page}&page_size=${empty.page_size}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        // The server only pages records this member may see, so a page can go
        // empty after another tab restores items; step back instead of stalling.
        if (page > 1 && result.items.length === 0 && result.total <= (page - 1) * result.page_size) {
          setPage(page - 1);
          return;
        }
        setData(result); setLoading(false);
      })
      .catch(() => { if (!controller.signal.aborted) { setError('Хогийн савыг харах эрхгүй эсвэл ачаалж чадсангүй.'); setLoading(false); } });
    return () => controller.abort();
  }, [family, page, revision]);

  useEffect(() => load(), [load]);

  async function restore(item: TrashItem) {
    if (busy) return;
    setBusy(item.id); setError('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/trash/${encodeURIComponent(item.id)}/restore`, { method: 'POST' });
      setRevision((value) => value + 1);
    } catch { setError('Сэргээж чадсангүй. Эрх болон удмын оноолтын зөрчлийг шалгана уу.'); }
    finally { setBusy(''); }
  }

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));

  return <main className="admin-console"><header className="admin-console__header"><h1>Хогийн сав</h1><Link href={`/admin?family=${encodeURIComponent(family)}`}>Удирдлага руу буцах</Link></header>
    <section className="admin-console__content"><p>Гэр бүлээс салгасан хүмүүс. Сэргээх эрх нь хувийн болон guardian хяналтаар шалгагдана.</p>
      {loading && <p role="status">Ачаалж байна…</p>}{error && <p role="alert">{error}</p>}
      {!loading && !error && !data.items.length && <p>Сэргээх бүртгэл алга.</p>}
      <ul className="admin-console__audit">{data.items.map((item) => <li key={item.id}><strong>{item.last_name} {item.first_name}</strong><time dateTime={item.deleted_at}>{new Date(item.deleted_at).toLocaleString('mn-MN')}</time><button disabled={!!busy} onClick={() => void restore(item)}>{busy === item.id ? 'Сэргээж байна…' : 'Сэргээх'}</button></li>)}</ul>
      {data.total > data.page_size && <nav aria-label="Хогийн савны хуудас"><button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Өмнөх</button> <span>{data.page} / {pages} ({data.total})</span> <button disabled={!data.has_next} onClick={() => setPage(data.page + 1)}>Дараах</button></nav>}
    </section></main>;
}
