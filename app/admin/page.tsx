'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '../../lib/api';
import styles from './admin.module.css';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR';
type Identity = { user_id: string; email: string | null; display_name: string; role: Role };
type Overview = { users: number; families: number; admins: number };
type UserRow = { id: string; display_name: string; email: string | null; is_active: boolean; created_at: string };
type FamilyRow = { id: string; name: string; created_at: string };
type AdminRow = UserRow & { role: Role };
type Section = 'overview' | 'users' | 'families' | 'admins';

const labels: Record<Role, string> = {
  SUPER_ADMIN: 'Ерөнхий админ', ADMIN: 'Админ', MODERATOR: 'Хяналтын админ',
};
const pageSize = 25;

export default function AdminPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [selectedRole, setSelectedRole] = useState<'ADMIN' | 'MODERATOR'>('MODERATOR');
  const [confirmation, setConfirmation] = useState<{ userId: string; action: 'grant' | 'revoke'; label: string } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api<Identity>('/admin/me'), api<Overview>('/admin/overview')])
      .then(([who, counts]) => { if (active) { setIdentity(who); setOverview(counts); } })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
        else setError(cause instanceof ApiError && cause.status === 403
          ? 'Энэ хэсэгт хандах админ эрх алга.' : 'Админ мэдээллийг ачаалж чадсангүй.');
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!identity || section === 'overview') return;
    let active = true;
    setBusy(true);
    setError('');
    const request = section === 'users'
      ? api<UserRow[]>(`/admin/users?limit=${pageSize}&offset=${offset}`)
      : section === 'families'
        ? api<FamilyRow[]>(`/admin/families?limit=${pageSize}&offset=${offset}`)
        : api<AdminRow[]>('/admin/admins');
    request.then((data) => {
      if (!active) return;
      if (section === 'users') setUsers(data as UserRow[]);
      if (section === 'families') setFamilies(data as FamilyRow[]);
      if (section === 'admins') setAdmins(data as AdminRow[]);
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError && cause.status === 403
        ? 'Энэ жагсаалтыг үзэх эрх хүрэхгүй.' : 'Мэдээллийг ачаалж чадсангүй.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [identity, section, offset]);

  useEffect(() => {
    if (!confirmation) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) setConfirmation(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [confirmation, working]);

  function show(sectionName: Section) {
    setSection(sectionName); setOffset(0); setError(''); setNotice(''); setConfirmation(null);
  }

  async function findUser() {
    setSelectedUser(null); setError('');
    try {
      const found = await api<UserRow>(`/admin/users/lookup?email=${encodeURIComponent(targetEmail.trim())}`);
      setSelectedUser(found);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Хэрэглэгчийг хайж чадсангүй.');
    }
  }

  async function logout() {
    setWorking(true);
    try {
      await api<void>('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch {
      setError('Гарах үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.');
      setWorking(false);
    }
  }

  async function applyRoleChange() {
    if (!confirmation || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      if (confirmation.action === 'revoke') {
        await api<void>(`/admin/admins/${confirmation.userId}`, { method: 'DELETE' });
        setNotice(`${confirmation.label} хаягийн админ эрх цуцлагдлаа.`);
      } else {
        await api<AdminRow>(`/admin/admins/${confirmation.userId}`, {
          method: 'PUT', body: JSON.stringify({ role: selectedRole }),
        });
        setNotice(`${confirmation.label} хаягт ${labels[selectedRole]} эрх олголоо.`);
      }
      const [rows, counts] = await Promise.all([
        api<AdminRow[]>('/admin/admins'), api<Overview>('/admin/overview'),
      ]);
      setAdmins(rows); setOverview(counts);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Эрхийн өөрчлөлт амжилтгүй боллоо.');
    } finally { setWorking(false); setConfirmation(null); }
  }

  const title = section === 'overview' ? 'Ерөнхий мэдээлэл'
    : section === 'users' ? 'Хэрэглэгчид'
      : section === 'families' ? 'Гэр бүлүүд' : 'Админ эрхүүд';

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div><Link className={styles.brand} href="/dashboard">ГУУЛИНГИЙНХАН</Link><span className={styles.eyebrow}>УДИРДЛАГЫН ОРЧИН</span></div>
        <div className={styles.headerActions}><Link className={styles.back} href="/dashboard">Апп руу буцах →</Link><button type="button" disabled={working} onClick={logout}>Гарах</button></div>
      </header>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Админ цэс">
          <button aria-current={section === 'overview' ? 'page' : undefined} onClick={() => show('overview')}>Ерөнхий</button>
          <button aria-current={section === 'users' ? 'page' : undefined} onClick={() => show('users')}>Хэрэглэгчид</button>
          <button aria-current={section === 'families' ? 'page' : undefined} onClick={() => show('families')}>Гэр бүлүүд</button>
          {identity?.role === 'SUPER_ADMIN' && <button aria-current={section === 'admins' ? 'page' : undefined} onClick={() => show('admins')}>Админ эрхүүд</button>}
        </nav>
        <div className={styles.content}>
          <div className={styles.heading}><div><span className={styles.eyebrow}>СИСТЕМИЙН ХЭМЖЭЭНД</span><h1>{title}</h1></div>
            {identity && <div className={styles.identity}><strong>{identity.display_name}</strong><span>{labels[identity.role]}</span></div>}
          </div>
          {error && <div className={styles.error} role="alert">{error}</div>}
          {notice && <div className={styles.notice} role="status">{notice}</div>}
          {busy && <p role="status" className={styles.state}>Ачаалж байна…</p>}
          {!busy && identity && section === 'overview' && overview && <>
            <p className={styles.intro}>Энд системийн бүртгэлийн тоо харагдана. Гэр бүлийн хувийн түүх, зураг, дурсамж энэ хэсгээс нээгдэхгүй.</p>
            <div className={styles.stats}>
              <div><span>Хэрэглэгч</span><strong>{overview.users}</strong></div>
              <div><span>Идэвхтэй гэр бүл</span><strong>{overview.families}</strong></div>
              <div><span>Админ эрхтэй</span><strong>{overview.admins}</strong></div>
            </div>
          </>}
          {!busy && identity && section === 'users' && <>
            {users.length === 0 ? <p className={styles.state}>Хэрэглэгч алга.</p> : <div className={styles.list}>{users.map((user) => <div className={styles.row} key={user.id}><div><strong>{user.display_name}</strong><span>{user.email || 'Имэйлгүй аккаунт'}</span></div><small>{user.is_active ? 'Идэвхтэй' : 'Идэвхгүй'}</small></div>)}</div>}
            <div className={styles.pagination}><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Өмнөх</button><span>{offset + 1}–{offset + users.length}</span><button disabled={users.length < pageSize} onClick={() => setOffset(offset + pageSize)}>Дараах</button></div>
          </>}
          {!busy && identity && section === 'families' && <>
            {families.length === 0 ? <p className={styles.state}>Идэвхтэй гэр бүл алга.</p> : <div className={styles.list}>{families.map((family) => <div className={styles.row} key={family.id}><strong>{family.name}</strong><small>{new Date(family.created_at).toLocaleDateString('mn-MN')}</small></div>)}</div>}
            <div className={styles.pagination}><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Өмнөх</button><span>{offset + 1}–{offset + families.length}</span><button disabled={families.length < pageSize} onClick={() => setOffset(offset + pageSize)}>Дараах</button></div>
          </>}
          {!busy && identity?.role === 'SUPER_ADMIN' && section === 'admins' && <>
            <p className={styles.intro}>Зөвхөн баталгаажсан, идэвхтэй аккаунтад Админ эсвэл Хяналтын админ эрх олгоно. Ерөнхий админы эрхийг энэ дэлгэцээс өөрчлөхгүй.</p>
            <div className={styles.grant}>
              <label>Хэрэглэгчийн имэйл<input type="email" value={targetEmail} onChange={(event) => { setTargetEmail(event.target.value); setSelectedUser(null); }} placeholder="name@example.com" /></label>
              <button type="button" disabled={!targetEmail.trim()} onClick={findUser}>Хайх</button>
              <label>Эрх<select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as 'ADMIN' | 'MODERATOR')}><option value="ADMIN">Админ</option><option value="MODERATOR">Хяналтын админ</option></select></label>
              <button disabled={!selectedUser?.is_active} onClick={() => selectedUser && setConfirmation({ userId: selectedUser.id, action: 'grant', label: selectedUser.email || selectedUser.display_name })}>Эрх олгох</button>
            </div>
            {selectedUser && <p className={styles.intro}>Олдсон аккаунт: {selectedUser.display_name} · {selectedUser.is_active ? 'идэвхтэй' : 'идэвхгүй'}</p>}
            {admins.length === 0 ? <p className={styles.state}>Админ эрхтэй хэрэглэгч алга.</p> : <div className={styles.list}>{admins.map((admin) => <div className={styles.row} key={admin.id}><div><strong>{admin.display_name}</strong><span>{admin.email || 'Имэйлгүй аккаунт'} · {labels[admin.role]}</span></div>{admin.role !== 'SUPER_ADMIN' && <button onClick={() => setConfirmation({ userId: admin.id, action: 'revoke', label: admin.email || admin.display_name })}>Эрх цуцлах</button>}</div>)}</div>}
          </>}
        </div>
      </div>
    </div>
    {confirmation && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setConfirmation(null); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <h2 id="admin-confirm-title">Эрхийн өөрчлөлтийг батлах</h2>
        <p><strong>{confirmation.label}</strong> хаягийн {confirmation.action === 'revoke' ? 'админ эрхийг цуцална' : `эрхийг ${labels[selectedRole]} болгоно`}.</p>
        <div><button disabled={working} onClick={() => setConfirmation(null)}>Болих</button><button disabled={working} onClick={applyRoleChange}>{working ? 'Хадгалж байна…' : 'Батлах'}</button></div>
      </div>
    </div>}
  </main>;
}
