'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import styles from '../app/admin/admin.module.css';

type Destination = 'users' | 'families' | 'announcements' | 'audit';
type Request = { id: string; person_name: string; target_name: string | null; kind: string; requested_at: string; family_name: string };
type Event = { id: string; action: string; target_type: string; actor_name: string; created_at: string };
const actions: Record<string, string> = {
  'shared_ancestry.change_approved': 'Удмын холболт зөвшөөрсөн',
  'shared_ancestry.change_rejected': 'Удмын холболт татгалзсан',
  'shared_ancestry.change_requested': 'Удмын хүсэлт үүсгэсэн',
  'shared_ancestry.change_cancelled': 'Удмын хүсэлт цуцалсан',
  'admin.user.profile.update': 'Хэрэглэгчийн мэдээлэл зассан',
};
const targets: Record<string, string> = { person: 'Хүн', family: 'Гэр бүл', user: 'Аккаунт', story: 'Түүх', announcement: 'Мэдэгдэл', shared_ancestry_request: 'Удмын хүсэлт' };

export default function AdminOverview({ counts, canManageRoot, onOpen }: {
  counts: { users: number; families: number; admins: number };
  canManageRoot: boolean;
  onOpen: (destination: Destination) => void;
}) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(canManageRoot);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!canManageRoot) return;
    let active = true;
    setLoading(true); setFailed(false);
    Promise.all([api<Request[]>('/admin/shared-lineage/requests?status=pending&limit=100'), api<Event[]>('/admin/audit?limit=5')])
      .then(([pending, recent]) => { if (active) { setRequests(pending); setEvents(recent); } })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManageRoot, revision]);

  return <div className={styles.dashboard}>
    <section className={styles.dashboardWelcome}>
      <div><span className={styles.eyebrow}>УДМЫН САН</span><h2>Өдөр тутмын удирдлага</h2><p>Бүртгэлээ хянаж, удмын холбоог нягталж, гэр бүлийн мэдээг нийтлээрэй.</p></div>
      <Link href="/tree?view=shared" className={styles.dashboardPrimary}>Удмын модыг нээх <span aria-hidden="true">↗</span></Link>
    </section>
    <section className={styles.dashboardMetrics} aria-label="Системийн бүртгэл">
      {([{ label: 'Хэрэглэгчид', value: counts.users, detail: 'Бүртгэлтэй аккаунт', destination: 'users' }, { label: 'Идэвхтэй гэр бүл', value: counts.families, detail: 'Гэр бүлийн ажлын орчин', destination: 'families' }, { label: 'Админ эрхтэй', value: counts.admins, detail: 'Системийн эрхтэй аккаунт', destination: null }] as const).map(item => <div key={item.label}>
        <span>{item.label}</span><strong>{new Intl.NumberFormat('mn-MN').format(item.value)}</strong><small>{item.detail}</small>
        {item.destination && <button type="button" onClick={() => onOpen(item.destination!)}>Жагсаалт харах →</button>}
      </div>)}
      {canManageRoot && <div className={styles.pendingMetric}><span>Хүлээгдэж буй хүсэлт</span><strong>{loading || failed ? '—' : `${requests.length}${requests.length === 100 ? '+' : ''}`}</strong><small>Үндсэн модны холболт</small><Link href="/admin/ancestry#shared-requests">Хүсэлт шалгах →</Link></div>}
    </section>
    {canManageRoot && <div className={styles.dashboardColumns}>
      <section className={styles.dashboardPanel} aria-labelledby="pending-requests-title">
        <div className={styles.dashboardPanelHeading}><h2 id="pending-requests-title">Шалгах хүсэлтүүд</h2><Link href="/admin/ancestry#shared-requests">Бүгдийг харах →</Link></div>
        {loading ? <p className={styles.muted} role="status">Хүсэлтүүдийг ачаалж байна…</p> : failed ? <div className={styles.inlineFailure} role="alert"><p>Хүсэлт ба сүүлийн үйлдлийг ачаалж чадсангүй.</p><button type="button" onClick={() => setRevision(value => value + 1)}>Дахин ачаалах</button></div> : requests.length ? <ul className={styles.dashboardRequestList}>{requests.slice(0, 4).map(request => <li key={request.id}><span className={styles.requestMarker} aria-hidden="true">↗</span><div><strong>{request.person_name}</strong><span>{request.kind === 'detach' ? 'Модноос салгах' : request.kind === 'spouse' ? 'Ханьтай холбох' : 'Хүүхдээр холбох'}{request.target_name ? ` · ${request.target_name}` : ''}</span><small>{request.family_name} · {new Date(request.requested_at).toLocaleDateString('mn-MN')}</small></div><Link href="/admin/ancestry#shared-requests">Нягтлах</Link></li>)}</ul> : <div className={styles.dashboardEmpty}><span aria-hidden="true">✓</span><strong>Хүлээгдэж буй хүсэлт алга</strong><p>Шинэ холболтын хүсэлт энд харагдана.</p></div>}
      </section>
      <section className={styles.dashboardPanel} aria-labelledby="recent-audit-title"><div className={styles.dashboardPanelHeading}><h2 id="recent-audit-title">Сүүлийн үйлдлүүд</h2><button type="button" onClick={() => onOpen('audit')}>Түүх харах →</button></div>
        {!loading && !failed && (events.length ? <ol className={styles.dashboardAudit}>{events.map(event => <li key={event.id}><strong>{actions[event.action] || `${targets[event.target_type] || 'Бүртгэл'}д хийсэн өөрчлөлт`}</strong><span>{event.actor_name}</span><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('mn-MN')}</time></li>)}</ol> : <p className={styles.muted}>Үйлдлийн бүртгэл хараахан алга.</p>)}
        {loading && <p className={styles.muted}>Ачаалж байна…</p>}
      </section>
    </div>}
    <section className={styles.dashboardShortcuts} aria-label="Удирдлагын үндсэн үйлдлүүд">
      <button type="button" onClick={() => onOpen('users')}><strong>Хэрэглэгчийн бүртгэл</strong><span>Аккаунт, гишүүнчлэл, төлөвийг шалгах</span><b aria-hidden="true">→</b></button>
      <button type="button" onClick={() => onOpen('families')}><strong>Гэр бүл ба удам</strong><span>Хүн, холбоос, түүхийг удирдах</span><b aria-hidden="true">→</b></button>
      <button type="button" onClick={() => onOpen('announcements')}><strong>Мэдэгдлийн төв</strong><span>Нийтэлсэн мэдээлэл, ноорогийг харах</span><b aria-hidden="true">→</b></button>
    </section>
  </div>;
}
