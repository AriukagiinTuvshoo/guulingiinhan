'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';

type MemberRow = { user_id: string; display_name: string; role: string; person_id?: string | null };
type PersonOption = { id: string; first_name: string; last_name: string; gender?: string | null; birth_date?: string | null };
type LineageRow = { id: string; name: string };
type BranchRow = { id: string; name: string; lineage_id: string };
type JoinRequestRow = {
  id: string;
  first_name: string;
  last_name: string;
  birth_place?: string | null;
  branch_name?: string | null;
  claimed_generation?: number | null;
  father_name?: string | null;
  mother_name?: string | null;
  declared_father_name?: string | null;
  declared_mother_name?: string | null;
  status: string;
  review_note?: string | null;
};

export default function TreeJoinRequestCard({ familyId, userId }: { familyId: string; userId: string }) {
  const [alreadyLinked, setAlreadyLinked] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<JoinRequestRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [open, setOpen] = useState(false);

  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [biography, setBiography] = useState('');
  const [branchId, setBranchId] = useState('');
  const [generation, setGeneration] = useState('');
  const [fatherId, setFatherId] = useState('');
  const [motherId, setMotherId] = useState('');
  const [declaredFather, setDeclaredFather] = useState('');
  const [declaredMother, setDeclaredMother] = useState('');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const base = `/families/${encodeURIComponent(familyId)}`;
    Promise.all([
      api<MemberRow[]>(`${base}/members`, { signal: controller.signal }),
      api<JoinRequestRow[]>(`${base}/tree-join-requests/me`, { signal: controller.signal }).catch(() => []),
      api<PersonOption[]>(`${base}/persons`, { signal: controller.signal }).catch(() => []),
      api<LineageRow[]>(`${base}/lineages`, { signal: controller.signal }).catch(() => []),
    ])
      .then(async ([members, myReqs, personRows, lineages]) => {
        if (controller.signal.aborted) return;
        const me = members.find((m) => m.user_id === userId);
        setAlreadyLinked(Boolean(me?.person_id));
        setRequests(myReqs);
        setPeople(personRows);
        const branchLists = await Promise.all(
          lineages.map((lin) =>
            api<BranchRow[]>(`/lineages/${encodeURIComponent(lin.id)}/branches`, {
              signal: controller.signal,
            }).catch(() => []),
          ),
        );
        if (!controller.signal.aborted) {
          setBranches(branchLists.flat());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAlreadyLinked(true);
      });
    return () => controller.abort();
  }, [familyId, userId]);

  if (alreadyLinked !== false) return null;

  const pendingReq = requests.find((r) => r.status === 'pending');
  const rejectedReq = !pendingReq ? requests.find((r) => r.status === 'rejected') : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !firstName.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      };
      if (gender) payload.gender = gender;
      if (birthDate) payload.birth_date = birthDate;
      if (birthPlace.trim()) payload.birth_place = birthPlace.trim();
      if (biography.trim()) payload.biography = biography.trim();
      if (branchId) payload.branch_id = branchId;
      if (generation) payload.claimed_generation = Number(generation);
      if (fatherId) payload.father_person_id = fatherId;
      if (motherId) payload.mother_person_id = motherId;
      if (!fatherId && declaredFather.trim()) payload.declared_father_name = declaredFather.trim();
      if (!motherId && declaredMother.trim()) payload.declared_mother_name = declaredMother.trim();
      if (note.trim()) payload.note = note.trim();

      const created = await api<JoinRequestRow>(
        `/families/${encodeURIComponent(familyId)}/tree-join-requests`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setRequests((prev) => [created, ...prev]);
      setOpen(false);
      setNotice('Таны ургийн модонд бүртгүүлэх хүсэлт админ руу амжилттай илгээгдлээ.');
    } catch (cause: unknown) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Хүсэлт илгээхэд алдаа гарлаа. Мэдээллээ шалгаад дахин оролдоно уу.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Ургийн модонд өөрийгөө холбох"
      style={{
        border: '1px solid var(--border-accent, var(--gold-border))',
        borderRadius: '1rem',
        padding: '1.25rem 1.5rem',
        background: 'var(--bg-surface)',
        marginBottom: '1.5rem',
        display: 'grid',
        gap: '0.85rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold, var(--gold-500))', fontWeight: 700 }}>
            УРГИЙН МОДНЫ ХОЛБООС
          </p>
          <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
            Таны аккаунт ургийн модны хүнтэй хараахан холбогдоогүй байна
          </h2>
        </div>
        {!pendingReq && (
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary-btn"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Форм хаах' : 'Өөрийгөө модонд бүртгүүлэх'}
            </button>
            <Link
              href={`/tree?family=${encodeURIComponent(familyId)}`}
              className="ghost-btn"
            >
              Модноос өөрийгөө олох
            </Link>
          </div>
        )}
      </div>

      {notice && <p role="status" style={{ margin: 0, color: 'var(--brand-primary)', fontWeight: 600 }}>{notice}</p>}
      {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}

      {pendingReq && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '0.75rem',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>
            Хүлээгдэж буй хүсэлт: {pendingReq.last_name} {pendingReq.first_name}
          </strong>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {pendingReq.branch_name ? `Салбар: ${pendingReq.branch_name} • ` : ''}
            {pendingReq.claimed_generation ? `${pendingReq.claimed_generation}-р үе • ` : ''}
            Админ баталмагц таны профайл ургийн модонд автоматаар холбогдоно.
          </p>
        </div>
      )}

      {rejectedReq && !open && (
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Өмнөх хүсэлт буцаагдсан{rejectedReq.review_note ? ` (${rejectedReq.review_note})` : ''}. Та мэдээллээ засаад дахин илгээх боломжтой.
        </p>
      )}

      {open && !pendingReq && (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.9rem', marginTop: '0.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Овог</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ж.нь: Батболд" />
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Өөрийн нэр *</span>
              <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ж.нь: Тэмүүлэн" />
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Хүйс</span>
              <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female' | '')}>
                <option value="">Сонгох</option>
                <option value="male">Эрэгтэй</option>
                <option value="female">Эмэгтэй</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Төрсөн огноо</span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Төрсөн газар</span>
              <input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="Аймаг / хот, сум" />
            </label>
            {branches.length > 0 && (
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
                <span>Аль салбарын удам бэ?</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">Салбар сонгох</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Хэддэх үе вэ?</span>
              <select value={generation} onChange={(e) => setGeneration(e.target.value)}>
                <option value="">Сонгох</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                  <option key={g} value={String(g)}>{g}-р үе</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Эцэг (модноос сонгох)</span>
              <select value={fatherId} onChange={(e) => setFatherId(e.target.value)}>
                <option value="">Модонд хараахан байхгүй</option>
                {people.filter((p) => p.gender !== 'female').map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.last_name} ${p.first_name}`.trim()}
                  </option>
                ))}
              </select>
            </label>
            {!fatherId && (
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
                <span>Эцгийн нэр (гараар бичих)</span>
                <input
                  value={declaredFather}
                  onChange={(e) => setDeclaredFather(e.target.value)}
                  placeholder="Эцэг нь модонд ороогүй бол нэрийг нь бичнэ үү"
                />
              </label>
            )}
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
              <span>Эх (модноос сонгох)</span>
              <select value={motherId} onChange={(e) => setMotherId(e.target.value)}>
                <option value="">Модонд хараахан байхгүй</option>
                {people.filter((p) => p.gender !== 'male').map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.last_name} ${p.first_name}`.trim()}
                  </option>
                ))}
              </select>
            </label>
            {!motherId && (
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
                <span>Эхийн нэр (гараар бичих)</span>
                <input
                  value={declaredMother}
                  onChange={(e) => setDeclaredMother(e.target.value)}
                  placeholder="Эх нь модонд ороогүй бол нэрийг нь бичнэ үү"
                />
              </label>
            )}
          </div>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
            <span>Товч намтар / өөрийн мэдээлэл</span>
            <textarea
              rows={2}
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              placeholder="Боловсрол, ажил мэргэжил, сонирхол гэх мэт..."
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.88rem' }}>
            <span>Админд үлдээх тайлбар</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ж.нь: Баавуугийн 4-р үеийн ач хүү байна"
            />
          </label>

          <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>
              Болих
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? 'Илгээж байна…' : 'Админ руу хүсэлт илгээх'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
