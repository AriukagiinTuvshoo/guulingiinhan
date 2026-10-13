'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { heritageLabels, HeritageKind } from '../lib/heritage-links';
export default function HeritageLinks({ familyId, kind, id }: { familyId: string; kind: HeritageKind; id: string }) {
  const [links, setLinks] = useState<{ id: string; kind: HeritageKind; title: string; href: string }[]>([]); const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); setLinks([]); setError(false);
    void api<{ items: typeof links }>(`/families/${familyId}/content-links/${kind}/${id}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setLinks(result.items); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [familyId, kind, id, retry]);
  if (error) return <p role="alert">Холбоотой материалуудыг ачаалж чадсангүй. <button type="button" onClick={() => setRetry(n => n + 1)}>Дахин оролдох</button></p>;
  if (!links.length) return null;
  return <section className="content-links"><h2>Холбоотой материалууд</h2><ul>{links.map(item => <li key={`${item.kind}-${item.id}`}><Link href={item.href}><small>{heritageLabels[item.kind]} · </small>{item.title} →</Link></li>)}</ul></section>;
}
