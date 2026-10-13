'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError, TimelinePage } from '../lib/api';
import DiscoveryState from './discovery-state';
const labels: Record<string, string> = { birth: 'Төрсөн', death: 'Дурсгал', child: 'Хүүхэд', marriage: 'Гэрлэлт', divorced: 'Салалт', widowed: 'Дурсгал', event: 'Үйл явдал', story: 'Түүх', memory: 'Дурсамж', archive: 'Архив' };
export default function PersonTimeline({ familyId, personId }: { familyId: string; personId: string }) {
  const [page, setPage] = useState(1); const [reload, setReload] = useState(0);
  const [data, setData] = useState<TimelinePage | null>(null); const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    void api<TimelinePage>(`/families/${familyId}/persons/${personId}/timeline?page=${page}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Он цагийн мэдээлэл ачаалсангүй.'); });
    return () => controller.abort();
  }, [familyId, personId, page, reload]);
  return <section className="person-timeline" aria-labelledby="person-timeline-title"><h2 id="person-timeline-title">Амьдралын он цаг</h2><p>Бүртгэлтэй огноо, үйл явдал болон танд харагдах өв соёлын материалууд.</p>{error ? <DiscoveryState error={error} retry={() => setReload(r => r + 1)} /> : !data ? <DiscoveryState loading /> : <>{data.items.length ? <ol>{data.items.map(item => <li key={item.id}><time dateTime={item.date || undefined}>{item.date || 'Огноогүй'}</time><div><small>{labels[item.kind] || 'Үйл явдал'}</small>{item.href ? <Link href={item.href}>{item.title} →</Link> : <strong>{item.title}</strong>}</div></li>)}</ol> : <p>Он цагийн мэдээлэл хараахан бүртгээгүй байна.</p>}{data.truncated && <p className="discovery-help">Хэмжээний хязгаартай тойм. Холбоотой түүх, архивын бүрэн жагсаалтыг тус тусын хэсгээс харна уу.</p>}<nav className="discovery-pagination" aria-label="Он цагийн хуудас"><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Өмнөх</button><span>{page} дахь хуудас</span><button type="button" disabled={!data.has_next} onClick={() => setPage(p => p + 1)}>Дараах</button></nav></>}</section>;
}
