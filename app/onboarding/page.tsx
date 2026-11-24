'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, LogOut, Plus, ShieldCheck, Sparkles, Trash2, Users } from 'lucide-react';
import { ApiError, api, type Family, type User } from '../../lib/api';
import SmartDateInput from '../../components/smart-date-input';
import { ThemePicker } from '../../components/theme-picker';

type OnboardingStatus = {
  approved: boolean;
  is_admin: boolean;
  clan_family_id: string | null;
  clan_family_name: string;
  pending_request: {
    id: string;
    status: string;
    claimed_generation: number | null;
    created_at: string;
  } | null;
  last_rejected: {
    id: string;
    review_note: string | null;
  } | null;
};

type BranchOption = { id: string; name: string; generation: number };
type AncestorNode = {
  id: string;
  name: string;
  generation: number;
  branch_root_id: string;
  parent_ids: string[];
};
type OnboardingOptions = {
  clan_family_id: string | null;
  root_label: string;
  branches: BranchOption[];
  nodes: AncestorNode[];
};

type RelativeDraft = {
  key: string;
  relation: 'parent' | 'spouse' | 'child' | 'sibling';
  last_name: string;
  first_name: string;
  gender: 'male' | 'female' | 'unknown';
  birth_date: string;
  is_alive: boolean;
  email: string;
};

const RELATION_LABELS: Record<RelativeDraft['relation'], string> = {
  parent: 'Эцэг / Эх (дунд үеийн дутуу хүн)',
  spouse: 'Хань (Эхнэр / Нөхөр)',
  child: 'Хүүхэд (Хүү / Охин)',
  sibling: 'Ах, эгч, дүү',
};

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts.at(-1) ?? '', last_name: parts.slice(0, -1).join(' ') };
}

const failure = (cause: unknown) =>
  cause instanceof ApiError
    ? cause.validationMessage || cause.message
    : 'Холболт тасарлаа. Дахин оролдоно уу.';

export default function OnboardingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteFamilyId = params.get('family') || '';

  const [user, setUser] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [options, setOptions] = useState<OnboardingOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Guided 4-step quiz state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [branchId, setBranchId] = useState('');
  const [claimedGen, setClaimedGen] = useState<number>(5);
  const [anchorId, setAnchorId] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'unknown'>('unknown');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [relatives, setRelatives] = useState<RelativeDraft[]>([]);
  const [note, setNote] = useState('');

  // Invite-family fallback consent state
  const [consent, setConsent] = useState(false);
  const attempt = useRef<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const me = await api<User>('/auth/me');
      setUser(me);
      const parsed = splitName(me.display_name || '');
      setLastName((cur) => cur || parsed.last_name);
      setFirstName((cur) => cur || parsed.first_name);

      if (inviteFamilyId) {
        const rows = await api<Family[]>('/families');
        setFamilies(rows);
        return;
      }

      const [st, opts] = await Promise.all([
        api<OnboardingStatus>('/clan/onboarding/status'),
        api<OnboardingOptions>('/clan/onboarding/options'),
      ]);
      setStatus(st);
      setOptions(opts);
      if (st.approved && st.clan_family_id) {
        router.replace(`/tree?family=${encodeURIComponent(st.clan_family_id)}`);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(failure(cause));
    } finally {
      setLoading(false);
    }
  }, [inviteFamilyId, router]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const branchNodes = useMemo(() => {
    if (!options || !branchId) return [];
    return options.nodes
      .filter((n) => n.branch_root_id === branchId && n.generation < claimedGen)
      .sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name, 'mn'));
  }, [options, branchId, claimedGen]);

  const selectedBranch = options?.branches.find((b) => b.id === branchId);
  const selectedAnchor = branchNodes.find((n) => n.id === anchorId);

  function addRelative(defaultRelation: RelativeDraft['relation'] = 'parent') {
    setRelatives((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        relation: defaultRelation,
        last_name: '',
        first_name: '',
        gender: 'unknown',
        birth_date: '',
        is_alive: true,
        email: '',
      },
    ]);
  }

  function updateRelative(key: string, patch: Partial<RelativeDraft>) {
    setRelatives((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRelative(key: string) {
    setRelatives((prev) => prev.filter((r) => r.key !== key));
  }

  async function handleLogout() {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.replace('/login');
  }

  async function submitGuided(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!branchId) {
      setError('Эхлээд аль салбарын удам болохоо сонгоно уу.');
      setStep(1);
      return;
    }
    if (!anchorId) {
      setError('Хамгийн ойрын бүртгэлтэй өвөг эсвэл эцэг эхээ сонгоно уу.');
      setStep(3);
      return;
    }
    if (!firstName.trim()) {
      setError('Өөрийн нэрээ оруулна уу.');
      setStep(3);
      return;
    }
    for (const rel of relatives) {
      if (!rel.first_name.trim()) {
        setError('Нэмсэн төрөл садныхаа нэрийг бөглөнө үү (эсвэл илүү мөрийг устгана уу).');
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      await api('/clan/onboarding/requests', {
        method: 'POST',
        body: JSON.stringify({
          branch_person_id: branchId,
          claimed_generation: claimedGen,
          anchor_person_id: anchorId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          gender,
          birth_date: birthDate || null,
          birth_place: birthPlace.trim() || null,
          relatives: relatives.map((r) => ({
            relation: r.relation,
            first_name: r.first_name.trim(),
            last_name: r.last_name.trim(),
            gender: r.gender,
            birth_date: r.birth_date || null,
            is_alive: r.is_alive,
            email: r.email.trim() || null,
          })),
          note: note.trim() || null,
        }),
      });
      await loadAll();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  // Legacy invite-family join handler when ?family=<id> is provided
  async function submitInviteJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !user || !inviteFamilyId) return;
    setBusy(true);
    setError('');
    try {
      attempt.current ||= crypto.randomUUID();
      const result = await api<{ family_id: string; person_id: string }>('/families/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          request_key: attempt.current,
          family_id: inviteFamilyId,
          ...(!user.person_id ? { first_name: firstName.trim(), last_name: lastName.trim(), gender } : {}),
          reuse_existing_person: Boolean(user.person_id && consent),
        }),
      });
      router.push(`/tree?view=family&family=${encodeURIComponent(result.family_id)}&person=${encodeURIComponent(result.person_id)}`);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--ink)', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <Sparkles size={28} style={{ color: 'var(--gold)', margin: '0 auto 10px' }} />
          <p style={{ color: 'var(--muted)' }}>Таны удмын бүртгэлийг шалгаж байна…</p>
        </div>
      </main>
    );
  }

  // Invite-family quick join flow
  if (inviteFamilyId) {
    const fam = families.find((f) => f.id === inviteFamilyId);
    return (
      <main style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--ink)', padding: '32px 16px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 28 }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, marginBottom: 8 }}>🌳 {fam?.name || 'Урилгаар нэгдэх'}</h1>
          {error && <div className="error" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
          <form onSubmit={submitInviteJoin} style={{ display: 'grid', gap: 14 }}>
            {user?.person_id ? (
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} />
                <span>Өөрийн удмын бүртгэлээ энэ модонд холбохыг зөвшөөрч байна.</span>
              </label>
            ) : (
              <>
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  Эцгийн нэр (Овог)
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" />
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  Өөрийн нэр *
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="input" />
                </label>
              </>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || Boolean(user?.person_id && !consent)}>
              {busy ? 'Хадгалж байна…' : 'Модондоо нэгдэх →'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // Waiting Screen when request is pending admin approval
  if (status?.pending_request) {
    return (
      <main style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--ink)', padding: '24px 16px', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 560, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, padding: '32px 28px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.08)' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(201,150,43,0.14)', border: '1px solid var(--gold)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--gold)' }}>
            <Clock size={30} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold)' }}>
            ГУУЛИНГИЙНХАН · БАТАЛГААЖУУЛАЛТ
          </span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, margin: '8px 0 10px' }}>
            Админы зөвшөөрөл хүлээж байна
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, marginBottom: 20 }}>
            Таны <strong>{status.pending_request.claimed_generation ? `${status.pending_request.claimed_generation}-р үеийн` : 'удмын'}</strong> баталгаажуулах асуумж амжилттай илгээгдлээ.
            Админ эсвэл Засагч шалгаад баталмагц <strong>Гуулингийнхны нэгдсэн удмын мод</strong> болон бүх өвийн сан автоматаар нээгдэнэ.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
              Төлөв шалгах (Шинэчлэх)
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={15} /> Гарах
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--ink)', padding: '20px 14px 48px' }}>
      <div style={{ maxWidth: 740, margin: '0 auto' }}>
        {/* Top bar */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold)' }}>
              ГУУЛИНГИЙНХАН · НЭГДСЭН УДАМ
            </span>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 4vw, 30px)', margin: '4px 0 0' }}>
              Удмаа баталгаажуулах асуумж
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemePicker variant="compact" showLabel={false} />
            <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()} style={{ padding: '7px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <LogOut size={14} /> Гарах
            </button>
          </div>
        </header>

        {/* Security privacy banner */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border)', marginBottom: 18, fontSize: 13, color: 'var(--muted)' }}>
          <ShieldCheck size={18} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ color: 'var(--ink)' }}>Хувийн нууцлалын хамгаалалт:</strong> Удмын мод болон гэр бүлийн мэдээлэл зөвхөн баталгаажсан гишүүдэд харагдана. Доорх 4 богино алхмыг бөглөснөөр админ таныг зөв үед нь холбож баталгаажуулна.
          </div>
        </div>

        {status?.last_rejected && (
          <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(180,35,24,0.12)', border: '1px solid rgba(180,35,24,0.35)', color: 'var(--ink)', marginBottom: 16, fontSize: 13 }}>
            <strong>Өмнөх хүсэлт татгалзагдсан:</strong> {status.last_rejected.review_note || 'Мэдээллээ нягтлаад дахин илгээнэ үү.'}
          </div>
        )}

        {error && (
          <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(180,35,24,0.12)', border: '1px solid rgba(180,35,24,0.35)', color: 'var(--ink)', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Stepper */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 18 }}>
          {[
            { n: 1 as const, label: '1. Салбар' },
            { n: 2 as const, label: '2. Үе' },
            { n: 3 as const, label: '3. Өвөг & Би' },
            { n: 4 as const, label: '4. Ойрын төрөл' },
          ].map((s) => {
            const active = step === s.n;
            const done = step > s.n;
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => {
                  if (s.n === 1 || (s.n >= 2 && branchId)) setStep(s.n);
                }}
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  border: active ? '1.5px solid var(--gold)' : '1px solid var(--border)',
                  background: active ? 'var(--gold)' : done ? 'rgba(201,150,43,0.12)' : 'var(--card)',
                  color: active ? '#1a1207' : 'var(--ink)',
                  fontWeight: active || done ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {done ? '✓ ' : ''}
                {s.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={submitGuided} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 20px', boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
          {/* STEP 1: Choose Branch */}
          {step === 1 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginBottom: 6 }}>
                1. Та {options?.root_label || 'Ядамсүрэн ⚭ Гүнд'}-ийн аль хүүхдийн удам бэ?
              </h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Гуулингийнхны 4 үндсэн салбараас өөрийн харьяалагдах салбарыг сонгоно уу.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                {(options?.branches || []).map((b) => {
                  const selected = branchId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setBranchId(b.id);
                        setAnchorId(b.id);
                        setStep(2);
                      }}
                      style={{
                        padding: '18px 14px',
                        borderRadius: 16,
                        border: selected ? '2px solid var(--gold)' : '1px solid var(--border)',
                        background: selected ? 'rgba(201,150,43,0.14)' : 'var(--bg)',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginBottom: 4 }}>2-Р ҮЕ · САЛБАР</div>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 700 }}>{b.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Энэ салбараас салаалсан →</div>
                    </button>
                  );
                })}
              </div>
              {options && options.branches.length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Үндсэн удмын салбарууд одоогоор тохируулагдаагүй байна. Админтай холбогдоно уу.
                </p>
              )}
            </div>
          )}

          {/* STEP 2: Choose Generation */}
          {step === 2 && (
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginBottom: 6 }}>
                2. Та хэд дэх үеийн удам бэ?
              </h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                <strong>{options?.root_label}</strong> бол 1-р үе, <strong>{selectedBranch?.name}</strong> бол 2-р үе юм. Та өөрийнхөө үеийг сонгоно уу.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, marginBottom: 20 }}>
                {[3, 4, 5, 6, 7, 8, 9].map((g) => {
                  const selected = claimedGen === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        setClaimedGen(g);
                        setStep(3);
                      }}
                      style={{
                        padding: '14px 10px',
                        borderRadius: 14,
                        border: selected ? '2px solid var(--gold)' : '1px solid var(--border)',
                        background: selected ? 'var(--gold)' : 'var(--bg)',
                        color: selected ? '#1a1207' : 'var(--ink)',
                        fontWeight: 700,
                        fontSize: 15,
                        cursor: 'pointer',
                      }}
                    >
                      {g}-р үе
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>← Буцах</button>
                <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>Дараах алхам →</button>
              </div>
            </div>
          )}

          {/* STEP 3: Choose Closest Registered Ancestor + Own Info */}
          {step === 3 && (
            <div style={{ display: 'grid', gap: 18 }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginBottom: 6 }}>
                  3. Хамгийн ойрын бүртгэлтэй өвөг/эцэг эхээ сонгоно уу
                </h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                  <strong>{selectedBranch?.name}</strong>-ийн салбарт одоо бүртгэлтэй байгаа {claimedGen - 1}-р үе хүртэлх хүмүүсээс өөрт хамгийн ойрын хүнээ сонгоно уу.
                  Хэрэв таны {claimedGen - 1}-р үеийн аав/ээж хараахан бүртгэгдээгүй бол дээд үеийн өвөө/эмээгээ сонгоод, <strong>4-р алхамд аав/ээжийгээ нэмээрэй!</strong>
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 8 }}>
                  {branchNodes.map((n) => {
                    const selected = anchorId === n.id;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setAnchorId(n.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: selected ? '2px solid var(--gold)' : '1px solid var(--border)',
                          background: selected ? 'rgba(201,150,43,0.16)' : 'var(--bg)',
                          color: 'var(--ink)',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>{n.generation}-Р ҮЕ</div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{n.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

              <div>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 17, marginBottom: 12 }}>
                  Таны өөрийн мэдээлэл ({claimedGen}-р үе)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Эцгийн нэр (Овог)
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Жишээ: Дагмидмаа" className="input" />
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Өөрийн нэр *
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required placeholder="Жишээ: Түвшинтулга" className="input" />
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Хүйс
                    <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female' | 'unknown')} className="input">
                      <option value="unknown">Тодорхойгүй</option>
                      <option value="male">Эрэгтэй</option>
                      <option value="female">Эмэгтэй</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Төрсөн газар
                    <input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="Жишээ: Улаанбаатар" className="input" />
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <SmartDateInput label="Төрсөн огноо (заавал биш)" value={birthDate} onChange={setBirthDate} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>← Буцах</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (!anchorId) { setError('Хамгийн ойрын бүртгэлтэй өвөг/эцэг эхээ сонгоно уу.'); return; }
                    if (!firstName.trim()) { setError('Өөрийн нэрээ оруулна уу.'); return; }
                    setError('');
                    setStep(4);
                  }}
                >
                  Дараах: Ойрын төрөл нэмэх →
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Add Missing Parents / Close Relatives (Multiple + Optional Email for Auto-Account) */}
          {step === 4 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginBottom: 6 }}>
                  4. Дунд үеийн эцэг эх, ойрын төрлүүдээ нэмэх (Заавал биш)
                </h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  Хэрэв таны <strong>аав, ээж</strong> модонд хараахан бүртгэгдээгүй бол энд нэмснээр админ батлахад шууд <strong>{selectedAnchor?.name || selectedBranch?.name} → Аав/Ээж → Та</strong> дарааллаар автоматаар холбогдоно.
                  Мөн <strong>имэйл хаяг</strong> оруулбал тухайн хүнд автоматаар аккаунт үүсэж, дараа нь «Нууц үгээ мартсан уу?» хэсгээр өөрөө нууц үгээ зохиогоод шууд нэвтрэх боломжтой!
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('parent')} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={14} /> Эцэг / Эх нэмэх
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('spouse')} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={14} /> Хань нэмэх
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('child')} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={14} /> Хүүхэд нэмэх
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('sibling')} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={14} /> Ах / Эгч / Дүү нэмэх
                </button>
              </div>

              {relatives.length > 0 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  {relatives.map((rel, idx) => (
                    <div key={rel.key} style={{ padding: 16, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)', display: 'grid', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 13, color: 'var(--gold)' }}>
                          <Users size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
                          #{idx + 1} · {RELATION_LABELS[rel.relation]}
                        </strong>
                        <button type="button" onClick={() => removeRelative(rel.key)} style={{ background: 'transparent', border: 'none', color: '#e11d48', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Trash2 size={14} /> Хасах
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          Хамаарал
                          <select value={rel.relation} onChange={(e) => updateRelative(rel.key, { relation: e.target.value as RelativeDraft['relation'] })} className="input">
                            <option value="parent">Эцэг / Эх (дунд үе)</option>
                            <option value="spouse">Хань</option>
                            <option value="child">Хүүхэд</option>
                            <option value="sibling">Ах, эгч, дүү</option>
                          </select>
                        </label>
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          Овог
                          <input value={rel.last_name} onChange={(e) => updateRelative(rel.key, { last_name: e.target.value })} placeholder="Овог" className="input" />
                        </label>
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          Нэр *
                          <input value={rel.first_name} onChange={(e) => updateRelative(rel.key, { first_name: e.target.value })} required placeholder="Нэр" className="input" />
                        </label>
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          Хүйс
                          <select value={rel.gender} onChange={(e) => updateRelative(rel.key, { gender: e.target.value as RelativeDraft['gender'] })} className="input">
                            <option value="unknown">Тодорхойгүй</option>
                            <option value="male">Эрэгтэй</option>
                            <option value="female">Эмэгтэй</option>
                          </select>
                        </label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, alignItems: 'end' }}>
                        <SmartDateInput label="Төрсөн огноо" value={rel.birth_date} onChange={(val: string) => updateRelative(rel.key, { birth_date: val })} />
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          Имэйл (заавал биш — автоматаар аккаунт нээнэ)
                          <input type="email" value={rel.email} onChange={(e) => updateRelative(rel.key, { email: e.target.value })} placeholder="eej@gmail.com" className="input" />
                        </label>
                      </div>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                        <input type="checkbox" checked={rel.is_alive} onChange={(e) => updateRelative(rel.key, { is_alive: e.target.checked })} />
                        Амьд сэрүүн
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                Админд үлдээх нэмэлт тайлбар (заавал биш)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Жишээ: Би Баавай өвөөгийн 5-р үеийн зээ хүү байна..." className="input" />
              </label>

              {/* Visual Chain Preview */}
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(201,150,43,0.10)', border: '1px solid rgba(201,150,43,0.35)', fontSize: 13 }}>
                <strong style={{ color: 'var(--gold)' }}>Холбогдох хэлхээ:</strong>{' '}
                {options?.root_label || 'Ядамсүрэн ⚭ Гүнд'} → {selectedBranch?.name}
                {selectedAnchor && selectedAnchor.id !== selectedBranch?.id ? ` → … → ${selectedAnchor.name}` : ''}
                {relatives.filter((r) => r.relation === 'parent').map((p) => ` → ${p.first_name || 'Эцэг/Эх'}`).join('')}
                {' → '}
                <strong>{firstName || 'Та'} ({claimedGen}-р үе)</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(3)}>← Буцах</button>
                <button type="submit" className="btn btn-primary" disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={16} />
                  {busy ? 'Илгээж байна…' : 'Баталгаажуулах хүсэлт илгээх'}
                </button>
              </div>
            </div>
          )}
        </form>

        <p style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Танд гэр бүлийн урилгын код байгаа бол <Link href="/invite" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>урилгаар нэгдэх →</Link>
        </p>
      </div>
    </main>
  );
}
