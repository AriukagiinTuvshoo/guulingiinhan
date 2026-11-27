'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronRight, Clock, LogOut, Plus, Search, ShieldCheck, Sparkles, Trash2, Users } from 'lucide-react';
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

const ONBOARDING_DRAFT_KEY = 'guulin_onboarding_draft_v1';

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
  const [draftRestored, setDraftRestored] = useState(false);

  // Guided 4-step quiz state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [branchId, setBranchId] = useState('');
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [claimedGen, setClaimedGen] = useState<number>(5);
  const [anchorId, setAnchorId] = useState('');
  const [showFlatList, setShowFlatList] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'unknown'>('unknown');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [relatives, setRelatives] = useState<RelativeDraft[]>([]);
  const [note, setNote] = useState('');
  const draftHydrated = useRef(false);

  // Restore saved 4-step quiz draft from sessionStorage on mount
  useEffect(() => {
    if (draftHydrated.current || typeof window === 'undefined') return;
    draftHydrated.current = true;
    try {
      const raw = window.sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<{
        step: 1 | 2 | 3 | 4;
        branchId: string;
        selectedPath: string[];
        claimedGen: number;
        anchorId: string;
        lastName: string;
        firstName: string;
        gender: 'male' | 'female' | 'unknown';
        birthDate: string;
        birthPlace: string;
        relatives: RelativeDraft[];
        note: string;
      }>;
      if (d.branchId) setBranchId(d.branchId);
      if (Array.isArray(d.selectedPath)) setSelectedPath(d.selectedPath);
      if (typeof d.claimedGen === 'number' && d.claimedGen >= 2 && d.claimedGen <= 12) setClaimedGen(d.claimedGen);
      if (d.anchorId) setAnchorId(d.anchorId);
      if (typeof d.lastName === 'string' && d.lastName) setLastName(d.lastName);
      if (typeof d.firstName === 'string' && d.firstName) setFirstName(d.firstName);
      if (d.gender === 'male' || d.gender === 'female' || d.gender === 'unknown') setGender(d.gender);
      if (typeof d.birthDate === 'string') setBirthDate(d.birthDate);
      if (typeof d.birthPlace === 'string') setBirthPlace(d.birthPlace);
      if (Array.isArray(d.relatives)) setRelatives(d.relatives);
      if (typeof d.note === 'string') setNote(d.note);
      if (d.step === 1 || d.step === 2 || d.step === 3 || d.step === 4) setStep(d.step);
      if (d.branchId || (Array.isArray(d.relatives) && d.relatives.length > 0)) {
        setDraftRestored(true);
      }
    } catch {
      // ignore corrupted draft
    }
  }, []);

  // Auto-save 4-step quiz draft to sessionStorage whenever user edits fields
  useEffect(() => {
    if (!draftHydrated.current || typeof window === 'undefined') return;
    if (status?.approved || status?.pending_request) return;
    try {
      window.sessionStorage.setItem(
        ONBOARDING_DRAFT_KEY,
        JSON.stringify({
          step,
          branchId,
          selectedPath,
          claimedGen,
          anchorId,
          lastName,
          firstName,
          gender,
          birthDate,
          birthPlace,
          relatives,
          note,
        }),
      );
    } catch {
      // ignore quota/private-mode errors
    }
  }, [
    step,
    branchId,
    selectedPath,
    claimedGen,
    anchorId,
    lastName,
    firstName,
    gender,
    birthDate,
    birthPlace,
    relatives,
    note,
    status?.approved,
    status?.pending_request,
  ]);

  // Invite-family & legacy fallback state (when /clan/onboarding/* is not yet deployed on backend)
  const [consent, setConsent] = useState(false);
  const [legacyFallback, setLegacyFallback] = useState(false);
  const [legacyFamilyName, setLegacyFamilyName] = useState('');
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

      try {
        const [st, opts] = await Promise.all([
          api<OnboardingStatus>('/clan/onboarding/status'),
          api<OnboardingOptions>('/clan/onboarding/options'),
        ]);
        setLegacyFallback(false);
        setStatus(st);
        setOptions(opts);
        if (st.approved && st.clan_family_id) {
          router.replace(`/tree?family=${encodeURIComponent(st.clan_family_id)}`);
        }
      } catch (onboardErr) {
        if (onboardErr instanceof ApiError && onboardErr.status === 404) {
          // Graceful fallback when backend does not yet expose /clan/onboarding/*
          const rows = await api<Family[]>('/families').catch(() => []);
          setFamilies(rows);
          setLegacyFallback(true);
          return;
        }
        throw onboardErr;
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        if (typeof window !== 'undefined') window.location.replace('/login');
        else router.replace('/login');
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
  const nodeById = useMemo(() => new Map(branchNodes.map((n) => [n.id, n])), [branchNodes]);
  const filteredFlatNodes = useMemo(() => {
    const q = nodeSearch.trim().toLowerCase();
    if (!q) return branchNodes;
    return branchNodes.filter((n) => n.name.toLowerCase().includes(q));
  }, [branchNodes, nodeSearch]);

  function selectBranchForQuiz(nextBranchId: string) {
    setBranchId(nextBranchId);
    setSelectedPath([nextBranchId]);
    setAnchorId(nextBranchId);
    setShowFlatList(false);
    setNodeSearch('');
    setStep(2);
  }

  function selectGenerationForQuiz(nextGen: number) {
    setClaimedGen(nextGen);
    const maxPathLen = Math.max(1, nextGen - 2);
    setSelectedPath((prev) => {
      const base = prev.length > 0 ? prev : branchId ? [branchId] : [];
      const trimmed = base.slice(0, maxPathLen);
      setAnchorId(trimmed[trimmed.length - 1] || branchId);
      return trimmed;
    });
    setStep(3);
  }

  function ensureParentDraftIfMissing() {
    setRelatives((prev) => {
      if (prev.some((r) => r.relation === 'parent')) return prev;
      return [
        {
          key: crypto.randomUUID(),
          relation: 'parent',
          last_name: '',
          first_name: '',
          gender: 'unknown',
          birth_date: '',
          is_alive: true,
          email: '',
        },
        ...prev,
      ];
    });
  }

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
    try { window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* ignore */ }
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
      try { window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* ignore */ }
      setDraftRestored(false);
      await loadAll();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  // Legacy create-family fallback when /clan/onboarding/* returns 404
  async function submitLegacyCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !user) return;
    if (!legacyFamilyName.trim()) {
      setError('Гэр бүлийн нэрээ оруулна уу.');
      return;
    }
    if (!user.person_id && !firstName.trim()) {
      setError('Өөрийн нэрээ оруулна уу.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      attempt.current ||= crypto.randomUUID();
      const result = await api<{ family_id: string; person_id: string }>('/families/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          request_key: attempt.current,
          family_name: legacyFamilyName.trim(),
          ...(!user.person_id ? { first_name: firstName.trim(), last_name: lastName.trim(), gender } : {}),
          reuse_existing_person: Boolean(user.person_id),
        }),
      });
      router.push(`/tree?view=family&family=${encodeURIComponent(result.family_id)}&person=${encodeURIComponent(result.person_id)}`);
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

  if (loading || (status?.approved && status.clan_family_id)) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--ink)', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <Sparkles size={28} style={{ color: 'var(--gold)', margin: '0 auto 10px' }} />
          <p style={{ color: 'var(--muted)' }}>
            {status?.approved ? 'Удмын мод руу шилжиж байна…' : 'Таны удмын бүртгэлийг шалгаж байна…'}
          </p>
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

  // Graceful fallback form when backend /clan/onboarding/* is not yet live
  if (legacyFallback) {
    return (
      <main style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--ink)', padding: '24px 16px 48px' }}>
        <div style={{ maxWidth: 580, margin: '0 auto' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <Link href="/families" style={{ color: 'var(--gold)', fontSize: 13 }}>← Миний гэр бүлүүд</Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemePicker variant="compact" showLabel={false} />
              <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()} style={{ padding: '6px 12px', fontSize: 12 }}>
                <LogOut size={14} /> Гарах
              </button>
            </div>
          </header>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '26px 22px' }}>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, marginBottom: 8 }}>🌳 Гэр бүлийн модоо эхлүүлэх</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 18 }}>
              Урилгаар нэгдсэн бол доорх урилгын холбоосоор орно уу. Эсвэл өөрийн гэр бүлийн модоо шинээр үүсгэж эхэлнэ үү.
            </p>
            {draftRestored && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border-strong)',
              color: 'var(--ink)',
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            <span>Өмнө бөглөж байсан асуумжийн нооргийг автоматаар сэргээлээ.</span>
            <button
              type="button"
              onClick={() => {
                try { window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* ignore */ }
                setDraftRestored(false);
                setStep(1);
                setBranchId('');
                setSelectedPath([]);
                setAnchorId('');
                setRelatives([]);
                setNote('');
              }}
              style={{
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Шинээр эхлэх
            </button>
          </div>
        )}

        {error && (
              <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(180,35,24,0.12)', border: '1px solid rgba(180,35,24,0.35)', marginBottom: 14, fontSize: 13 }}>
                {error}
              </div>
            )}

            {families.length > 0 && (
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                <strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Таны одоогийн гэр бүлүүд:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {families.map((f) => (
                    <Link key={f.id} href={`/tree?family=${encodeURIComponent(f.id)}`} className="btn btn-secondary" style={{ fontSize: 13 }}>
                      {f.name} →
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={submitLegacyCreate} style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                Гэр бүлийн нэр *
                <input
                  value={legacyFamilyName}
                  onChange={(e) => setLegacyFamilyName(e.target.value)}
                  required
                  maxLength={180}
                  placeholder="Жишээ: Гуулингийнхан — Манай гэр бүл"
                  className="input"
                />
              </label>
              {!user?.person_id && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                      Эцгийн нэр (Овог)
                      <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Овог" className="input" />
                    </label>
                    <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                      Өөрийн нэр *
                      <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required placeholder="Нэр" className="input" />
                    </label>
                  </div>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Хүйс
                    <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female' | 'unknown')} className="input">
                      <option value="unknown">Тодорхойгүй</option>
                      <option value="male">Эрэгтэй</option>
                      <option value="female">Эмэгтэй</option>
                    </select>
                  </label>
                </>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Үүсгэж байна…' : 'Гэр бүлийн модоо эхлүүлэх →'}
              </button>
            </form>

            <p style={{ marginTop: 18, fontSize: 13, color: 'var(--muted)' }}>
              Урилгын кодтой бол <Link href="/invite" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>урилгаар нэгдэх →</Link>
            </p>
          </div>
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
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ui-accent-text, var(--gold))' }}>
              ГУУЛИНГИЙНХАН · НЭГДСЭН УДАМ
            </span>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 4vw, 30px)', margin: '4px 0 0' }}>
              Удмаа баталгаажуулах асуумж
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()} style={{ minHeight: 40, padding: '8px 14px', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={15} /> Гарах
            </button>
          </div>
        </header>

        {/* Quick invite-code shortcut at top (Nielsen #7 Flexibility) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '12px 16px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border)', marginBottom: 14, fontSize: 14, color: 'var(--ink)' }}>
          <span>Танд гэр бүлийн урилгын код байгаа юу?</span>
          <Link href="/invite" style={{ fontWeight: 700, color: 'var(--ui-primary, var(--gold))', textDecoration: 'underline', minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>
            Кодоор шууд нэгдэх →
          </Link>
        </div>

        {/* Security privacy banner */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 16px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border)', marginBottom: 18, fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
          <ShieldCheck size={18} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Хувийн нууцлалын хамгаалалт:</strong> Удмын мод зөвхөн баталгаажсан гишүүдэд харагдана. Доорх 4 алхмыг бөглөснөөр админ таныг зөв үед нь холбоно.
          </div>
        </div>

        {status?.last_rejected && (
          <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(180,35,24,0.12)', border: '1px solid rgba(180,35,24,0.35)', color: 'var(--ink)', marginBottom: 16, fontSize: 13 }}>
            <strong>Өмнөх хүсэлт татгалзагдсан:</strong> {status.last_rejected.review_note || 'Мэдээллээ нягтлаад дахин илгээнэ үү.'}
          </div>
        )}

        {draftRestored && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border-strong)',
              color: 'var(--ink)',
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            <span>Өмнө бөглөж байсан асуумжийн нооргийг автоматаар сэргээлээ.</span>
            <button
              type="button"
              onClick={() => {
                try { window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* ignore */ }
                setDraftRestored(false);
                setStep(1);
                setBranchId('');
                setSelectedPath([]);
                setAnchorId('');
                setRelatives([]);
                setNote('');
              }}
              style={{
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Шинээр эхлэх
            </button>
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
                      onClick={() => selectBranchForQuiz(b.id)}
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
                      onClick={() => selectGenerationForQuiz(g)}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, margin: 0 }}>
                    3. Салбараа дагаж хамгийн ойрын өвөг/эцэг эхээ сонгоно уу
                  </h2>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 10px' }}
                    onClick={() => setShowFlatList((v) => !v)}
                  >
                    <Search size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
                    {showFlatList ? 'Үе шатаар сонгох' : 'Бүх хүнээс хайх'}
                  </button>
                </div>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                  <strong>{selectedBranch?.name}</strong>-ийн салбараас <strong>{claimedGen - 1}-р үе</strong> хүртэл үе шаттайгаар сонгож бууна уу.
                  Хэрэв таны дунд үеийн эцэг эх хараахан бүртгэгдээгүй бол хамгийн ойрын бүртгэлтэй хүн дээрээ тогтоод <strong>4-р алхамд аав/ээжээ нэмээрэй</strong>.
                </p>

                {/* Lineage Breadcrumb */}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '10px 12px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: 14, fontSize: 12.5 }}>
                  <span style={{ color: 'var(--muted)' }}>{options?.root_label || 'Ядамсүрэн ⚭ Гүнд'}</span>
                  {(selectedPath.length > 0 ? selectedPath : branchId ? [branchId] : []).map((pid, idx) => {
                    const pnode = nodeById.get(pid) || (selectedBranch?.id === pid ? { id: selectedBranch.id, name: selectedBranch.name, generation: 2 } : null);
                    if (!pnode) return null;
                    const isCurrentAnchor = anchorId === pid;
                    return (
                      <span key={pid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPath(selectedPath.slice(0, idx + 1));
                            setAnchorId(pid);
                          }}
                          style={{
                            padding: '3px 9px',
                            borderRadius: 999,
                            border: isCurrentAnchor ? '1.5px solid var(--gold)' : '1px solid var(--border)',
                            background: isCurrentAnchor ? 'rgba(201,150,43,0.18)' : 'var(--card)',
                            color: 'var(--ink)',
                            fontWeight: isCurrentAnchor ? 700 : 500,
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          {pnode.name} ({pnode.generation}-р үе)
                        </button>
                      </span>
                    );
                  })}
                </div>

                {!showFlatList ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {claimedGen <= 3 ? (
                      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(201,150,43,0.10)', border: '1px solid rgba(201,150,43,0.35)', fontSize: 13 }}>
                        Та <strong>3-р үе</strong> тул <strong>{selectedBranch?.name} (2-р үе)</strong>-ийн хүүхэд болж шууд холбогдоно.
                      </div>
                    ) : (
                      Array.from({ length: Math.max(0, claimedGen - 3) }, (_, i) => i + 3).map((level) => {
                        const parentIdx = level - 3;
                        const activePath = selectedPath.length > 0 ? selectedPath : branchId ? [branchId] : [];
                        if (activePath.length < level - 2) return null;
                        const parentId = activePath[parentIdx];
                        if (!parentId) return null;
                        const parentNode = nodeById.get(parentId) || (selectedBranch?.id === parentId ? { id: selectedBranch.id, name: selectedBranch.name, generation: 2 } : null);
                        const childrenAtLevel = branchNodes.filter(
                          (n) => n.generation === level && n.parent_ids.includes(parentId),
                        );
                        const selectedChildId = activePath[parentIdx + 1];
                        return (
                          <div key={level} style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)', display: 'grid', gap: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 13 }}>
                                {level}-р үе · {parentNode?.name}-ийн хүүхдүүд
                              </strong>
                              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                                {childrenAtLevel.length > 0 ? `${childrenAtLevel.length} хүн бүртгэлтэй` : 'Хүүхэд бүртгэгдээгүй'}
                              </span>
                            </div>

                            {childrenAtLevel.length > 0 && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 8 }}>
                                {childrenAtLevel.map((child) => {
                                  const picked = selectedChildId === child.id || anchorId === child.id;
                                  return (
                                    <button
                                      key={child.id}
                                      type="button"
                                      onClick={() => {
                                        const nextPath = [...activePath.slice(0, parentIdx + 1), child.id];
                                        setSelectedPath(nextPath);
                                        setAnchorId(child.id);
                                      }}
                                      style={{
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        border: picked ? '2px solid var(--gold)' : '1px solid var(--border)',
                                        background: picked ? 'rgba(201,150,43,0.16)' : 'var(--card)',
                                        color: 'var(--ink)',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>{child.generation}-Р ҮЕ</div>
                                      <div style={{ fontWeight: 600, fontSize: 14 }}>{child.name}</div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPath(activePath.slice(0, parentIdx + 1));
                                setAnchorId(parentId);
                                ensureParentDraftIfMissing();
                              }}
                              style={{
                                padding: '9px 12px',
                                borderRadius: 10,
                                border: anchorId === parentId ? '1.5px solid var(--gold)' : '1px dashed var(--gold)',
                                background: anchorId === parentId ? 'rgba(201,150,43,0.18)' : 'rgba(201,150,43,0.06)',
                                color: 'var(--ink)',
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              Миний {level}-р үеийн аав/ээж энд алга — <strong>{parentNode?.name}</strong> дээр холбоод 4-р алхамд аав/ээжээ нэмэх
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <input
                      type="search"
                      value={nodeSearch}
                      onChange={(e) => setNodeSearch(e.target.value)}
                      placeholder="Өвөг эсвэл эцэг эхийн нэрээр хайх…"
                      className="input"
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 8 }}>
                      {filteredFlatNodes.map((n) => {
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
                )}

                {selectedAnchor && (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(201,150,43,0.10)', border: '1px solid rgba(201,150,43,0.3)', fontSize: 12.5 }}>
                    Сонгосон тулгуур: <strong>{selectedAnchor.name} ({selectedAnchor.generation}-р үе)</strong>
                    {selectedAnchor.generation < claimedGen - 1 && (
                      <span> — 4-р алхамд дунд үеийн ({selectedAnchor.generation + 1}–{claimedGen - 1}-р үе) аав/ээжээ нэмбэл автоматаар дунд нь холбогдоно.</span>
                    )}
                  </div>
                )}
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
                <label style={{ display: 'grid', gap: 5, fontSize: 13, marginTop: 12 }}>
                  Төрсөн огноо (заавал биш)
                  <SmartDateInput value={birthDate} onChange={setBirthDate} />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>← Буцах</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (!anchorId) { setError('Хамгийн ойрын бүртгэлтэй өвөг/эцэг эхээ сонгоно уу.'); return; }
                    if (!firstName.trim()) { setError('Өөрийн нэрээ оруулна уу.'); return; }
                    if (selectedAnchor && selectedAnchor.generation < claimedGen - 1) {
                      ensureParentDraftIfMissing();
                    }
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
                <p style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.55, margin: 0 }}>
                  Нэмсэн хүмүүс тань админ баталсны дараа удмын модонд холбогдоно.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('parent')} style={{ minHeight: 44, padding: '10px 16px', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={16} /> Эцэг / Эх нэмэх
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('spouse')} style={{ minHeight: 44, padding: '10px 16px', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={16} /> Хань нэмэх
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('child')} style={{ minHeight: 44, padding: '10px 16px', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={16} /> Хүүхэд нэмэх
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => addRelative('sibling')} style={{ minHeight: 44, padding: '10px 16px', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={16} /> Ах / Эгч / Дүү нэмэх
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
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          Төрсөн огноо
                          <SmartDateInput value={rel.birth_date} onChange={(val: string) => updateRelative(rel.key, { birth_date: val })} />
                        </label>
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(3)} style={{ minHeight: 44, padding: '10px 18px', fontSize: 14 }}>
                  ← Буцах
                </button>
                <button
                  type="submit"
                  className="ui-btn ui-btn--primary"
                  disabled={busy}
                  style={{
                    minHeight: 46,
                    padding: '10px 22px',
                    fontSize: 15,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 12,
                  }}
                >
                  <CheckCircle2 size={17} />
                  {busy ? 'Илгээж байна…' : 'Баталгаажуулах хүсэлт илгээх'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
