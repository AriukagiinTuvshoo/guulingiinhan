'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArrowLeft,
  Camera,
  Check,
  FileText,
  LayoutDashboard,
  Link2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { ApiError, api, Family, Person, personName, TreeData } from '../../lib/api';
import { announcePhotoChange, IMAGE_ACCEPT, prepareImageUpload } from '../../lib/image-upload';
import ProfilePhoto from '../profile-photo';
import SmartDateInput, { normalizeFlexibleDate } from '../smart-date-input';
import { ThemePicker } from '../theme-picker';
import { MongolianOrnamentBand } from '../mongolian-ornament-band';
import '../../app/admin/admin-v3.css';

type AdminTab = 'overview' | 'people' | 'members' | 'content' | 'settings' | 'archive';
type PeopleFilter = 'all' | 'incomplete' | 'unconnected';

type AuditEntry = {
  id: string;
  action: string;
  target_type: string;
  created_at: string;
};

type MemberRow = {
  user_id: string;
  display_name?: string;
  email?: string | null;
  role: string;
};

type TrashItem = {
  id: string;
  person_id: string;
  first_name: string;
  last_name: string;
  deleted_at: string;
};

type TrashPageData = {
  items: TrashItem[];
  total: number;
};

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
};

type PendingDiff = {
  personId: string;
  personLabel: string;
  summary: string;
  prevPayload: Record<string, unknown>;
  nextPayload: Record<string, unknown>;
};

const TEMP_ARCHIVE_KEY_PREFIX = 'guulin-temp-archive-v1:';

function completenessScore(p: Person): number {
  let score = 20; // name exists
  if (p.gender && p.gender !== 'unknown') score += 20;
  if (p.birth_date) score += 20;
  if (p.profile_photo_url) score += 20;
  if (p.short_description && p.short_description.trim().length > 2) score += 20;
  return score;
}

function genderLabel(g: string) {
  if (g === 'male') return 'Эрэгтэй';
  if (g === 'female') return 'Эмэгтэй';
  return 'Тодорхойгүй';
}

export default function AdminV3Workspace() {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // People filter, search & direct editor state
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all');
  const [search, setSearch] = useState('');
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [editForm, setEditForm] = useState({
    first_name: '',
    last_name: '',
    gender: 'unknown',
    birth_date: '',
    birth_place: '',
    is_alive: true,
    short_description: '',
  });
  const [pendingDiff, setPendingDiff] = useState<PendingDiff | null>(null);
  const [saving, setSaving] = useState(false);

  // Add New Person inline panel
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonForm, setNewPersonForm] = useState({
    first_name: '',
    last_name: '',
    gender: 'male',
    birth_date: '',
    birth_place: '',
  });

  // Orphan / Unconnected Person Linker
  const [linkingPerson, setLinkingPerson] = useState<Person | null>(null);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkRelation, setLinkRelation] = useState<'child_of' | 'parent_of' | 'spouse_of'>('child_of');

  // Temporary Archive (client-persisted soft hide until restored or trashed)
  const [tempArchivedIds, setTempArchivedIds] = useState<string[]>([]);
  const [archiveSubTab, setArchiveSubTab] = useState<'temp' | 'trash'>('temp');

  // Invite form & list
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'member'>('editor');
  const [inviteBusy, setInviteBusy] = useState(false);

  // 10s Undo Toast
  const [toast, setToast] = useState<{
    message: string;
    undo?: () => Promise<void>;
    secondsLeft: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, undo?: () => Promise<void>) => {
    if (toastTimerRef.current) window.clearInterval(toastTimerRef.current);
    setToast({ message, undo, secondsLeft: 10 });
    toastTimerRef.current = window.setInterval(() => {
      setToast((prev) => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) {
          if (toastTimerRef.current) window.clearInterval(toastTimerRef.current);
          return null;
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearInterval(toastTimerRef.current);
    };
  }, []);

  // Load families
  useEffect(() => {
    let active = true;
    api<Family[]>('/families')
      .then((list) => {
        if (!active) return;
        const allowed = list.filter((f) => f.role === 'owner' || f.role === 'editor');
        setFamilies(allowed);
        const paramFam =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('family') ?? ''
            : '';
        const chosen = allowed.find((f) => f.id === paramFam)?.id ?? allowed[0]?.id ?? '';
        setFamilyId(chosen);
        if (!chosen) setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Удирдлагын орчныг ачаалж чадсангүй.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  // Load temporary archive list from localStorage for this family
  useEffect(() => {
    if (!familyId) return;
    try {
      const raw = localStorage.getItem(TEMP_ARCHIVE_KEY_PREFIX + familyId);
      setTempArchivedIds(raw ? JSON.parse(raw) : []);
    } catch {
      setTempArchivedIds([]);
    }
  }, [familyId]);

  const persistTempArchive = useCallback(
    (next: string[]) => {
      setTempArchivedIds(next);
      if (!familyId) return;
      try {
        localStorage.setItem(TEMP_ARCHIVE_KEY_PREFIX + familyId, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [familyId],
  );

  // Load family admin data (100% verified FastAPI endpoints!)
  const refreshFamilyData = useCallback(async (fid: string) => {
    if (!fid) return;
    setLoading(true);
    setError('');
    try {
      const [ppl, tr, mems, logs, trshPage, invs] = await Promise.all([
        api<Person[]>(`/families/${encodeURIComponent(fid)}/persons`).catch(() => []),
        api<TreeData>(`/families/${encodeURIComponent(fid)}/tree?depth=9`).catch(() => null),
        api<MemberRow[]>(`/families/${encodeURIComponent(fid)}/members`).catch(() => []),
        api<AuditEntry[]>(`/families/${encodeURIComponent(fid)}/audit`).catch(() => []),
        api<TrashPageData>(`/families/${encodeURIComponent(fid)}/trash?page=1&page_size=25`).catch(() => ({ items: [], total: 0 })),
        api<InvitationRow[]>(`/families/${encodeURIComponent(fid)}/invitations`).catch(() => []),
      ]);
      setPeople(Array.isArray(ppl) ? ppl : []);
      setTree(tr);
      setMembers(Array.isArray(mems) ? mems : []);
      setAudits(Array.isArray(logs) ? logs : []);
      setTrashItems(Array.isArray(trshPage?.items) ? trshPage.items : []);
      setInvitations(Array.isArray(invs) ? invs : []);
    } catch {
      setError('Гэр бүлийн удирдлагын өгөгдөл татахад алдаа гарлаа.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (familyId) void refreshFamilyData(familyId);
  }, [familyId, refreshFamilyData]);

  const currentFamily = useMemo(
    () => families.find((f) => f.id === familyId) ?? null,
    [families, familyId],
  );

  // Compute connected vs orphan (unconnected) person IDs from real tree relationships
  const connectedIds = useMemo(() => {
    const set = new Set<string>();
    tree?.parent_child_relationships.forEach((r) => {
      set.add(r.parent_id);
      set.add(r.child_id);
    });
    tree?.marriages.forEach((m) => {
      set.add(m.person_1_id);
      set.add(m.person_2_id);
    });
    return set;
  }, [tree]);

  const activePeople = useMemo(
    () => people.filter((p) => !tempArchivedIds.includes(p.id)),
    [people, tempArchivedIds],
  );

  const orphanPeople = useMemo(
    () => activePeople.filter((p) => !connectedIds.has(p.id)),
    [activePeople, connectedIds],
  );

  const incompletePeople = useMemo(
    () => activePeople.filter((p) => completenessScore(p) < 80),
    [activePeople],
  );

  const filteredPeople = useMemo(() => {
    const base =
      peopleFilter === 'unconnected'
        ? orphanPeople
        : peopleFilter === 'incomplete'
        ? incompletePeople
        : activePeople;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) => personName(p).toLowerCase().includes(q));
  }, [peopleFilter, orphanPeople, incompletePeople, activePeople, search]);

  function openEdit(p: Person) {
    setEditingPerson(p);
    setPendingDiff(null);
    setEditForm({
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      gender: p.gender || 'unknown',
      birth_date: p.birth_date || '',
      birth_place: p.birth_place || '',
      is_alive: p.is_alive,
      short_description: p.short_description || '',
    });
  }

  function prepareDiff(event: FormEvent) {
    event.preventDefault();
    if (!editingPerson) return;
    const changes: string[] = [];
    if (editForm.first_name !== editingPerson.first_name) changes.push(`Нэр: ${editingPerson.first_name} → ${editForm.first_name}`);
    if (editForm.gender !== editingPerson.gender) changes.push(`Хүйс: ${genderLabel(editingPerson.gender)} → ${genderLabel(editForm.gender)}`);
    if ((editForm.birth_date || '') !== (editingPerson.birth_date || '')) changes.push(`Төрсөн огноо шинэчлэгдэнэ`);
    if ((editForm.short_description || '') !== (editingPerson.short_description || '')) changes.push(`Намтар шинэчлэгдэнэ`);

    const prevPayload = {
      first_name: editingPerson.first_name,
      last_name: editingPerson.last_name,
      gender: editingPerson.gender,
      birth_date: editingPerson.birth_date || null,
      birth_place: editingPerson.birth_place || null,
      is_alive: editingPerson.is_alive,
      short_description: editingPerson.short_description || null,
    };
    const nextPayload = {
      first_name: editForm.first_name.trim(),
      last_name: editForm.last_name.trim(),
      gender: editForm.gender,
      birth_date: editForm.birth_date || null,
      birth_place: editForm.birth_place.trim() || null,
      is_alive: editForm.is_alive,
      short_description: editForm.short_description.trim() || null,
    };
    setPendingDiff({
      personId: editingPerson.id,
      personLabel: personName(editingPerson),
      summary: changes.length ? changes.join(' · ') : 'Мэдээлэл шинэчлэгдэнэ',
      prevPayload,
      nextPayload,
    });
  }

  async function commitDiff() {
    if (!pendingDiff || !familyId) return;
    const diff = pendingDiff;
    const birthCheck = normalizeFlexibleDate(String(diff.nextPayload.birth_date || ''));
    if (birthCheck.error) {
      setError(birthCheck.error);
      return;
    }
    const cleanNext = { ...diff.nextPayload, birth_date: birthCheck.iso };
    setSaving(true);
    setError('');
    try {
      const personUrl = `/families/${encodeURIComponent(familyId)}/persons/${encodeURIComponent(diff.personId)}`;
      await api(personUrl, {
        method: 'PATCH',
        body: JSON.stringify(cleanNext),
      });
      setPendingDiff(null);
      setEditingPerson(null);
      await refreshFamilyData(familyId);
      showToast(`${diff.personLabel}-ийн мэдээлэл хадгалагдлаа`, async () => {
        await api(personUrl, {
          method: 'PATCH',
          body: JSON.stringify(diff.prevPayload),
        });
        await refreshFamilyData(familyId);
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.validationMessage || cause.message) : 'Хүний мэдээллийг хадгалж чадсангүй.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDirectPhotoUpload(person: Person, file: File) {
    if (!familyId) return;
    setSaving(true);
    try {
      const prepared = await prepareImageUpload(file);
      const endpoint = `/families/${encodeURIComponent(familyId)}/persons/${encodeURIComponent(person.id)}/profile-photo`;
      const result = await api<{ profile_photo_url?: string }>(endpoint, {
        method: 'POST',
        body: prepared,
        headers: {
          'Content-Type': prepared.type,
          'X-File-Name': encodeURIComponent(prepared.name),
        },
      });
      announcePhotoChange({
        endpoint,
        hasPhoto: true,
        url: result?.profile_photo_url || `${endpoint}?v=${Date.now()}`,
      });
      await refreshFamilyData(familyId);
      showToast(`${personName(person)}-ийн зураг шинэчлэгдлээ`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Зураг оруулахад алдаа гарлаа.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPerson(event: FormEvent) {
    event.preventDefault();
    if (!familyId || !newPersonForm.first_name.trim()) return;
    const parsedBirth = normalizeFlexibleDate(newPersonForm.birth_date);
    if (parsedBirth.error) {
      setError(parsedBirth.error);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/families/${encodeURIComponent(familyId)}/persons`, {
        method: 'POST',
        body: JSON.stringify({
          first_name: newPersonForm.first_name.trim(),
          last_name: newPersonForm.last_name.trim(),
          gender: newPersonForm.gender,
          birth_date: parsedBirth.iso,
          birth_place: newPersonForm.birth_place.trim() || null,
          is_alive: true,
          visibility: 'family',
        }),
      });
      setShowAddPerson(false);
      setNewPersonForm({ first_name: '', last_name: '', gender: 'male', birth_date: '', birth_place: '' });
      await refreshFamilyData(familyId);
      showToast('Шинэ хүн амжилттай бүртгэгдлээ');
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.validationMessage || cause.message) : 'Хүн нэмэхэд алдаа гарлаа.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkOrphan(event: FormEvent) {
    event.preventDefault();
    if (!familyId || !linkingPerson || !linkTargetId) return;
    setSaving(true);
    setError('');
    try {
      if (linkRelation === 'spouse_of') {
        await api(`/families/${encodeURIComponent(familyId)}/marriages`, {
          method: 'POST',
          body: JSON.stringify({
            person_1_id: linkingPerson.id,
            person_2_id: linkTargetId,
            status: 'married',
          }),
        });
      } else {
        const parent_id = linkRelation === 'parent_of' ? linkingPerson.id : linkTargetId;
        const child_id = linkRelation === 'parent_of' ? linkTargetId : linkingPerson.id;
        await api(`/families/${encodeURIComponent(familyId)}/relationships/parent-child`, {
          method: 'POST',
          body: JSON.stringify({ parent_id, child_id, relationship_type: 'biological' }),
        });
      }
      const linkedName = personName(linkingPerson);
      setLinkingPerson(null);
      setLinkTargetId('');
      await refreshFamilyData(familyId);
      showToast(`${linkedName} амжилттай модонд холбогдлоо`);
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.validationMessage || cause.message) : 'Модонд холбоход алдаа гарлаа.');
    } finally {
      setSaving(false);
    }
  }

  function tempArchivePerson(p: Person) {
    const next = Array.from(new Set([...tempArchivedIds, p.id]));
    persistTempArchive(next);
    showToast(`${personName(p)} түр архив руу шилжлээ`, async () => {
      persistTempArchive(next.filter((id) => id !== p.id));
    });
  }

  function restoreTempArchive(personId: string) {
    persistTempArchive(tempArchivedIds.filter((id) => id !== personId));
    showToast('Түр архиваас буцааж гаргалаа');
  }

  async function sendInvitation(event: FormEvent) {
    event.preventDefault();
    if (!familyId || inviteBusy || !inviteEmail.trim()) return;
    setInviteBusy(true);
    setError('');
    try {
      await api(`/families/${encodeURIComponent(familyId)}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail('');
      await refreshFamilyData(familyId);
      showToast('Урилга амжилттай илгээгдлээ');
    } catch {
      setError('Урилга илгээж чадсангүй. Имэйл хаягаа шалгана уу.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function restoreTrashItem(item: TrashItem) {
    if (!familyId) return;
    setSaving(true);
    try {
      await api(`/families/${encodeURIComponent(familyId)}/trash/${encodeURIComponent(item.id)}/restore`, {
        method: 'POST',
      });
      await refreshFamilyData(familyId);
      showToast(`${item.last_name} ${item.first_name} хогийн савнаас сэргээгдлээ`);
    } catch {
      setError('Хогийн савнаас сэргээж чадсангүй.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !families.length) {
    return (
      <div className="adv3-content">
        <div className="hush-empty">Удирдлагын төвийг ачаалж байна…</div>
      </div>
    );
  }

  if (!families.length) {
    return (
      <div className="adv3-content">
        <div className="hush-empty">
          <h2>Удирдлагын эрх олдсонгүй</h2>
          <p>Та Эзэмшигч (Owner) эсвэл Засагч (Editor) эрхтэй гэр бүлтэй байх шаардлагатай.</p>
          <Link href="/tree" className="adv3-btn is-primary" style={{ marginTop: 12 }}>
            ← Удмын мод руу буцах
          </Link>
        </div>
      </div>
    );
  }

  const archivedPeople = people.filter((p) => tempArchivedIds.includes(p.id));

  return (
    <div className="adv3-shell">
      <aside className="adv3-sidebar" aria-label="Админ удирдлагын цэс">
        <div className="adv3-logo">ГУУЛИН</div>
        <div className="adv3-sublogo">Удирдлагын төв · v3</div>

        {(
          [
            ['overview', 'Тойм', LayoutDashboard, 0],
            ['people', 'Хүмүүс & Холбоос', Users, orphanPeople.length],
            ['members', 'Гишүүд & Урилга', ShieldCheck, members.length],
            ['content', 'Агуулга', FileText, 0],
            ['settings', 'Эрх & Тохиргоо', Link2, 0],
            ['archive', 'Түр архив & Хогийн сав', Archive, archivedPeople.length + trashItems.length],
          ] as [AdminTab, string, typeof LayoutDashboard, number][]
        ).map(([id, label, Icon, count]) => (
          <button
            key={id}
            type="button"
            className={`adv3-nav-btn ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span className="adv3-nav-btn__left">
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </span>
            {count > 0 && <span className="adv3-nav-badge">{count}</span>}
          </button>
        ))}

        <div className="adv3-sidebar-footer">
          <Link
            href={familyId ? `/tree?family=${encodeURIComponent(familyId)}` : '/tree'}
            className="adv3-nav-btn"
            style={{ textDecoration: 'none' }}
          >
            <span className="adv3-nav-btn__left">
              <ArrowLeft size={16} />
              <span>Удмын мод руу</span>
            </span>
          </Link>
        </div>
      </aside>

      <div className="adv3-main">
        <header className="adv3-topbar">
          {families.length > 1 ? (
            <select
              className="adv3-family-select"
              value={familyId}
              onChange={(e) => setFamilyId(e.target.value)}
              aria-label="Гэр бүл сонгох"
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.role})
                </option>
              ))}
            </select>
          ) : (
            <span className="adv3-family-pill">
              🌳 {currentFamily?.name} · {currentFamily?.role === 'owner' ? 'ЭЗЭМШИГЧ' : 'ЗАСАГЧ'}
            </span>
          )}

          <div className="adv3-topbar-right">
            <ThemePicker variant="compact" />
            <Link
              href={familyId ? `/tree?family=${encodeURIComponent(familyId)}` : '/tree'}
              className="adv3-btn"
            >
              <ArrowLeft size={14} /> Удмын мод
            </Link>
          </div>
        </header>

        <div className="adv3-content">
          {error && (
            <div className="settings-v2-notice is-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: OVERVIEW (Тойм) */}
          {tab === 'overview' && (
            <>
              <div className="adv3-head">
                <div>
                  <h1>Тойм</h1>
                  <p className="adv3-sub">{currentFamily?.name} — удмын удирдлага ба сүүлийн үйлдлүүд</p>
                </div>
                <button type="button" className="adv3-btn is-primary" onClick={() => { setTab('people'); setShowAddPerson(true); }}>
                  <Plus size={15} /> Хүн нэмэх
                </button>
              </div>
              <MongolianOrnamentBand />

              <div className="adv3-kpi-grid">
                <div className="adv3-kpi"><b>{activePeople.length}</b><span>Удмын хүн</span></div>
                <div className="adv3-kpi"><b>{orphanPeople.length}</b><span>Холбогдоогүй хүн</span></div>
                <div className="adv3-kpi"><b>{members.length}</b><span>Идэвхтэй гишүүн</span></div>
                <div className="adv3-kpi"><b>{archivedPeople.length}</b><span>Түр архив</span></div>
              </div>

              <div className="adv3-two-col">
                <section className="adv3-card">
                  <h3>Анхаарах зүйлс</h3>
                  <div className="adv3-list-item">
                    <div>
                      <strong>Мэдээлэл дутуу хүмүүс ({incompletePeople.length})</strong>
                      <div className="adv3-sub">Үндсэн эх хүмүүс болон зураг/намтар дутуу гишүүдээ шууд нөхнө.</div>
                    </div>
                    <button type="button" className="adv3-btn" onClick={() => { setTab('people'); setPeopleFilter('incomplete'); }}>
                      Нөхөх →
                    </button>
                  </div>
                  <div className="adv3-list-item">
                    <div>
                      <strong>Холбогдоогүй үлдсэн хүмүүс ({orphanPeople.length})</strong>
                      <div className="adv3-sub">Удмын модонд хараахан холбогдоогүй хүмүүсийг 1 товшилтоор холбоно.</div>
                    </div>
                    <button type="button" className="adv3-btn is-primary" onClick={() => { setTab('people'); setPeopleFilter('unconnected'); }}>
                      Холбох →
                    </button>
                  </div>
                  <div className="adv3-list-item">
                    <div>
                      <strong>Гишүүн урих (Эзэмшигч &amp; Засагч)</strong>
                      <div className="adv3-sub">Гэр бүлийнхэндээ урилгын линк илгээж хамтдаа удмаа бүрдүүлнэ.</div>
                    </div>
                    <button type="button" className="adv3-btn" onClick={() => setTab('members')}>
                      Урих →
                    </button>
                  </div>
                </section>

                <section className="adv3-card">
                  <h3>Сүүлийн үйлдлүүд</h3>
                  {audits.length === 0 ? (
                    <p className="adv3-sub">Сүүлийн үйлдэл бүртгэгдээгүй байна.</p>
                  ) : (
                    audits.slice(0, 8).map((log) => (
                      <div className="adv3-list-item" key={log.id}>
                        <div>
                          <strong>{log.action}</strong>
                          <div className="adv3-sub">{new Date(log.created_at).toLocaleString('mn-MN')}</div>
                        </div>
                        <span className="adv3-tag">{log.target_type}</span>
                      </div>
                    ))
                  )}
                </section>
              </div>
            </>
          )}

          {/* TAB 2: PEOPLE & ORPHAN LINKER & DIFF/UNDO */}
          {tab === 'people' && (
            <>
              <div className="adv3-head">
                <div>
                  <h1>Хүмүүс &amp; Холбоос</h1>
                  <p className="adv3-sub">Эзэмшигч болон Засагч бүр хүн нэмэх, зураг/намтар засах, холбогдоогүй хүнийг модонд холбох боломжтой.</p>
                </div>
                <button type="button" className="adv3-btn is-primary" onClick={() => setShowAddPerson((v) => !v)}>
                  <Plus size={15} /> {showAddPerson ? 'Хаах' : 'Хүн нэмэх'}
                </button>
              </div>
              <MongolianOrnamentBand />

              {showAddPerson && (
                <form className="adv3-card" style={{ marginBottom: 16 }} onSubmit={handleAddPerson}>
                  <h3>Шинэ хүн бүртгэх</h3>
                  <div className="adv3-form-grid">
                    <label>
                      Овог
                      <input value={newPersonForm.last_name} onChange={(e) => setNewPersonForm({ ...newPersonForm, last_name: e.target.value })} placeholder="Гуулин" />
                    </label>
                    <label>
                      Нэр *
                      <input required value={newPersonForm.first_name} onChange={(e) => setNewPersonForm({ ...newPersonForm, first_name: e.target.value })} placeholder="Нэр" />
                    </label>
                    <label>
                      Хүйс
                      <select value={newPersonForm.gender} onChange={(e) => setNewPersonForm({ ...newPersonForm, gender: e.target.value })}>
                        <option value="male">Эрэгтэй</option>
                        <option value="female">Эмэгтэй</option>
                        <option value="unknown">Тодорхойгүй</option>
                      </select>
                    </label>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--gt)', marginBottom: 4 }}>
                        Төрсөн огноо (Он эсвэл Он-Сар-Өдөр)
                      </span>
                      <SmartDateInput
                        value={newPersonForm.birth_date}
                        onChange={(val) => setNewPersonForm({ ...newPersonForm, birth_date: val })}
                        disabled={saving}
                      />
                    </div>
                    <label>
                      Төрсөн газар
                      <input value={newPersonForm.birth_place} onChange={(e) => setNewPersonForm({ ...newPersonForm, birth_place: e.target.value })} placeholder="Архангай" />
                    </label>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <button type="submit" className="adv3-btn is-primary" disabled={saving}>Бүртгэх</button>
                    <button type="button" className="adv3-btn" onClick={() => setShowAddPerson(false)}>Болих</button>
                  </div>
                </form>
              )}

              <div className="adv3-toolbar">
                <div className="hush-seg" role="group" aria-label="Хүмүүс шүүх">
                  <button type="button" className={peopleFilter === 'all' ? 'is-on' : ''} onClick={() => setPeopleFilter('all')}>
                    Бүгд ({activePeople.length})
                  </button>
                  <button type="button" className={peopleFilter === 'incomplete' ? 'is-on' : ''} onClick={() => setPeopleFilter('incomplete')}>
                    Мэдээлэл дутуу ({incompletePeople.length})
                  </button>
                  <button type="button" className={peopleFilter === 'unconnected' ? 'is-on' : ''} onClick={() => setPeopleFilter('unconnected')}>
                    🔗 Холбогдоогүй ({orphanPeople.length})
                  </button>
                </div>
                <input
                  className="adv3-search"
                  type="search"
                  placeholder="Нэрээр хайх…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="adv3-card">
                <div className="adv3-table-wrap">
                  <table className="adv3-table">
                    <thead>
                      <tr>
                        <th>ХҮН</th>
                        <th>ХҮЙС</th>
                        <th>ОГНОО / НУТАГ</th>
                        <th>БҮРЭН БАЙДАЛ</th>
                        <th>ТӨЛӨВ</th>
                        <th>ҮЙЛДЭЛ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPeople.map((p) => {
                        const pct = completenessScore(p);
                        const isOrphan = !connectedIds.has(p.id);
                        return (
                          <tr key={p.id} className={isOrphan ? 'is-orphan' : ''}>
                            <td>
                              <div className="adv3-person-cell">
                                <span className={`adv3-av ${p.gender === 'female' ? 'is-female' : ''}`}>
                                  <ProfilePhoto
                                    url={p.profile_photo_url}
                                    name={personName(p)}
                                    fallback={(p.first_name || '?').slice(0, 1).toUpperCase()}
                                    className="adv3-av-photo"
                                  />
                                </span>
                                <div>
                                  <strong>{personName(p)}</strong>
                                  <div className="adv3-sub" style={{ margin: 0, fontSize: 12 }}>
                                    {p.is_alive ? 'Амьд сэрүүн' : 'Бурхан болсон'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>{genderLabel(p.gender)}</td>
                            <td>
                              {p.birth_date ? p.birth_date.slice(0, 4) : '—'}
                              {p.birth_place ? ` · ${p.birth_place}` : ''}
                            </td>
                            <td>
                              <span className="adv3-bar"><i style={{ width: `${pct}%` }} /></span>
                              {pct}%
                            </td>
                            <td>
                              {isOrphan ? (
                                <span className="adv3-tag is-danger">🔗 Холбогдоогүй</span>
                              ) : !p.profile_photo_url ? (
                                <span className="adv3-tag is-warn">Зураг дутуу</span>
                              ) : (
                                <span className="adv3-tag is-ok">Холбогдсон</span>
                              )}
                            </td>
                            <td>
                              <div className="adv3-actions">
                                <label className="adv3-btn" title="Зураг шууд оруулах">
                                  <Camera size={13} /> Зураг
                                  <input
                                    type="file"
                                    accept={IMAGE_ACCEPT}
                                    hidden
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void handleDirectPhotoUpload(p, f);
                                    }}
                                  />
                                </label>
                                <button type="button" className="adv3-btn" onClick={() => openEdit(p)}>
                                  Засах
                                </button>
                                {isOrphan && (
                                  <button type="button" className="adv3-btn is-primary" onClick={() => setLinkingPerson(p)}>
                                    <Link2 size={13} /> Холбох
                                  </button>
                                )}
                                <button type="button" className="adv3-btn" onClick={() => tempArchivePerson(p)} title="Түр архивлах">
                                  <Archive size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Inline Direct Person Editor + Before/After Diff */}
                {editingPerson && (
                  <form className="adv3-editor-drawer" onSubmit={prepareDiff}>
                    <h3>{personName(editingPerson)} — Шууд засах</h3>
                    <div className="adv3-form-grid">
                      <label>Овог<input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} /></label>
                      <label>Нэр<input required value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} /></label>
                      <label>
                        Хүйс
                        <select value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                          <option value="male">Эрэгтэй</option>
                          <option value="female">Эмэгтэй</option>
                          <option value="unknown">Тодорхойгүй</option>
                        </select>
                      </label>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--gt)', marginBottom: 4 }}>
                          Төрсөн огноо (Он эсвэл Он-Сар-Өдөр)
                        </span>
                        <SmartDateInput
                          value={editForm.birth_date}
                          onChange={(val) => setEditForm({ ...editForm, birth_date: val })}
                          disabled={saving}
                        />
                      </div>
                      <label>Төрсөн газар<input value={editForm.birth_place} onChange={(e) => setEditForm({ ...editForm, birth_place: e.target.value })} /></label>
                    </div>
                    <label style={{ display: 'block', marginTop: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--gt)' }}>
                      Товч намтар
                      <textarea rows={2} value={editForm.short_description} onChange={(e) => setEditForm({ ...editForm, short_description: e.target.value })} />
                    </label>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                      <button type="submit" className="adv3-btn is-primary">Өөрчлөлтийг шалгах (Diff)</button>
                      <button type="button" className="adv3-btn" onClick={() => { setEditingPerson(null); setPendingDiff(null); }}>Хаах</button>
                    </div>

                    {pendingDiff && (
                      <div className="adv3-diff">
                        <span><strong>Өмнө / Дараа шалгалт:</strong> {pendingDiff.summary}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="adv3-btn is-primary" disabled={saving} onClick={() => void commitDiff()}>
                            <Check size={14} /> Батлаад хадгалах
                          </button>
                          <button type="button" className="adv3-btn" onClick={() => setPendingDiff(null)}>Болих</button>
                        </div>
                      </div>
                    )}
                  </form>
                )}

                {/* Inline Orphan Linker Panel */}
                {linkingPerson && (
                  <form className="adv3-editor-drawer" onSubmit={handleLinkOrphan}>
                    <h3>🔗 {personName(linkingPerson)}-ийг удмын модонд холбох</h3>
                    <div className="adv3-form-grid">
                      <label>
                        Холбооны төрөл
                        <select value={linkRelation} onChange={(e) => setLinkRelation(e.target.value as 'child_of' | 'parent_of' | 'spouse_of')}>
                          <option value="child_of">Хүүхэд нь болгож холбох</option>
                          <option value="parent_of">Эцэг / Эх нь болгож холбох</option>
                          <option value="spouse_of">Хань нь болгож холбох</option>
                        </select>
                      </label>
                      <label>
                        Модны аль хүнтэй холбох вэ?
                        <select required value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                          <option value="">Сонгох…</option>
                          {activePeople
                            .filter((x) => x.id !== linkingPerson.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>{personName(x)}</option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                      <button type="submit" className="adv3-btn is-primary" disabled={saving || !linkTargetId}>Модонд холбох</button>
                      <button type="button" className="adv3-btn" onClick={() => setLinkingPerson(null)}>Болих</button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}

          {/* TAB 3: MEMBERS & INVITATIONS */}
          {tab === 'members' && (
            <>
              <div className="adv3-head">
                <div>
                  <h1>Гишүүд &amp; Урилга</h1>
                  <p className="adv3-sub">Гэр бүлийн гишүүдийн эрх болон имэйл урилга удирдах</p>
                </div>
              </div>
              <MongolianOrnamentBand />

              <form className="adv3-card" style={{ marginBottom: 16 }} onSubmit={sendInvitation}>
                <h3>Шинэ гишүүн урих</h3>
                <div className="adv3-form-grid">
                  <label>
                    Имэйл хаяг
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="name@example.com"
                    />
                  </label>
                  <label>
                    Эрхийн түвшин
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'editor' | 'member')}>
                      <option value="editor">Засагч (Хүн нэмэх / засах)</option>
                      <option value="member">Гишүүн (Харах)</option>
                    </select>
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button type="submit" className="adv3-btn is-primary" disabled={inviteBusy || !inviteEmail.trim()}>
                    <Plus size={14} /> {inviteBusy ? 'Илгээж байна…' : 'Урилга илгээх'}
                  </button>
                </div>
              </form>

              <div className="adv3-card">
                <h3>Идэвхтэй гишүүд ({members.length})</h3>
                {members.length === 0 ? (
                  <p className="adv3-sub">Гишүүдийн мэдээлэл одоогоор хоосон байна.</p>
                ) : (
                  members.map((m) => (
                    <div className="adv3-list-item" key={m.user_id}>
                      <div>
                        <strong>{m.display_name || m.email || 'Гишүүн'}</strong>
                        <div className="adv3-sub" style={{ margin: 0 }}>{m.email || ''}</div>
                      </div>
                      <span className="adv3-tag is-ok">{m.role}</span>
                    </div>
                  ))
                )}
                {invitations.length > 0 && (
                  <>
                    <h3 style={{ marginTop: 18 }}>Хүлээгдэж буй урилгууд ({invitations.length})</h3>
                    {invitations.map((inv) => (
                      <div className="adv3-list-item" key={inv.id}>
                        <div>
                          <strong>{inv.email}</strong>
                          <div className="adv3-sub" style={{ margin: 0 }}>Хүчинтэй: {new Date(inv.expires_at).toLocaleDateString('mn-MN')}</div>
                        </div>
                        <span className="adv3-tag is-warn">{inv.role}</span>
                      </div>
                    ))}
                  </>
                )}
                <div style={{ marginTop: 14 }}>
                  <Link href={`/admin/members?family=${encodeURIComponent(familyId)}`} className="adv3-btn">
                    Дэлгэрэнгүй гишүүд &amp; модонд орох хүсэлтүүд →
                  </Link>
                </div>
              </div>
            </>
          )}

          {/* TAB 4: CONTENT */}
          {tab === 'content' && (
            <>
              <div className="adv3-head">
                <div>
                  <h1>Агуулга</h1>
                  <p className="adv3-sub">Түүх, Дурсамж, Архивын хяналт</p>
                </div>
              </div>
              <MongolianOrnamentBand />
              <div className="adv3-kpi-grid">
                <Link href={`/stories?family=${encodeURIComponent(familyId)}`} className="adv3-card" style={{ textDecoration: 'none' }}>
                  <h3>📖 Манай түүх</h3>
                  <p className="adv3-sub">Намтар, аман түүх, ярилцлага хянах →</p>
                </Link>
                <Link href={`/memories?family=${encodeURIComponent(familyId)}`} className="adv3-card" style={{ textDecoration: 'none' }}>
                  <h3>📸 Дурсамж</h3>
                  <p className="adv3-sub">Цомог ба танигдаагүй зураг хянах →</p>
                </Link>
                <Link href={`/archives?family=${encodeURIComponent(familyId)}`} className="adv3-card" style={{ textDecoration: 'none' }}>
                  <h3>🗂️ Архив</h3>
                  <p className="adv3-sub">Эх сурвалж, баримт баталгаажуулах →</p>
                </Link>
              </div>
            </>
          )}

          {/* TAB 5: PERMISSIONS & SETTINGS */}
          {tab === 'settings' && (
            <>
              <div className="adv3-head">
                <div>
                  <h1>Эрх &amp; Тохиргоо</h1>
                  <p className="adv3-sub">Эзэмшигч болон Засагчдын эрх, үндсэн гэр бүлийн тохиргоо</p>
                </div>
              </div>
              <MongolianOrnamentBand />
              <div className="adv3-two-col">
                <div className="adv3-card">
                  <h3>Эрхийн хуваарилалт</h3>
                  <div className="adv3-list-item"><strong>Эзэмшигч (Owner)</strong><span className="adv3-tag is-ok">Бүрэн эрх</span></div>
                  <div className="adv3-list-item"><strong>Засагч (Editor)</strong><span className="adv3-tag is-ok">Хүн нэмэх · Засах · Холбох · Архивлах</span></div>
                  <div className="adv3-list-item"><strong>Уншигч (Viewer)</strong><span className="adv3-tag">Зөвхөн харах</span></div>
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link href={`/admin/permissions?family=${encodeURIComponent(familyId)}`} className="adv3-btn">Нарийвчилсан эрх →</Link>
                    <Link href={`/admin/settings?family=${encodeURIComponent(familyId)}`} className="adv3-btn">Гэр бүлийн тохиргоо →</Link>
                  </div>
                </div>
                <div className="adv3-card">
                  <h3>Үндсэн орчин</h3>
                  <p className="adv3-sub">Гэр бүлийн нэр: <strong>{currentFamily?.name}</strong></p>
                  <p className="adv3-sub">Нийт хүн: <strong>{people.length}</strong></p>
                </div>
              </div>
            </>
          )}

          {/* TAB 6: TEMP ARCHIVE & TRASH */}
          {tab === 'archive' && (
            <>
              <div className="adv3-head">
                <div>
                  <h1>Түр архив &amp; Хогийн сав</h1>
                  <p className="adv3-sub">Устгалгүйгээр түр нуух эсвэл устгасан мэдээллээ сэргээх</p>
                </div>
              </div>
              <MongolianOrnamentBand />

              <div className="hush-seg" style={{ marginBottom: 14 }}>
                <button type="button" className={archiveSubTab === 'temp' ? 'is-on' : ''} onClick={() => setArchiveSubTab('temp')}>
                  📦 Түр архив ({archivedPeople.length})
                </button>
                <button type="button" className={archiveSubTab === 'trash' ? 'is-on' : ''} onClick={() => setArchiveSubTab('trash')}>
                  🗑️ Хогийн сав ({trashItems.length})
                </button>
              </div>

              <div className="adv3-card">
                {archiveSubTab === 'temp' ? (
                  archivedPeople.length === 0 ? (
                    <p className="adv3-sub">Түр архивласан хүн одоогоор алга. «Хүмүүс» хэсгээс 📦 товч дарж түр архивлаж болно.</p>
                  ) : (
                    archivedPeople.map((p) => (
                      <div className="adv3-list-item" key={p.id}>
                        <div>
                          <strong>{personName(p)}</strong>
                          <div className="adv3-sub" style={{ margin: 0 }}>Түр архивлагдсан · Устгагдаагүй</div>
                        </div>
                        <button type="button" className="adv3-btn is-primary" onClick={() => restoreTempArchive(p.id)}>
                          <RotateCcw size={14} /> Буцааж гаргах
                        </button>
                      </div>
                    ))
                  )
                ) : trashItems.length === 0 ? (
                  <p className="adv3-sub">Хогийн сав хоосон байна.</p>
                ) : (
                  trashItems.map((item) => (
                    <div className="adv3-list-item" key={item.id}>
                      <div>
                        <strong>{item.last_name} {item.first_name}</strong>
                        <div className="adv3-sub" style={{ margin: 0 }}>{new Date(item.deleted_at).toLocaleString('mn-MN')}</div>
                      </div>
                      <button type="button" className="adv3-btn is-primary" disabled={saving} onClick={() => void restoreTrashItem(item)}>
                        <RotateCcw size={14} /> Сэргээх
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 10-Second Undo Toast */}
      {toast && (
        <div className="adv3-toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const fn = toast.undo;
                setToast(null);
                if (fn) void fn();
              }}
            >
              Буцаах ({toast.secondsLeft}с)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
