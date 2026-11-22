'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Sparkles,
  TreeDeciduous,
  AlertCircle,
  AlertTriangle,
  Link2,
  UserPlus,
  Search,
} from 'lucide-react';
import { ApiError, api, Person, Marriage, SmartConnectOut } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';

export type RelativeRole =
  | 'father'
  | 'mother'
  | 'spouse'
  | 'son'
  | 'daughter'
  | 'sibling'
  | 'standalone';

export type WizardPersonItem = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  nickname?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  is_alive?: boolean;
  death_date?: string | null;
  lineage_name?: string | null;
};

function formatPersonName(p: WizardPersonItem): string {
  if (p.middle_name) {
    return `${p.last_name} ${p.middle_name} ${p.first_name}`.trim();
  }
  return [p.last_name, p.first_name].filter(Boolean).join(' ').trim() || 'Тодорхойгүй';
}

export interface PedigreeWizardModalProps {
  familyId: string;
  people: WizardPersonItem[];
  marriages?: Marriage[];
  parentChildEdges?: { parent_id: string; child_id: string }[];
  initialAnchorPersonId?: string | null;
  initialRole?: RelativeRole;
  initialMode?: 'create' | 'existing';
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (person: Person, message: string) => void;
}

export function PedigreeWizardModal({
  familyId,
  people,
  marriages = [],
  parentChildEdges = [],
  initialAnchorPersonId = null,
  initialRole = 'son',
  initialMode = 'create',
  isOpen,
  onClose,
  onSuccess,
}: PedigreeWizardModalProps) {
  const [mode, setMode] = useState<'create' | 'existing'>(initialMode);
  const [anchorPersonId, setAnchorPersonId] = useState<string>('');
  const [role, setRole] = useState<RelativeRole>(initialRole);
  const [coParentId, setCoParentId] = useState<string>('');

  // Smart Wiring Options
  const [autoMarryCoparent, setAutoMarryCoparent] = useState(true);
  const [applyToSiblings, setApplyToSiblings] = useState(true);
  const [sharedParentFirstName, setSharedParentFirstName] = useState('');
  const [sharedParentLastName, setSharedParentLastName] = useState('');
  const [sharedParentGender, setSharedParentGender] = useState<'male' | 'female'>('male');

  // Existing Person Selector State
  const [existingSearch, setExistingSearch] = useState('');
  const [existingTargetId, setExistingTargetId] = useState('');

  // New Person Form Fields
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [birthDate, setBirthDate] = useState('');
  const [isAlive, setIsAlive] = useState(true);
  const [deathDate, setDeathDate] = useState('');
  const [lineageName, setLineageName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, dialogRef, {
    onEscape: () => {
      if (!loading) onClose();
    },
    disabled: loading,
  });

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setMode(initialRole === 'standalone' ? 'create' : initialMode);
    const defaultAnchor =
      initialAnchorPersonId && people.some((p) => p.id === initialAnchorPersonId)
        ? initialAnchorPersonId
        : people[0]?.id || '';
    setAnchorPersonId(defaultAnchor);
    setRole(initialRole);
    setExistingSearch('');
    setExistingTargetId('');
    setFirstName('');
    setBirthDate('');
    setDeathDate('');
    setIsAlive(true);
    setAutoMarryCoparent(true);
    setApplyToSiblings(true);
  }, [isOpen, initialAnchorPersonId, initialRole, initialMode, people]);

  const anchorPerson = useMemo(() => {
    return people.find((p) => p.id === anchorPersonId) ?? null;
  }, [people, anchorPersonId]);

  // Existing parents of anchorPerson
  const anchorExistingParents = useMemo(() => {
    if (!anchorPersonId) return [];
    const parentIds = new Set(
      parentChildEdges.filter((e) => e.child_id === anchorPersonId).map((e) => e.parent_id),
    );
    return people.filter((p) => parentIds.has(p.id));
  }, [anchorPersonId, parentChildEdges, people]);

  // Candidate co-parents when adding son/daughter (spouses of anchor)
  const candidateCoParentsForChild = useMemo(() => {
    if (!anchorPersonId) return [];
    const spouseIds = new Set<string>();
    for (const m of marriages) {
      if (m.person_1_id === anchorPersonId) spouseIds.add(m.person_2_id);
      if (m.person_2_id === anchorPersonId) spouseIds.add(m.person_1_id);
    }
    return people.filter((p) => spouseIds.has(p.id));
  }, [anchorPersonId, marriages, people]);

  // Candidate existing parent when adding father/mother (to auto-marry and wire siblings)
  const candidateExistingParents = useMemo(() => {
    return anchorExistingParents;
  }, [anchorExistingParents]);

  useEffect(() => {
    if (!anchorPerson) return;

    if (role === 'father') {
      setGender('male');
      setLastName(anchorPerson.last_name || '');
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
      const existingMother = candidateExistingParents.find((p) => p.gender === 'female') ?? candidateExistingParents[0];
      setCoParentId(existingMother?.id || '');
    } else if (role === 'mother') {
      setGender('female');
      setLineageName('');
      const existingFather = candidateExistingParents.find((p) => p.gender === 'male') ?? candidateExistingParents[0];
      setCoParentId(existingFather?.id || '');
    } else if (role === 'spouse') {
      setGender(anchorPerson.gender === 'male' ? 'female' : 'male');
      setCoParentId('');
    } else if (role === 'son') {
      setGender('male');
      setLastName(anchorPerson.gender === 'male' ? anchorPerson.first_name || anchorPerson.last_name : anchorPerson.last_name);
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
      setCoParentId(candidateCoParentsForChild[0]?.id || '');
    } else if (role === 'daughter') {
      setGender('female');
      setLastName(anchorPerson.gender === 'male' ? anchorPerson.first_name || anchorPerson.last_name : anchorPerson.last_name);
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
      setCoParentId(candidateCoParentsForChild[0]?.id || '');
    } else if (role === 'sibling') {
      setLastName(anchorPerson.last_name || '');
      setLineageName(anchorPerson.lineage_name || anchorPerson.nickname || '');
      setSharedParentFirstName(anchorPerson.last_name || '');
      setSharedParentLastName('');
      setCoParentId('');
    } else if (role === 'standalone') {
      setMode('create');
      setCoParentId('');
    }
  }, [role, anchorPerson, candidateCoParentsForChild, candidateExistingParents]);

  // Filtered existing people to connect
  const eligibleExistingPeople = useMemo(() => {
    const q = existingSearch.trim().toLowerCase();
    return people.filter((p) => {
      if (p.id === anchorPersonId) return false;
      if (!q) return true;
      const full = `${p.last_name} ${p.first_name} ${p.middle_name || ''} ${p.birth_date || ''}`.toLowerCase();
      return full.includes(q);
    });
  }, [people, anchorPersonId, existingSearch]);

  const selectedExistingTarget = useMemo(() => {
    return people.find((p) => p.id === existingTargetId) ?? null;
  }, [people, existingTargetId]);

  // Heuristic Temporal & Biological Validation
  const validationWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!anchorPerson || role === 'standalone') return warnings;

    const targetBirth = mode === 'existing' ? selectedExistingTarget?.birth_date : birthDate;
    if (!targetBirth) return warnings;

    const anchorYear = anchorPerson.birth_date ? parseInt(anchorPerson.birth_date.slice(0, 4), 10) : null;
    const newYear = parseInt(targetBirth.slice(0, 4), 10);

    if (anchorYear && newYear && !isNaN(anchorYear) && !isNaN(newYear)) {
      if (role === 'father' || role === 'mother') {
        if (newYear >= anchorYear) {
          warnings.push(`Эцэг/эх нь хүүхдээсээ залуу эсвэл ижил онд (${newYear} vs ${anchorYear}) төрсөн байж болохгүй.`);
        } else if (anchorYear - newYear < 14) {
          warnings.push(`Эцэг/эх ба хүүхдийн насны зөрүү хэт ойрхон (${anchorYear - newYear} жил) байна.`);
        } else if (anchorYear - newYear > 75) {
          warnings.push(`Эцэг/эх ба хүүхдийн насны зөрүү хэт хол (${anchorYear - newYear} жил) байна.`);
        }
      } else if (role === 'son' || role === 'daughter') {
        if (newYear <= anchorYear) {
          warnings.push(`Хүүхэд нь эцэг/эхээсээ өмнө эсвэл ижил онд (${newYear} vs ${anchorYear}) төрсөн байж болохгүй.`);
        } else if (newYear - anchorYear < 14) {
          warnings.push(`Эцэг/эх ба хүүхдийн насны зөрүү хэт бага (${newYear - anchorYear} жил) байна.`);
        }
      }
    }

    if (mode === 'create' && !isAlive && deathDate && birthDate) {
      const bY = parseInt(birthDate.slice(0, 4), 10);
      const dY = parseInt(deathDate.slice(0, 4), 10);
      if (bY && dY && dY < bY) {
        warnings.push(`Нас барсан он (${dY}) нь төрсөн оноос (${bY}) өмнө байж болохгүй.`);
      }
    }

    return warnings;
  }, [anchorPerson, birthDate, role, isAlive, deathDate, mode, selectedExistingTarget]);

  if (!isOpen) return null;

  const normalizeDateInput = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;
    return trimmed;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let targetPerson: Person;

      if (mode === 'existing' && role !== 'standalone') {
        if (!existingTargetId) {
          setError('Холбох бүртгэлтэй хүнээ жагсаалтаас сонгоно уу.');
          setLoading(false);
          return;
        }
        const found = people.find((p) => p.id === existingTargetId);
        targetPerson = {
          id: existingTargetId,
          first_name: found?.first_name ?? '',
          last_name: found?.last_name ?? '',
          middle_name: found?.middle_name ?? null,
          nickname: found?.nickname ?? null,
          gender: found?.gender ?? 'unknown',
          birth_date: found?.birth_date ?? null,
          birth_place: null,
          is_alive: found?.is_alive ?? true,
          death_date: found?.death_date ?? null,
          death_place: null,
          short_description: null,
          visibility: 'family',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        if (!firstName.trim()) {
          setError('Хүний өөрийн нэрийг заавал оруулна уу.');
          setLoading(false);
          return;
        }
        targetPerson = await api<Person>(`/families/${familyId}/persons`, {
          method: 'POST',
          body: JSON.stringify({
            last_name: lastName.trim(),
            first_name: firstName.trim(),
            middle_name: lineageName.trim() || null,
            gender,
            birth_date: normalizeDateInput(birthDate),
            is_alive: isAlive,
            death_date: !isAlive ? normalizeDateInput(deathDate) : null,
          }),
        });
      }

      if (anchorPerson && role !== 'standalone') {
        const res = await api<SmartConnectOut>(`/families/${familyId}/relationships/smart-connect`, {
          method: 'POST',
          body: JSON.stringify({
            anchor_person_id: anchorPerson.id,
            target_person_id: targetPerson.id,
            role,
            relationship_type: 'biological',
            co_parent_id: coParentId || null,
            auto_marry_coparent: autoMarryCoparent,
            apply_to_siblings: applyToSiblings,
            create_shared_parent_first_name:
              role === 'sibling' && anchorExistingParents.length === 0
                ? sharedParentFirstName.trim() || null
                : null,
            create_shared_parent_last_name:
              role === 'sibling' && anchorExistingParents.length === 0
                ? sharedParentLastName.trim() || null
                : null,
            create_shared_parent_gender: sharedParentGender,
          }),
        });
        onSuccess(targetPerson, res.summary);
      } else {
        onSuccess(
          targetPerson,
          `“${targetPerson.last_name} ${targetPerson.first_name}” анхдагч язгуур хүнээр бүртгэгдлээ.`,
        );
      }

      onClose();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('Ургийн холболт үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'grid',
        placeItems: 'center',
        padding: '16px',
        background: 'var(--ui-backdrop)',
        backdropFilter: 'blur(6px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pedigree-wizard-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          width: 'min(680px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--ui-surface)',
          color: 'var(--ui-text)',
          border: '1.5px solid var(--ui-border)',
          borderRadius: '20px',
          boxShadow: 'var(--ui-shadow-modal)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid var(--ui-border)',
            background: 'var(--ui-surface-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'var(--ui-accent-soft)',
                color: 'var(--ui-accent-bright)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TreeDeciduous size={20} />
            </div>
            <div>
              <h2
                id="pedigree-wizard-title"
                style={{ font: '700 18px Georgia, serif', margin: 0, color: 'var(--ui-text)' }}
              >
                Удмын Ухаалаг Холболт (Ураг Зангидах Хөтөч)
              </h2>
              <small style={{ color: 'var(--ui-text-secondary)', fontSize: '11.5px' }}>
                Шинэ хүн бүртгэж зангидах эсвэл бүртгэлтэй хүмүүсийг хооронд нь ухаалгаар холбох
              </small>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Цонхыг хаах"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '1px solid var(--ui-border)',
              background: 'var(--ui-surface-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--ui-text-secondary)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            overflowY: 'auto',
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          {error && (
            <div
              role="alert"
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'var(--ui-danger-bg)',
                border: '1px solid var(--ui-danger-border)',
                color: 'var(--ui-danger-text)',
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* MODE SWITCHER: CREATE NEW vs LINK EXISTING */}
          {people.length >= 1 && role !== 'standalone' && (
            <div
              role="tablist"
              aria-label="Холбох горим"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                padding: '5px',
                borderRadius: '12px',
                background: 'var(--ui-surface-subtle)',
                border: '1px solid var(--ui-border)',
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                onClick={() => setMode('create')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                  padding: '9px 12px',
                  borderRadius: '9px',
                  border: 'none',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: mode === 'create' ? 'var(--ui-surface-elevated)' : 'transparent',
                  color: mode === 'create' ? 'var(--ui-text)' : 'var(--ui-text-muted)',
                  boxShadow: mode === 'create' ? 'var(--ui-shadow-sm)' : 'none',
                }}
              >
                <UserPlus size={15} /> ✨ Шинэ хүн бүртгэж холбох
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'existing'}
                onClick={() => setMode('existing')}
                disabled={people.length < 2}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                  padding: '9px 12px',
                  borderRadius: '9px',
                  border: 'none',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: people.length < 2 ? 'not-allowed' : 'pointer',
                  background: mode === 'existing' ? 'var(--ui-surface-elevated)' : 'transparent',
                  color: mode === 'existing' ? 'var(--ui-accent-text)' : 'var(--ui-text-muted)',
                  boxShadow: mode === 'existing' ? 'var(--ui-shadow-sm)' : 'none',
                  opacity: people.length < 2 ? 0.5 : 1,
                }}
              >
                <Link2 size={15} /> 🔗 Бүртгэлтэй хүнээс сонгож холбох
              </button>
            </div>
          )}

          {/* SECTION 1: ANCHOR PERSON & RELATION ROLE */}
          <div
            style={{
              padding: '16px',
              borderRadius: '14px',
              background: 'var(--ui-surface-subtle)',
              border: '1px solid var(--ui-border)',
            }}
          >
            {people.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <label
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--ui-accent)',
                    display: 'block',
                    marginBottom: '6px',
                  }}
                >
                  1. Тулгуур хүн (Хэнтэй холбох вэ?):
                </label>
                <select
                  value={anchorPersonId}
                  onChange={(e) => setAnchorPersonId(e.target.value)}
                  disabled={loading}
                  className="admin-role-select"
                  style={{ width: '100%', height: '40px', fontSize: '13.5px', fontWeight: 600 }}
                >
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.last_name} {p.first_name}{' '}
                      {p.birth_date ? `(${p.birth_date.slice(0, 4)})` : ''} —{' '}
                      {p.gender === 'female' ? 'Эмэгтэй' : 'Эрэгтэй'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label
              style={{
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--ui-accent)',
                display: 'block',
                marginBottom: '8px',
              }}
            >
              2. Энэ хүний хэн болох вэ? (Ургийн хамаарал):
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
              {[
                { key: 'father', label: '👨‍🦳 Эцэг', desc: 'Төрсөн / өргөсөн аав' },
                { key: 'mother', label: '👵 Эх', desc: 'Төрсөн / өргөсөн ээж' },
                { key: 'spouse', label: '💍 Хань', desc: 'Эхнэр / Нөхөр' },
                { key: 'son', label: '👦 Хүү', desc: 'Үр хүүхэд (Эрэгтэй)' },
                { key: 'daughter', label: '👧 Охин', desc: 'Үр хүүхэд (Эмэгтэй)' },
                { key: 'sibling', label: '🤝 Ах, эгч, дүү', desc: 'Нэг эцэг эхийн хүүхэд' },
                ...(mode === 'create'
                  ? [{ key: 'standalone', label: '⭐ Шинэ язгуур', desc: 'Салангид эхлэл' }]
                  : []),
              ].map((item) => {
                const isSelected = role === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setRole(item.key as RelativeRole)}
                    disabled={loading}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      textAlign: 'left',
                      border: isSelected
                        ? '2px solid var(--ui-accent-bright)'
                        : '1px solid var(--ui-border)',
                      background: isSelected ? 'var(--ui-accent-soft)' : 'var(--ui-surface)',
                      color: isSelected ? 'var(--ui-accent-text)' : 'var(--ui-text)',
                      cursor: 'pointer',
                      transition: 'all 0.14s ease',
                    }}
                  >
                    <strong style={{ display: 'block', fontSize: '12.5px' }}>{item.label}</strong>
                    <small style={{ fontSize: '10px', color: 'var(--ui-text-muted)' }}>{item.desc}</small>
                  </button>
                );
              })}
            </div>

            {/* SMART CONTEXTUAL WIRING OPTIONS */}
            {/* A. Adding Son/Daughter -> Choose Co-Parent (Spouse) */}
            {(role === 'son' || role === 'daughter') && candidateCoParentsForChild.length > 0 && (
              <div
                style={{
                  marginTop: '14px',
                  paddingTop: '12px',
                  borderTop: '1px dashed var(--ui-border)',
                }}
              >
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ui-text)' }}>
                  Хоёр дахь эцэг/эх (Хань)-тэй нь зэрэг холбох:
                </label>
                <select
                  value={coParentId}
                  onChange={(e) => setCoParentId(e.target.value)}
                  className="admin-role-select"
                  style={{ width: '100%', marginTop: '4px', height: '36px', fontSize: '12.5px' }}
                >
                  <option value="">
                    -- Зөвхөн {anchorPerson ? formatPersonName(anchorPerson) : ''}-тэй холбох --
                  </option>
                  {candidateCoParentsForChild.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      💍 {sp.last_name} {sp.first_name} (Ханьтай нь хамт эцэг эхээр зангидах)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* B. Adding Father/Mother when other parent already exists -> Auto-marry & apply to siblings */}
            {(role === 'father' || role === 'mother') && candidateExistingParents.length > 0 && (
              <div
                style={{
                  marginTop: '14px',
                  paddingTop: '12px',
                  borderTop: '1px dashed var(--ui-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ui-text)' }}>
                  Одоо бүртгэлтэй нөгөө эцэг/эх:
                </label>
                <select
                  value={coParentId}
                  onChange={(e) => setCoParentId(e.target.value)}
                  className="admin-role-select"
                  style={{ width: '100%', height: '36px', fontSize: '12.5px' }}
                >
                  <option value="">-- Нөгөө эцэг/эхтэй холбохгүй --</option>
                  {candidateExistingParents.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.last_name} {ep.first_name} ({ep.gender === 'female' ? 'Эх' : 'Эцэг'})
                    </option>
                  ))}
                </select>
                {coParentId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={autoMarryCoparent}
                        onChange={(e) => setAutoMarryCoparent(e.target.checked)}
                        style={{ accentColor: 'var(--ui-accent-bright)' }}
                      />
                      <span>Эцэг эх хоёрын хооронд автоматаар Гэрлэлтийн холбоос (💍 Хос) үүсгэх</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={applyToSiblings}
                        onChange={(e) => setApplyToSiblings(e.target.checked)}
                        style={{ accentColor: 'var(--ui-accent-bright)' }}
                      />
                      <span>Төрсөн ах, эгч, дүүст нь мөн адил эцэг/эхээр шууд холбох</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* C. Adding Sibling when anchor has NO parents -> Offer automatic shared parent creation */}
            {role === 'sibling' && anchorExistingParents.length === 0 && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '12px',
                  borderRadius: '10px',
                  background: 'var(--ui-warning-bg)',
                  border: '1px solid var(--ui-warning-border)',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ui-warning-text)', marginBottom: '6px' }}>
                  💡 {anchorPerson ? formatPersonName(anchorPerson) : 'Тулгуур хүн'} дээр эцэг эх хараахан бүртгэгдээгүй байна.
                </div>
                <small style={{ display: 'block', fontSize: '11.5px', color: 'var(--ui-warning-text)', marginBottom: '10px' }}>
                  Ах дүүс модон дээр зэрэгцэн зурагдахын тулд дундын эцэг (эсвэл эх)-ийн нэрийг оруулбал хоёуланг нь автоматаар зангидна:
                </small>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: '8px' }}>
                  <input
                    type="text"
                    value={sharedParentLastName}
                    onChange={(e) => setSharedParentLastName(e.target.value)}
                    placeholder="Эцгийн овог"
                    className="ui-input"
                  />
                  <input
                    type="text"
                    value={sharedParentFirstName}
                    onChange={(e) => setSharedParentFirstName(e.target.value)}
                    placeholder="Эцэг/эхийн нэр *"
                    className="ui-input"
                  />
                  <select
                    value={sharedParentGender}
                    onChange={(e) => setSharedParentGender(e.target.value as 'male' | 'female')}
                    className="ui-select"
                  >
                    <option value="male">Эцэг</option>
                    <option value="female">Эх</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* HEURISTIC VALIDATION WARNINGS */}
          {validationWarnings.length > 0 && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'var(--ui-warning-bg)',
                border: '1px solid var(--ui-warning-border)',
                color: 'var(--ui-warning-text)',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                <AlertTriangle size={15} /> Огнооны логик анхааруулга:
              </div>
              {validationWarnings.map((w, idx) => (
                <span key={idx} style={{ paddingLeft: '20px' }}>
                  • {w}
                </span>
              ))}
            </div>
          )}

          {/* SECTION 2A: SELECT EXISTING PERSON */}
          {mode === 'existing' && role !== 'standalone' ? (
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                background: 'var(--ui-surface-subtle)',
                border: '1px solid var(--ui-border)',
              }}
            >
              <label
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--ui-accent)',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                3. Холбох бүртгэлтэй хүнээ сонгоно уу:
              </label>
              <div style={{ position: 'relative', marginBottom: '10px' }}>
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--ui-text-muted)',
                  }}
                />
                <input
                  type="search"
                  value={existingSearch}
                  onChange={(e) => setExistingSearch(e.target.value)}
                  placeholder="Овог, нэр эсвэл төрсөн оноор хайх…"
                  className="ui-input"
                  style={{ paddingLeft: '34px' }}
                />
              </div>

              <div
                style={{
                  maxHeight: '210px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {eligibleExistingPeople.length === 0 ? (
                  <p style={{ fontSize: '12.5px', color: 'var(--ui-text-muted)', margin: '8px 0' }}>
                    Тохирох бүртгэлтэй хүн олдсонгүй.
                  </p>
                ) : (
                  eligibleExistingPeople.map((p) => {
                    const selected = p.id === existingTargetId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setExistingTargetId(p.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '9px 12px',
                          borderRadius: '9px',
                          border: selected ? '2px solid var(--ui-accent-bright)' : '1px solid var(--ui-border)',
                          background: selected ? 'var(--ui-accent-soft)' : 'var(--ui-surface)',
                          color: 'var(--ui-text)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: '13px', color: 'var(--ui-text)' }}>
                            {formatPersonName(p)}
                          </strong>
                          <span style={{ fontSize: '11.5px', color: 'var(--ui-text-muted)', marginLeft: '8px' }}>
                            {p.gender === 'female' ? 'Эмэгтэй' : 'Эрэгтэй'}
                            {p.birth_date ? ` · ${p.birth_date.slice(0, 4)}` : ''}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: selected ? 'var(--ui-accent-text)' : 'var(--ui-text-muted)',
                          }}
                        >
                          {selected ? '✓ Сонгосон' : 'Сонгох'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* SECTION 2B: CREATE NEW PERSON DETAILS */
            <div>
              <label
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--ui-accent)',
                  display: 'block',
                  marginBottom: '10px',
                }}
              >
                3. Шинэ хүний мэдээлэл:
              </label>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '12px',
                  marginBottom: '14px',
                }}
              >
                <label className="ui-label">
                  Эцгийн нэр / Овог (Last Name)
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Боржигон / Дорж"
                    disabled={loading}
                    className="ui-input"
                    style={{ marginTop: '4px' }}
                  />
                </label>

                <label className="ui-label">
                  Өөрийн нэр (First Name) *
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Батбаяр"
                    required
                    disabled={loading}
                    className="ui-input"
                    style={{ marginTop: '4px' }}
                  />
                </label>

                <label className="ui-label">
                  Хүйс *
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as 'male' | 'female')}
                    disabled={loading || role === 'father' || role === 'mother'}
                    className="admin-role-select"
                    style={{ width: '100%', marginTop: '4px', height: '38px', fontSize: '13px' }}
                  >
                    <option value="male">Эрэгтэй</option>
                    <option value="female">Эмэгтэй</option>
                  </select>
                </label>

                <label className="ui-label">
                  Төрсөн огноо (Он эсвэл YYYY-MM-DD)
                  <input
                    type="text"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    placeholder="1985 эсвэл 1985-06-15"
                    disabled={loading}
                    className="ui-input"
                    style={{ marginTop: '4px' }}
                  />
                </label>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '12px',
                  marginBottom: '6px',
                  alignItems: 'center',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isAlive}
                    onChange={(e) => setIsAlive(e.target.checked)}
                    disabled={loading}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--ui-accent-bright)' }}
                  />
                  <span>{isAlive ? '🟢 Амьд сэрүүн' : '🕊️ Тэнгэрт дэвшсэн'}</span>
                </label>

                {!isAlive && (
                  <label className="ui-label">
                    Нас барсан он / огноо:
                    <input
                      type="text"
                      value={deathDate}
                      onChange={(e) => setDeathDate(e.target.value)}
                      placeholder="2018"
                      disabled={loading}
                      className="ui-input"
                      style={{ marginTop: '4px' }}
                    />
                  </label>
                )}

                <label className="ui-label">
                  Ургийн овог / Дундах нэр:
                  <input
                    type="text"
                    value={lineageName}
                    onChange={(e) => setLineageName(e.target.value)}
                    placeholder="Хиад Боржигон"
                    disabled={loading}
                    className="ui-input"
                    style={{ marginTop: '4px' }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Modal Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              paddingTop: '14px',
              borderTop: '1px solid var(--ui-border)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="homev2-button homev2-button--light"
              style={{ fontSize: '13px', padding: '9px 18px' }}
            >
              Болих
            </button>
            <button
              type="submit"
              disabled={loading}
              className="homev2-button homev2-button--primary"
              style={{
                fontSize: '13px',
                padding: '9px 24px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 700,
              }}
            >
              {loading ? (
                'Зангидаж байна…'
              ) : (
                <>
                  <Sparkles size={16} />{' '}
                  {mode === 'existing' && role !== 'standalone'
                    ? 'Сонгосон хүнтэй ураг зангидах'
                    : 'Бүртгэж, Ургийн модонд зангидах'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
