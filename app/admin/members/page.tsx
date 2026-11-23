'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import '../admin.css';

type Member = { user_id: string; display_name: string; role: string; person_id?: string | null };
type Invitation = { id: string; email: string; role: string; expires_at: string };
type Access = { owner: boolean; scopes: string[] };
type ParentCandidate = { person_id: string; full_name: string; gender?: string | null; birth_year?: number | null };
type TreeJoinRequest = {
  id: string;
  user_id: string;
  user_name: string;
  first_name: string;
  last_name: string;
  gender?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  biography?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  claimed_generation?: number | null;
  father_person_id?: string | null;
  father_name?: string | null;
  mother_person_id?: string | null;
  mother_name?: string | null;
  declared_father_name?: string | null;
  declared_mother_name?: string | null;
  note?: string | null;
  status: string;
  created_at: string;
  suggested_fathers: ParentCandidate[];
  suggested_mothers: ParentCandidate[];
};
type SmartMatch = {
  request_id: string;
  child_person_id: string;
  child_name: string;
  branch_name?: string | null;
  claimed_generation?: number | null;
  parent_role: string;
  declared_parent_name: string;
  candidate_person_id: string;
  candidate_name: string;
  candidate_birth_year?: number | null;
};

const roleLabel: Record<string, string> = {
  owner: 'Эзэмшигч / Админ',
  editor: 'Засварлагч',
  member: 'Гишүүн',
};

export default function AdminMembersPage() {
  const [family, setFamily] = useState('');
  const [owner, setOwner] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [joinRequests, setJoinRequests] = useState<TreeJoinRequest[]>([]);
  const [smartMatches, setSmartMatches] = useState<SmartMatch[]>([]);
  const [selectedFatherByReq, setSelectedFatherByReq] = useState<Record<string, string>>({});
  const [selectedMotherByReq, setSelectedMotherByReq] = useState<Record<string, string>>({});
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('family') ?? '';
    const controller = new AbortController();
    if (!id) {
      setError('Гэр бүл сонгоно уу.');
      setLoading(false);
      return;
    }
    setFamily(id);
    api<Access>(`/families/${encodeURIComponent(id)}/admin-access`, { signal: controller.signal })
      .then(async (access) => {
        if (!access.scopes.includes('manage_members')) throw new Error('forbidden');
        const [rows, invites, joinReqs, matches] = await Promise.all([
          api<Member[]>(`/families/${encodeURIComponent(id)}/members`, { signal: controller.signal }),
          api<Invitation[]>(`/families/${encodeURIComponent(id)}/invitations`, { signal: controller.signal }),
          access.owner
            ? api<TreeJoinRequest[]>(`/families/${encodeURIComponent(id)}/tree-join-requests?status=pending`, {
                signal: controller.signal,
              }).catch(() => [])
            : Promise.resolve([]),
          access.owner
            ? api<SmartMatch[]>(`/families/${encodeURIComponent(id)}/tree-join-requests/smart-matches`, {
                signal: controller.signal,
              }).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!controller.signal.aborted) {
          setOwner(access.owner);
          setMembers(rows);
          setInvitations(invites);
          setJoinRequests(joinReqs);
          setSmartMatches(matches);
          setAllowed(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Гишүүд, урилгыг удирдах эрхгүй эсвэл ачаалж чадсангүй.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const row = await api<Invitation>(`/families/${encodeURIComponent(family)}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      setInvitations((current) => [row, ...current]);
      setEmail('');
      setNotice('Урилга илгээгдлээ.');
    } catch {
      setError('Урилга илгээж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (busy || !window.confirm('Урилгыг цуцлах уу?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<void>(`/families/${encodeURIComponent(family)}/invitations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setInvitations((current) => current.filter((row) => row.id !== id));
      setNotice('Урилга цуцлагдлаа.');
    } catch {
      setError('Урилга цуцалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function changeMemberRole(userId: string, nextRole: 'editor' | 'member') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api<Member>(
        `/families/${encodeURIComponent(family)}/members/${encodeURIComponent(userId)}`,
        { method: 'PATCH', body: JSON.stringify({ role: nextRole }) },
      );
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? updated : m)));
      setNotice(`${updated.display_name}-ийн эрх "${roleLabel[updated.role] ?? updated.role}" болж шинэчлэгдлээ.`);
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Гишүүний эрх шинэчилж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function approveJoinRequest(req: TreeJoinRequest) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = {};
      const pickedFather = selectedFatherByReq[req.id];
      const pickedMother = selectedMotherByReq[req.id];
      if (pickedFather) payload.father_person_id = pickedFather;
      if (pickedMother) payload.mother_person_id = pickedMother;
      await api<TreeJoinRequest>(
        `/families/${encodeURIComponent(family)}/tree-join-requests/${encodeURIComponent(req.id)}/approve`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setJoinRequests((prev) => prev.filter((item) => item.id !== req.id));
      const refreshedMembers = await api<Member[]>(`/families/${encodeURIComponent(family)}/members`);
      setMembers(refreshedMembers);
      setNotice(`${req.last_name} ${req.first_name} ургийн модонд нэмэгдэж, аккаунттайгаа амжилттай холбогдлоо.`);
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Хүсэлтийг баталж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function rejectJoinRequest(req: TreeJoinRequest) {
    if (busy || !window.confirm(`${req.last_name} ${req.first_name}-ийн хүсэлтээс татгалзах уу?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<TreeJoinRequest>(
        `/families/${encodeURIComponent(family)}/tree-join-requests/${encodeURIComponent(req.id)}/reject`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setJoinRequests((prev) => prev.filter((item) => item.id !== req.id));
      setNotice('Хүсэлт буцаагдлаа.');
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Хүсэлтийг буцааж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function attachSmartMatch(match: SmartMatch) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<void>(
        `/families/${encodeURIComponent(family)}/tree-join-requests/${encodeURIComponent(match.request_id)}/attach-parent`,
        { method: 'POST', body: JSON.stringify({ parent_person_id: match.candidate_person_id }) },
      );
      setSmartMatches((prev) =>
        prev.filter(
          (m) => !(m.request_id === match.request_id && m.parent_role === match.parent_role),
        ),
      );
      setNotice(`${match.candidate_name} нь ${match.child_name}-ийн ${match.parent_role === 'father' ? 'эцэг' : 'эх'} болж холбогдлоо.`);
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Эцэг/эхийн холбоосыг үүсгэж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-console">
      <header className="admin-console__header">
        <h1>Гишүүд, урилга ба ургийн модны хүсэлтүүд</h1>
        <Link href={`/admin?family=${encodeURIComponent(family)}`}>Удирдлага руу буцах</Link>
      </header>
      <section className="admin-console__content">
        {loading && <p role="status">Ачаалж байна…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!loading && allowed && (
          <>
            {owner && joinRequests.length > 0 && (
              <>
                <h2>Ургийн модонд орох хүсэлтүүд ({joinRequests.length})</h2>
                <ul className="admin-console__audit">
                  {joinRequests.map((req) => (
                    <li
                      key={req.id}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <strong>
                          {`${req.last_name} ${req.first_name}`.trim()} ({req.user_name})
                        </strong>
                        <span>
                          {req.branch_name ? `${req.branch_name}` : 'Салбар сонгоогүй'}
                          {req.claimed_generation ? ` • ${req.claimed_generation}-р үе` : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', display: 'grid', gap: '0.2rem' }}>
                        {req.birth_date && <span>Төрсөн огноо: {req.birth_date}</span>}
                        {req.birth_place && <span>Төрсөн газар: {req.birth_place}</span>}
                        {req.father_name && <span>Сонгосон эцэг: {req.father_name}</span>}
                        {req.declared_father_name && !req.father_name && (
                          <span>Бүртгүүлсэн эцгийн нэр: {req.declared_father_name}</span>
                        )}
                        {req.mother_name && <span>Сонгосон эх: {req.mother_name}</span>}
                        {req.declared_mother_name && !req.mother_name && (
                          <span>Бүртгүүлсэн эхийн нэр: {req.declared_mother_name}</span>
                        )}
                        {req.biography && <span>Намтар: {req.biography}</span>}
                        {req.note && <span>Тайлбар: {req.note}</span>}
                      </div>

                      {req.suggested_fathers.length > 0 && (
                        <label style={{ fontSize: '0.86rem' }}>
                          Тохирох эцгийн санал:{' '}
                          <select
                            value={selectedFatherByReq[req.id] ?? ''}
                            onChange={(e) =>
                              setSelectedFatherByReq((prev) => ({ ...prev, [req.id]: e.target.value }))
                            }
                          >
                            <option value="">Холбохгүйгээр үүсгэх</option>
                            {req.suggested_fathers.map((cand) => (
                              <option key={cand.person_id} value={cand.person_id}>
                                {cand.full_name}{cand.birth_year ? ` (${cand.birth_year})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {req.suggested_mothers.length > 0 && (
                        <label style={{ fontSize: '0.86rem' }}>
                          Тохирох эхийн санал:{' '}
                          <select
                            value={selectedMotherByReq[req.id] ?? ''}
                            onChange={(e) =>
                              setSelectedMotherByReq((prev) => ({ ...prev, [req.id]: e.target.value }))
                            }
                          >
                            <option value="">Холбохгүйгээр үүсгэх</option>
                            {req.suggested_mothers.map((cand) => (
                              <option key={cand.person_id} value={cand.person_id}>
                                {cand.full_name}{cand.birth_year ? ` (${cand.birth_year})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void approveJoinRequest(req)}
                        >
                          Батлах ба модонд нэмэх
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void rejectJoinRequest(req)}
                        >
                          Татгалзах
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {owner && smartMatches.length > 0 && (
              <>
                <h2>Ухаалаг эцэг/эх холболтын санал ({smartMatches.length})</h2>
                <ul className="admin-console__audit">
                  {smartMatches.map((m) => (
                    <li key={`${m.request_id}-${m.parent_role}-${m.candidate_person_id}`}>
                      <span>
                        <strong>{m.candidate_name}</strong>
                        {m.candidate_birth_year ? ` (${m.candidate_birth_year})` : ''} нь{' '}
                        <strong>{m.child_name}</strong>
                        {m.branch_name ? ` (${m.branch_name}${m.claimed_generation ? `, ${m.claimed_generation}-р үе` : ''})` : ''}-ийн
                        бүртгүүлсэн {m.parent_role === 'father' ? 'эцэг' : 'эх'} (&ldquo;{m.declared_parent_name}&rdquo;) мөн үү?
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void attachSmartMatch(m)}
                      >
                        Холбох
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2>Гишүүд ({members.length})</h2>
            <ul className="admin-console__audit">
              {members.map((row) => (
                <li key={row.user_id}>
                  <span>
                    <strong>{row.display_name}</strong>
                    {row.person_id ? ' • Модтой холбогдсон' : ' • Холбогдоогүй'}
                  </span>
                  {owner && row.role !== 'owner' ? (
                    <select
                      aria-label={`${row.display_name}-ийн эрх`}
                      value={row.role}
                      disabled={busy}
                      onChange={(e) =>
                        void changeMemberRole(row.user_id, e.target.value as 'editor' | 'member')
                      }
                    >
                      <option value="member">Гишүүн (зөвхөн харах + түүх/чат)</option>
                      <option value="editor">Засварлагч (мод засах эрхтэй)</option>
                    </select>
                  ) : (
                    <span>{roleLabel[row.role] ?? row.role}</span>
                  )}
                </li>
              ))}
            </ul>

            <h2>Урилга илгээх</h2>
            <form className="admin-console__member" onSubmit={invite}>
              <label>
                Имэйл{' '}
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              {owner && (
                <label>
                  Гишүүний төрөл{' '}
                  <select value={role} onChange={(event) => setRole(event.target.value)}>
                    <option value="member">Гишүүн</option>
                    <option value="editor">Засварлагч</option>
                  </select>
                </label>
              )}
              <button disabled={busy}>Урилга илгээх</button>
            </form>

            <h2>Идэвхтэй урилга</h2>
            <ul className="admin-console__audit">
              {invitations.map((row) => (
                <li key={row.id}>
                  <span>
                    {row.email} ({roleLabel[row.role] ?? row.role})
                  </span>
                  <button type="button" disabled={busy} onClick={() => void revoke(row.id)}>
                    Цуцлах
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
