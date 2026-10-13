'use client';

import Link from 'next/link';
import AdminOverview from '../../components/admin-overview';
import AdminShell, { type AdminSection } from '../../components/admin-shell';
import AccountPhoto from '../../components/account-photo';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '../../lib/api';
import styles from './admin.module.css';
import AdminFamilyStudio from '../../components/admin-family-studio';
import AdminAnnouncements from '../../components/admin-announcements';
import { ArchivedFamilies } from '../../components/admin-family-archive';
import { useDialogFocus } from '../../components/use-dialog-focus';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR';
type Identity = { user_id: string; email: string | null; display_name: string; role: Role };
type Overview = { users: number; families: number; admins: number };
type UserRow = { id: string; display_name: string; email: string | null; is_active: boolean; created_at: string };
type FamilyRow = { id: string; name: string; created_at: string };
type AdminRow = UserRow & { role: Role };
type UserDetail = UserRow & { has_profile_photo: boolean; identities: { id: string; provider: string; display_identifier: string | null; verified: boolean }[]; email_verified: boolean; admin_role: Role | null; memberships: { family_id: string; family_name: string; role: string }[]; linked_people: { id: string; family_id: string; first_name: string; last_name: string }[] };
type UserStory = { id: string; family_id: string; title: string; body: string; visibility: string; created_at: string };
type Section = 'overview' | 'users' | 'families' | 'admins' | 'user_detail' | 'family_studio' | 'announcements' | 'audit';
type AuditEvent = { id: string; action: string; target_type: string; target_id: string | null; family_id: string | null; actor_name: string; created_at: string };

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
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [familyRevision, setFamilyRevision] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [canRetryAuth, setCanRetryAuth] = useState(false);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [selectedRole, setSelectedRole] = useState<'ADMIN' | 'MODERATOR'>('MODERATOR');
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [profileName, setProfileName] = useState('');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [stories, setStories] = useState<UserStory[]>([]);
  const [editingStoryId, setEditingStoryId] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [storyBody, setStoryBody] = useState('');
  const [confirmation, setConfirmation] = useState<{ userId: string; action: 'grant' | 'revoke' | 'block' | 'unblock'; label: string } | null>(null);

  useEffect(() => {
    const syncSection = () => {
      const requested = new URLSearchParams(window.location.search).get('section');
      setSection(requested && ['overview', 'users', 'families', 'admins', 'announcements', 'audit'].includes(requested) ? requested as Section : 'overview');
      setOffset(0); setListSearch('');
    };
    syncSection();
    window.addEventListener('popstate', syncSection);
    return () => window.removeEventListener('popstate', syncSection);
  }, []);

  useEffect(() => {
    let active = true;
    setBusy(true); setError(''); setCanRetryAuth(false);
    Promise.all([api<Identity>('/admin/me'), api<Overview>('/admin/overview')])
      .then(([who, counts]) => { if (active) { setIdentity(who); setOverview(counts); } })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
        else {
          const forbidden = cause instanceof ApiError && cause.status === 403;
          setError(forbidden ? 'Энэ хэсэгт хандах админ эрх алга.' : 'Админ мэдээллийг ачаалж чадсангүй.');
          setCanRetryAuth(!forbidden);
        }
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [router, authRevision]);

  useEffect(() => {
    if (!identity || !(['users', 'families', 'admins', 'audit'] as Section[]).includes(section)) return;
    let active = true;
    setBusy(true);
    setError('');
    const request = section === 'users'
      ? api<UserRow[]>(`/admin/users?limit=${pageSize}&offset=${offset}`)
      : section === 'families'
        ? api<FamilyRow[]>(`/admin/families?limit=${pageSize}&offset=${offset}`)
        : section === 'audit'
          ? api<AuditEvent[]>('/admin/audit')
          : api<AdminRow[]>('/admin/admins');
    request.then((data) => {
      if (!active) return;
      if (section === 'users') setUsers(data as UserRow[]);
      if (section === 'families') setFamilies(data as FamilyRow[]);
      if (section === 'admins') setAdmins(data as AdminRow[]);
      if (section === 'audit') setAudit(data as AuditEvent[]);
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError && cause.status === 403
        ? 'Энэ жагсаалтыг үзэх эрх хүрэхгүй.' : 'Мэдээллийг ачаалж чадсангүй.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [identity, section, offset, familyRevision]);

  useDialogFocus(Boolean(confirmation), '[aria-labelledby="admin-confirm-title"]', () => {
    if (!working) setConfirmation(null);
  });

  function show(sectionName: Section) {
    setSection(sectionName); setListSearch(''); setOffset(0); setError(''); setNotice(''); setConfirmation(null);
    const destination = sectionName === 'user_detail' ? 'users' : sectionName === 'family_studio' ? 'families' : sectionName;
    window.history.replaceState(window.history.state, '', destination === 'overview' ? '/admin' : `/admin?section=${destination}`);
  }

  async function accountAction(action: 'recovery' | 'revoke-phone') {
    if (!detail || working) return;
    const text = action === 'recovery' ? 'Энэ хэрэглэгчийн баталгаажсан имэйлд нууц үг сэргээх холбоос илгээх үү?' : 'Утасны баталгаажуулалтыг цуцлах уу? Бүх төхөөрөмжөөс гарна.';
    if (!window.confirm(text)) return;
    setWorking(true); setError('');
    try {
      await api(`/admin/users/${detail.id}/${action === 'recovery' ? 'recovery' : 'phone-verification'}`, {
        method: action === 'recovery' ? 'POST' : 'PUT',
        ...(action === 'revoke-phone' ? { body: JSON.stringify({ verified: false }) } : {}),
      });
      await openUser(detail.id);
    } catch { setError('Үйлдлийг гүйцэтгэх боломжгүй байна. Мэдээлэл болон эрхээ шалгана уу.'); }
    finally { setWorking(false); }
  }

  async function openUser(userId: string) {
    setBusy(true); setError(''); setStories([]); setEditingStoryId('');
    try {
      const found = await api<UserDetail>(`/admin/users/${userId}`);
      setDetail(found);
      setProfileName(found.display_name);
      setSection('user_detail');
      if (identity?.role === 'SUPER_ADMIN') {
        setStories(await api<UserStory[]>(`/admin/users/${userId}/stories`));
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Хэрэглэгчийн мэдээллийг ачаалж чадсангүй.');
    } finally { setBusy(false); }
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

  async function inviteAccount() {
    if (!inviteEmail.trim() || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await api('/admin/users/invite', { method: 'POST', body: JSON.stringify({ email: inviteEmail.trim() }) });
      setNotice('Бүртгүүлэх холбоосыг имэйлээр илгээлээ. Хэрэглэгч өөрөө бүртгэлээ баталгаажуулна.');
      setInviteEmail('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Урилга илгээж чадсангүй.'); }
    finally { setWorking(false); }
  }

  async function saveStory() {
    if (!editingStoryId || !storyTitle.trim() || !storyBody.trim() || working) return;
    setWorking(true); setError('');
    try {
      const changed = await api<UserStory>(`/admin/stories/${editingStoryId}`, {
        method: 'PUT', body: JSON.stringify({ title: storyTitle.trim(), body: storyBody.trim() }),
      });
      setStories((rows) => rows.map((row) => row.id === changed.id ? changed : row));
      setEditingStoryId('');
      setNotice('Түүхийн бичвэрийг хадгаллаа.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Түүхийг хадгалж чадсангүй.'); }
    finally { setWorking(false); }
  }

  async function saveProfile() {
    if (!detail || !profileName.trim() || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const changed = await api<UserRow>(`/admin/users/${detail.id}/profile`, {
        method: 'PUT', body: JSON.stringify({ display_name: profileName.trim() }),
      });
      setDetail({ ...detail, display_name: changed.display_name });
      setNotice('Аккаунтын нэрийг хадгаллаа.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Нэрийг хадгалж чадсангүй.'); }
    finally { setWorking(false); }
  }

  async function applyRoleChange() {
    if (!confirmation || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      if (confirmation.action === 'block' || confirmation.action === 'unblock') {
        const nextActive = confirmation.action === 'unblock';
        await api<UserRow>(`/admin/users/${confirmation.userId}/status`, {
          method: 'PUT', body: JSON.stringify({ is_active: nextActive }),
        });
        setUsers((rows) => rows.map((row) => row.id === confirmation.userId ? { ...row, is_active: nextActive } : row));
        setDetail((current) => current?.id === confirmation.userId ? { ...current, is_active: nextActive } : current);
        setNotice(`${confirmation.label} аккаунт ${nextActive ? 'идэвхжлээ' : 'блоклогдлоо'}.`);
      } else if (confirmation.action === 'revoke') {
        await api<void>(`/admin/admins/${confirmation.userId}`, { method: 'DELETE' });
        setNotice(`${confirmation.label} хаягийн админ эрх цуцлагдлаа.`);
      } else {
        await api<AdminRow>(`/admin/admins/${confirmation.userId}`, {
          method: 'PUT', body: JSON.stringify({ role: selectedRole }),
        });
        setNotice(`${confirmation.label} хаягт ${labels[selectedRole]} эрх олголоо.`);
      }
      if (confirmation.action === 'grant' || confirmation.action === 'revoke') {
        const [rows, counts] = await Promise.all([
          api<AdminRow[]>('/admin/admins'), api<Overview>('/admin/overview'),
        ]);
        setAdmins(rows); setOverview(counts);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Эрхийн өөрчлөлт амжилтгүй боллоо.');
    } finally { setWorking(false); setConfirmation(null); }
  }

  const searchTerm = listSearch.trim().toLocaleLowerCase('mn-MN');
  const visibleUsers = users.filter(user => `${user.display_name} ${user.email || ''}`.toLocaleLowerCase('mn-MN').includes(searchTerm));
  const visibleFamilies = families.filter(family => family.name.toLocaleLowerCase('mn-MN').includes(searchTerm));

  const title = section === 'overview' ? 'Удирдлагын төв'
    : section === 'users' ? 'Хэрэглэгчид'
      : section === 'families' ? 'Гэр бүлүүд'
        : section === 'user_detail' ? 'Хэрэглэгчийн мэдээлэл'
          : section === 'family_studio' ? 'Удмын удирдлага'
            : section === 'announcements' ? 'Мэдэгдлийн төв'
              : section === 'audit' ? 'Өөрчлөлтийн түүх' : 'Админ эрхүүд';

  return <><AdminShell active={section === 'user_detail' ? 'users' : section === 'family_studio' ? 'families' : section} title={title} identity={identity} onOpen={(next: AdminSection) => { if (next === 'root' || next === 'people') return; show(next); }}>
          {error && <div className={styles.error} role="alert">{error}{(!identity && canRetryAuth || identity && ['users', 'families', 'admins', 'audit'].includes(section)) && <div className={styles.panelActions}><button type="button" disabled={busy || working} onClick={() => { if (!identity) setAuthRevision(value => value + 1); else setFamilyRevision(value => value + 1); }}>Дахин ачаалах</button></div>}</div>}
          {notice && <div className={styles.notice} role="status">{notice}</div>}
          {busy && <p role="status" className={styles.state}>Ачаалж байна…</p>}
          {!busy && identity && section === 'overview' && overview && <AdminOverview counts={overview} canManageRoot={identity.role === 'SUPER_ADMIN'} onOpen={show} />}
          {!busy && identity && section === 'users' && <>
            <p className={styles.intro}>Аккаунтын мэдээлэл, гэр бүлийн гишүүнчлэл болон төлөвийг шалгана. Блоклосон хэрэглэгчийн бүх session хүчингүй болно.</p>
            {identity.role === 'SUPER_ADMIN' && <form className={styles.invite} onSubmit={(event) => { event.preventDefault(); void inviteAccount(); }}><label>Шинэ хэрэглэгчийг бүртгүүлэхээр урих<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" required /></label><button type="submit" disabled={working || !inviteEmail.trim()}>{working ? 'Илгээж байна…' : 'Урилга илгээх'}</button><p>Урилга нь аккаунт эсвэл гэр бүлийн гишүүнчлэл автоматаар үүсгэхгүй. Хүлээн авагч өөрөө бүртгүүлж, имэйлээ баталгаажуулна.</p></form>}
            <div className={styles.listToolbar}><label>Энэ хуудсын хэрэглэгчээс хайх<input type="search" value={listSearch} onChange={event => setListSearch(event.target.value)} placeholder="Нэр эсвэл имэйл" /></label><span>{visibleUsers.length} / {users.length} бүртгэл</span></div>
            {visibleUsers.length === 0 ? <p className={styles.state}>{users.length ? 'Энэ хуудсанд тохирох хэрэглэгч алга.' : 'Хэрэглэгч алга.'}</p> : <div className={styles.list}>{visibleUsers.map((user) => <div className={styles.row} key={user.id}><div><strong>{user.display_name}</strong><span>{user.email || 'Имэйлгүй аккаунт'} · {user.is_active ? 'Идэвхтэй' : 'Блоклогдсон'}</span></div><button type="button" onClick={() => openUser(user.id)}>Дэлгэрэнгүй</button></div>)}</div>}
            <div className={styles.pagination}><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Өмнөх</button><span>{users.length ? offset + 1 : 0}–{offset + users.length}</span><button disabled={users.length < pageSize} onClick={() => setOffset(offset + pageSize)}>Дараах</button></div>
          </>}
          {!busy && identity && section === 'user_detail' && detail && <>
            <button className={styles.textButton} type="button" onClick={() => show('users')}>← Хэрэглэгчид рүү буцах</button>
            <div className={styles.detailCard}>
              <div className={styles.detailTop}><div><h2>{detail.display_name}</h2><p>{detail.email || 'Имэйлгүй аккаунт'}</p></div><span>{detail.is_active ? 'Идэвхтэй' : 'Блоклогдсон'}</span></div>
              <dl className={styles.facts}><div><dt>Имэйл</dt><dd>{detail.email_verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}</dd></div><div><dt>Бүртгэсэн</dt><dd>{new Date(detail.created_at).toLocaleDateString('mn-MN')}</dd></div><div><dt>Системийн эрх</dt><dd>{detail.admin_role ? labels[detail.admin_role] : 'Энгийн хэрэглэгч'}</dd></div></dl>
              <div className={styles.facts}>{detail.identities?.map((item) => <div key={item.id}><strong>{item.provider === 'phone' ? 'Утас' : item.provider === 'email' ? 'Имэйл' : 'Google'}</strong><p>{item.display_identifier} · {item.verified ? 'Баталгаажсан' : 'Баталгаажаагүй'}</p></div>)}</div>
              {identity.role !== 'MODERATOR' && <button type="button" disabled={working || !detail.email_verified} onClick={() => void accountAction('recovery')}>Нууц үг сэргээх холбоос илгээх</button>}
              {identity.role === 'SUPER_ADMIN' && <><AccountPhoto endpoint={`/admin/users/${detail.id}/photo`} hasPhoto={detail.has_profile_photo} onChanged={() => void openUser(detail.id)} />
                {detail.identities?.some((item) => item.provider === 'phone' && item.verified) && <button type="button" disabled={working} onClick={() => void accountAction('revoke-phone')}>Утасны баталгаажуулалт цуцлах</button>}</>}

              {identity.role !== 'MODERATOR' && detail.id !== identity.user_id && detail.admin_role !== 'SUPER_ADMIN' && (identity.role === 'SUPER_ADMIN' || !detail.admin_role) && <button className={styles.dangerButton} type="button" onClick={() => setConfirmation({ userId: detail.id, action: detail.is_active ? 'block' : 'unblock', label: detail.email || detail.display_name })}>{detail.is_active ? 'Аккаунт блоклох' : 'Блок гаргах'}</button>}
              {identity.role === 'SUPER_ADMIN' && <div className={styles.profileEditor}><label>Харагдах нэр<input maxLength={120} value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><button disabled={working || !profileName.trim() || profileName.trim() === detail.display_name} type="button" onClick={() => void saveProfile()}>Нэр хадгалах</button></div>}
            </div>
            <h2 className={styles.subheading}>Гэр бүлийн гишүүнчлэл</h2>
            {detail.memberships.length ? <div className={styles.list}>{detail.memberships.map((item) => <div className={styles.row} key={item.family_id}><strong>{item.family_name}</strong><span>{item.role}</span></div>)}</div> : <p className={styles.state}>Гэр бүлийн гишүүнчлэл алга.</p>}
            <h2 className={styles.subheading}>Холбосон хүн</h2>
            {detail.linked_people.length ? <div className={styles.list}>{detail.linked_people.map((person) => <div className={styles.row} key={`${person.family_id}-${person.id}`}><div><strong>{person.last_name} {person.first_name}</strong><span>Person ID: {person.id}</span></div>{identity.role === 'SUPER_ADMIN' && <button type="button" onClick={() => { setSelectedFamilyId(person.family_id); show('family_studio'); }}>Удмын орчинд нээх →</button>}</div>)}</div> : <p className={styles.state}>Удмын хүнтэй холбогдоогүй байна.</p>}
            {identity.role === 'SUPER_ADMIN' && <><h2 className={styles.subheading}>Нийтэлсэн түүхүүд</h2><p className={styles.intro}>Хувийн түүхийг үзэх, бичвэрийг засах үйлдэл аудит бүртгэлд хадгалагдана. Гэр бүлийн холбоос, харагдах хүрээ өөрчлөгдөхгүй.</p>{stories.length ? <div className={styles.list}>{stories.map((story) => <article className={styles.story} key={story.id}>{editingStoryId === story.id ? <div className={styles.storyEditor}><label>Гарчиг<input value={storyTitle} maxLength={180} onChange={(event) => setStoryTitle(event.target.value)} /></label><label>Агуулга<textarea value={storyBody} maxLength={100000} rows={8} onChange={(event) => setStoryBody(event.target.value)} /></label><div><button type="button" disabled={working} onClick={() => setEditingStoryId('')}>Болих</button><button type="button" disabled={working || !storyTitle.trim() || !storyBody.trim()} onClick={() => void saveStory()}>{working ? 'Хадгалж байна…' : 'Хадгалах'}</button></div></div> : <><strong>{story.title}</strong><small>{story.visibility} · {new Date(story.created_at).toLocaleDateString('mn-MN')}</small><p>{story.body}</p><button type="button" onClick={() => { setEditingStoryId(story.id); setStoryTitle(story.title); setStoryBody(story.body); }}>Бичвэр засах</button></>}</article>)}</div> : <p className={styles.state}>Энэ хэрэглэгчийн нийтэлсэн түүх алга.</p>}</>}
          </>}
          {!busy && identity && section === 'families' && <>
            <p className={styles.muted}>Эдгээр нь гэр бүлийн ажлын орчин. Гуулингийнхны нийтлэг эх, дөрвөн үндсэн салааг <Link href="/admin/ancestry">Үндсэн удмын админ</Link>-аас удирдана. Туршилтын орчныг архивлаж, дараа сэргээж болно.</p>
            <div className={styles.listToolbar}><label>Энэ хуудсын гэр бүлээс хайх<input type="search" value={listSearch} onChange={event => setListSearch(event.target.value)} placeholder="Гэр бүлийн нэр" /></label><span>{visibleFamilies.length} / {families.length} бүртгэл</span></div>
            {visibleFamilies.length === 0 ? <p className={styles.state}>{families.length ? 'Энэ хуудсанд тохирох гэр бүл алга.' : 'Идэвхтэй гэр бүл алга.'}</p> : <div className={styles.list}>{visibleFamilies.map((family) => <div className={styles.row} key={family.id}><div><strong>{family.name}</strong><small>{new Date(family.created_at).toLocaleDateString('mn-MN')}</small></div>{identity.role === 'SUPER_ADMIN' && <button type="button" onClick={() => { setSelectedFamilyId(family.id); show('family_studio'); }}>Удмыг удирдах →</button>}</div>)}</div>}
            <div className={styles.pagination}><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Өмнөх</button><span>{families.length ? offset + 1 : 0}–{offset + families.length}</span><button disabled={families.length < pageSize} onClick={() => setOffset(offset + pageSize)}>Дараах</button></div>
          </>}
          {identity?.role === 'SUPER_ADMIN' && section === 'families' && <ArchivedFamilies onRestored={() => { setFamilyRevision(value => value + 1); void api<Overview>('/admin/overview').then(setOverview).catch(() => {}); }} />}
          {!busy && identity?.role === 'SUPER_ADMIN' && section === 'family_studio' && selectedFamilyId && <AdminFamilyStudio familyId={selectedFamilyId} onBack={() => { show('families'); void api<Overview>('/admin/overview').then(setOverview).catch(() => {}); }} />}
          {!busy && identity && section === 'announcements' && <AdminAnnouncements canEdit={identity.role === 'SUPER_ADMIN'} />}
          {!busy && identity?.role === 'SUPER_ADMIN' && section === 'audit' && <div className={styles.panel}><span className={styles.eyebrow}>СИСТЕМИЙН АУДИТ</span><h3>Сүүлийн үйлдлүүд</h3><p className={styles.muted}>Үйлдэл, хийсэн хүн, цаг болон зорилтот бүртгэл хадгалагдана.</p>{audit.length ? <div className={styles.timeline}>{audit.map((event) => <div key={event.id}><span className={styles.timelineDot}/><div><b>{event.action}</b><p>{event.actor_name} · {new Date(event.created_at).toLocaleString('mn-MN')}</p><small>{event.target_type}{event.target_id ? ` · ${event.target_id}` : ''}</small></div></div>)}</div> : <p className={styles.state}>Бүртгэл алга.</p>}</div>}
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
      </AdminShell>
    {confirmation && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setConfirmation(null); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <h2 id="admin-confirm-title">Үйлдлийг батлах</h2>
        <p><strong>{confirmation.label}</strong> хаягийн {confirmation.action === 'revoke' ? 'админ эрхийг цуцална' : confirmation.action === 'block' ? 'аккаунтыг блоклож, бүх session-ийг хүчингүй болгоно' : confirmation.action === 'unblock' ? 'блокийг гаргана' : `эрхийг ${labels[selectedRole]} болгоно`}.</p>
        <div><button disabled={working} onClick={() => setConfirmation(null)}>Болих</button><button disabled={working} onClick={applyRoleChange}>{working ? 'Хадгалж байна…' : 'Батлах'}</button></div>
      </div>
    </div>}
  </>;
}
