'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';

type Member = { user_id: string; display_name: string; role: string };
type Invitation = { id: string; email: string; role: 'member' | 'editor'; expires_at: string; created_at: string; status: 'pending' };

function friendlyError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Дахин нэвтэрнэ үү.';
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 404) return 'Гэр бүл олдсонгүй эсвэл танд хандах эрхгүй байна.';
    if (cause.status === 409) return 'Энэ үйлдэл зөрчилтэй байна. Дахин оролдоно уу.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return fallback;
}

function FamiliesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitFamilyId = searchParams.get('family')?.trim() ?? '';
  const [families, setFamilies] = useState<Family[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'editor'>('member');
  const [mutation, setMutation] = useState<'edit' | 'archive' | 'invite' | 'revoke' | ''>('');
  const sequence = useRef(0);
  const detailSequence = useRef(0);

  const selectedFamily = useMemo(
    () => families.find((family) => family.id === selectedFamilyId) ?? null,
    [families, selectedFamilyId],
  );

  const loadFamilies = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await api<Family[]>('/families');
      if (current !== sequence.current) return;
      setFamilies(data);
      const validExplicit = explicitFamilyId && data.some((family) => family.id === explicitFamilyId);
      if (validExplicit) {
        setSelectedFamilyId(explicitFamilyId);
      } else if (!explicitFamilyId && data[0]) {
        setSelectedFamilyId(data[0].id);
        router.replace('/families?family=' + encodeURIComponent(data[0].id));
      } else {
        setSelectedFamilyId('');
      }
    } catch (cause) {
      if (current !== sequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(friendlyError(cause, 'Гэр бүлүүдийг ачаалж чадсангүй.'));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [explicitFamilyId, router]);

  const loadDetails = useCallback(async (familyId: string) => {
    const current = ++detailSequence.current;
    setDetailLoading(true);
    setDetailError('');
    setMembers([]);
    setInvitations([]);
    try {
      const [memberData, invitationData] = await Promise.all([
        api<Member[]>(`/families/${familyId}/members`),
        api<Invitation[]>(`/families/${familyId}/invitations`),
      ]);
      if (current !== detailSequence.current) return;
      setMembers(memberData);
      setInvitations(invitationData);
    } catch (cause) {
      if (current === detailSequence.current) {
        setDetailError(friendlyError(cause, 'Гишүүд болон урилгуудыг ачаалж чадсангүй.'));
      }
    } finally {
      if (current === detailSequence.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFamilies();
    return () => { sequence.current += 1; };
  }, [loadFamilies]);

  useEffect(() => {
    if (!selectedFamily) {
      setMembers([]);
      setInvitations([]);
      setEditing(false);
      return;
    }
    setName(selectedFamily.name);
    setDescription(selectedFamily.description ?? '');
    setEditing(false);
    void loadDetails(selectedFamily.id);
  }, [selectedFamily, loadDetails]);

  function selectFamily(id: string) {
    if (!families.some((family) => family.id === id) || mutation) return;
    setSelectedFamilyId(id);
    router.replace('/families?family=' + encodeURIComponent(id));
    setNotice('');
  }

  async function saveFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFamily || mutation) return;
    const nextName = name.trim();
    if (!nextName) { setDetailError('Гэр бүлийн нэр хоосон байж болохгүй.'); return; }
    setMutation('edit'); setDetailError(''); setNotice('');
    try {
      const updated = await api<Family>(`/families/${selectedFamily.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName, description: description.trim() || null }),
      });
      setFamilies((current) => current.map((family) => family.id === updated.id ? updated : family));
      setEditing(false);
      setNotice('Гэр бүлийн мэдээлэл хадгалагдлаа.');
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Гэр бүлийн мэдээллийг хадгалж чадсангүй.'));
    } finally { setMutation(''); }
  }

  async function archiveFamily() {
    if (!selectedFamily || selectedFamily.role !== 'owner' || mutation) return;
    if (!window.confirm(`“${selectedFamily.name}” гэр бүлийг архивлах уу? Энэ үйлдэл тухайн гэр бүлийг идэвхтэй жагсаалтаас гаргана.`)) return;
    const archivedId = selectedFamily.id;
    setMutation('archive'); setDetailError(''); setNotice('');
    try {
      await api<void>(`/families/${archivedId}`, { method: 'DELETE' });
      const remaining = families.filter((family) => family.id !== archivedId);
      setFamilies(remaining);
      if (remaining.length) {
        const next = remaining[0].id;
        setSelectedFamilyId(next);
        router.replace('/families?family=' + encodeURIComponent(next));
        setNotice('Гэр бүл архивлагдлаа.');
      } else {
        setSelectedFamilyId('');
        router.replace('/families');
        setNotice('Гэр бүл архивлагдлаа. Танд одоогоор идэвхтэй гэр бүл алга.');
      }
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Гэр бүлийг архивлаж чадсангүй.'));
    } finally { setMutation(''); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFamily || selectedFamily.role !== 'owner' || mutation) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setMutation('invite'); setDetailError(''); setNotice('');
    try {
      await api(`/families/${selectedFamily.id}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role: inviteRole }),
      });
      setInviteEmail('');
      setNotice(`${email} хаяг руу урилга илгээгдлээ.`);
      await loadDetails(selectedFamily.id);
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Урилга илгээж чадсангүй.'));
    } finally { setMutation(''); }
  }

  async function revokeInvitation(invitationId: string, email: string) {
    if (!selectedFamily || selectedFamily.role !== 'owner' || mutation) return;
    if (!window.confirm(`“${email}” хаягийн урилгыг цуцлах уу?`)) return;
    setMutation('revoke'); setDetailError(''); setNotice('');
    try {
      await api<void>(`/families/${selectedFamily.id}/invitations/${invitationId}`, { method: 'DELETE' });
      setNotice('Урилгыг цуцаллаа.');
      await loadDetails(selectedFamily.id);
    } catch (cause) {
      setDetailError(friendlyError(cause, 'Урилгыг цуцалж чадсангүй.'));
    } finally { setMutation(''); }
  }

  const invalid = !loading && !error && Boolean(explicitFamilyId) && !selectedFamily;
  return (
    <main className="mvp" aria-busy={loading}>
      <section className="mvpbox">
        <div className="row space">
          <div>
            <Link href={selectedFamily ? `/dashboard?family=${encodeURIComponent(selectedFamily.id)}` : '/dashboard'}>← Аппын нүүр</Link>
            <h1 style={{ marginTop: 22 }}>Миний гэр бүлүүд</h1>
            <p>Таны membership-тэй бодит гэр бүлүүдийг удмын модны context-тэй нь удирдана.</p>
          </div>
          <div className="row">
            <Link className="button" href={selectedFamily ? `/settings?family=${encodeURIComponent(selectedFamily.id)}` : '/settings'}>Тохиргоо</Link>
            <Link className="button" href="/onboarding">+ Гэр бүл үүсгэх</Link>
          </div>
        </div>

        {loading ? <p role="status" aria-live="polite">Гэр бүлүүдийг ачаалж байна…</p> :
        error ? <div className="error" role="alert"><p>{error}</p><button type="button" onClick={() => void loadFamilies()}>Дахин оролдох</button></div> :
        invalid ? <div className="error" role="alert"><h2>Гэр бүл олдсонгүй</h2><p>Энэ Family ID таны authorized family context-д байхгүй байна.</p><button type="button" onClick={() => router.replace('/families')}>Гэр бүлүүд рүү буцах</button></div> :
        families.length === 0 ? <div className="card" style={{ marginTop: 20 }}><h2>Ургийн модоо эхлүүлээрэй</h2><p>Танд одоогоор идэвхтэй family membership алга.</p><Link className="button" href="/onboarding">Гэр бүл үүсгэх</Link></div> :
        <div className="row" style={{ alignItems: 'flex-start', gap: 20, marginTop: 20 }}>
          <aside style={{ minWidth: 240, flex: '0 1 280px' }} aria-label="Гэр бүл сонгох">
            <h2>Гэр бүлүүд</h2>
            <div className="cards">
              {families.map((family) => <button key={family.id} type="button" aria-pressed={selectedFamilyId === family.id} disabled={Boolean(mutation)} onClick={() => selectFamily(family.id)} style={{ textAlign: 'left', width: '100%' }}>
                <strong>{family.name}</strong><br /><span>{family.role}</span>
              </button>)}
            </div>
          </aside>

          <div style={{ flex: '1 1 560px' }}>
            {notice && <div className="success" role="status" aria-live="polite">{notice}</div>}
            {detailError && <div className="error" role="alert"><p>{detailError}</p>{selectedFamily && <button type="button" onClick={() => void loadMembers(selectedFamily.id)}>Дахин оролдох</button>}</div>}
            {selectedFamily && <section className="card" aria-labelledby="family-detail-title">
              <div className="row space">
                <div><span className="tag">{selectedFamily.role}</span><h2 id="family-detail-title">{selectedFamily.name}</h2><p>{selectedFamily.description || 'Гэр бүлийн хувийн орон зай.'}</p></div>
                <div className="row">
                  <Link className="button" href={`/tree?family=${encodeURIComponent(selectedFamily.id)}`}>Ургийн мод →</Link>
                  <Link className="button" href={`/people?family=${encodeURIComponent(selectedFamily.id)}`}>Хүмүүс →</Link>
                </div>
              </div>

              {editing ? <form onSubmit={saveFamily} style={{ marginTop: 18 }}>
                <label>Гэр бүлийн нэр<input value={name} onChange={(event) => setName(event.target.value)} maxLength={180} required disabled={mutation === 'edit'} /></label>
                <label>Тайлбар<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={10000} rows={4} disabled={mutation === 'edit'} /></label>
                <div className="row"><button className="primary" type="submit" disabled={Boolean(mutation)}>{mutation === 'edit' ? 'Хадгалж байна…' : 'Хадгалах'}</button><button type="button" disabled={Boolean(mutation)} onClick={() => { setName(selectedFamily.name); setDescription(selectedFamily.description ?? ''); setEditing(false); }}>Болих</button></div>
              </form> : <div className="row" style={{ marginTop: 12 }}>
                {(selectedFamily.role === 'owner' || selectedFamily.role === 'editor') && <button type="button" disabled={Boolean(mutation)} onClick={() => setEditing(true)}>Гэр бүлийн мэдээлэл засах</button>}
                {selectedFamily.role === 'owner' && <button type="button" disabled={Boolean(mutation)} onClick={() => void archiveFamily()}>Гэр бүлийг архивлах</button>}
              </div>}

              <hr style={{ margin: '24px 0' }} />
              <h3>Гишүүд</h3>
              {detailLoading ? <p role="status" aria-live="polite">Гишүүд болон урилгуудыг ачаалж байна…</p> : members.length ? <ul>{members.map((member) => <li key={member.user_id}>{member.display_name} · <strong>{member.role}</strong></li>)}</ul> : <p>Гишүүний мэдээлэл одоогоор алга.</p>}

              <section aria-labelledby="pending-invitations-title" style={{ marginTop: 24 }}>
                <h3 id="pending-invitations-title">Хүлээгдэж буй урилгууд</h3>
                {detailLoading ? null : invitations.length ? (
                  <ul>
                    {invitations.map((invitation) => (
                      <li key={invitation.id} style={{ marginBottom: 10 }}>
                        <span>{invitation.email}</span> · <strong>{invitation.role}</strong>
                        <span> · {new Date(invitation.expires_at).toLocaleDateString('mn-MN')}</span>
                        {selectedFamily.role === 'owner' && (
                          <button
                            type="button"
                            disabled={Boolean(mutation)}
                            onClick={() => void revokeInvitation(invitation.id, invitation.email)}
                            style={{ marginLeft: 8 }}
                          >
                            {mutation === 'revoke' ? 'Цуцалж байна…' : 'Цуцлах'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p>Хүлээгдэж буй урилга алга.</p>}
              </section>

              {selectedFamily.role === 'owner' && <form onSubmit={invite} style={{ marginTop: 20 }}>
                <h3>Гишүүн урих</h3>
                <label>Имэйл<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} maxLength={320} required disabled={Boolean(mutation)} /></label>
                <label>Эрх<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'member' | 'editor')} disabled={Boolean(mutation)}><option value="member">Гишүүн</option><option value="editor">Засварлагч</option></select></label>
                <button className="primary" type="submit" disabled={Boolean(mutation)}>{mutation === 'invite' ? 'Илгээж байна…' : 'Урилга илгээх'}</button>
              </form>}
            </section>}
          </div>
        </div>}
      </section>
    </main>
  );
}

export default function FamiliesPage() {
  return <Suspense fallback={<main className="mvp"><section className="mvpbox"><p role="status">Гэр бүлүүдийг ачаалж байна…</p></section></main>}><FamiliesContent /></Suspense>;
}
