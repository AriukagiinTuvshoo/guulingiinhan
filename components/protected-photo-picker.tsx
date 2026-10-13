 'use client';
import { useEffect, useState } from 'react';
import { api, MemoryListItem } from '../lib/api';
import ProfilePhoto from './profile-photo';
export default function ProtectedPhotoPicker({ familyId, onSelect }: { familyId: string; onSelect: (id: string, title: string) => void }) {
  const [open, setOpen] = useState(false); const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: MemoryListItem[]; has_next: boolean } | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return; const controller = new AbortController(); setLoading(true); setError('');
    api<{ items: MemoryListItem[]; has_next: boolean }>(`/families/${familyId}/memories?page=${page}&page_size=12`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Зургийг ачаалж чадсангүй. Хаагаад дахин нээнэ үү.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [familyId, open, page]);
  return <section className="heritage-photo-picker"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>📷 Хадгалсан зураг оруулах</button>
    {open && <div><p>Гэр бүлийн дурсамжийн сангаас зураг сонгоно. Харагдах хүрээг хадгалах үед дахин шалгана.</p>
      {loading ? <p role="status">Зургийг ачаалж байна…</p> : error ? <p role="alert">{error}</p> : <div className="heritage-photo-options">{data?.items.flatMap((memory) => (memory.photos ?? []).map((photo) => <button type="button" key={photo.id} onClick={() => { onSelect(photo.id, photo.title || memory.title); setOpen(false); }}><ProfilePhoto className="heritage-picker-image" url={photo.thumbnail_url} name={photo.title || memory.title} fallback="Зураг олдсонгүй" /><span>{photo.title || memory.title}</span></button>))}</div>}
      {!loading && data && !data.items.some((memory) => memory.photos?.length) && <p>Энэ хуудсанд зураг алга. Дурсамжийн санд зургаа оруулаарай.</p>}
      <nav aria-label="Зургийн хуудас"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Өмнөх</button><span>{page}</span><button type="button" disabled={loading || !data?.has_next} onClick={() => setPage(page + 1)}>Дараах</button></nav>
    </div>}
  </section>;
}
