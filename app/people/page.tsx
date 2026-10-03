'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  api,
  BranchSummary,
  LineageSummary,
  PersonDirectoryItem,
  PersonDirectoryPage,
  personName,
} from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import ProfilePhoto from '../../components/profile-photo';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 260;

function normalizeSearchQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function initials(person: Pick<PersonDirectoryItem, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function year(value: string | null) {
  return value ? value.slice(0, 4) : null;
}

function lifeSummary(person: PersonDirectoryItem) {
  const birth = year(person.birth_date);
  if (person.is_alive) return birth ? `${birth} · амьд` : 'Төрсөн он тодорхойгүй';
  const death = year(person.death_date);
  return [birth, death].filter(Boolean).join(' – ') || 'Амьдралын огноо тодорхойгүй';
}

function activeFilterCount(query: string, lineageId: string, branchId: string) {
  return Number(Boolean(query.trim())) + Number(Boolean(lineageId)) + Number(Boolean(branchId));
}

function PeoplePageContent() {
  const router = useRouter();
  const { families, currentFamily: family, familyId, contextError } = useAppShellContext();
  const [lineages, setLineages] = useState<LineageSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [lineageId, setLineageId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonDirectoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [error, setError] = useState('');
  const [metaBusy, setMetaBusy] = useState(false);
  const peopleRequestRef = useRef(0);
  const familyRequestRef = useRef(0);
  const metadataRequestRef = useRef(0);
  const peopleAbortRef = useRef<AbortController | null>(null);
  const familyAbortRef = useRef<AbortController | null>(null);
  const metadataAbortRef = useRef<AbortController | null>(null);

  const loadPeople = useCallback(async (
    fid: string,
    nextQuery: string,
    nextLineageId: string,
    nextBranchId: string,
    nextPage: number,
  ) => {
    if (!fid) return;
    const requestId = ++peopleRequestRef.current;
    peopleAbortRef.current?.abort();
    const controller = new AbortController();
    peopleAbortRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: String(PAGE_SIZE),
      });
      const safeQuery = normalizeSearchQuery(nextQuery);
      if (safeQuery) params.set('q', safeQuery);
      if (nextLineageId) params.set('lineage_id', nextLineageId);
      if (nextBranchId) params.set('branch_id', nextBranchId);
      const result = await api<PersonDirectoryPage>(
        `/families/${fid}/people?${params.toString()}`,
        { signal: controller.signal },
      );
      if (requestId !== peopleRequestRef.current) return;
      setPeople(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== peopleRequestRef.current) return;
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Хүмүүсийг ачаалж чадсангүй.');
    } finally {
      if (requestId === peopleRequestRef.current) {
        setLoading(false);
        setBusy(false);
      }
    }
  }, [router]);

  const loadLineages = useCallback(async (fid: string) => {
    const requestId = ++metadataRequestRef.current;
    metadataAbortRef.current?.abort();
    const controller = new AbortController();
    metadataAbortRef.current = controller;
    setMetaBusy(true);
    setMetaError('');
    try {
      const result = await api<LineageSummary[]>(`/families/${fid}/lineages`, { signal: controller.signal });
      if (requestId !== metadataRequestRef.current) return;
      setLineages(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== metadataRequestRef.current) return;
      setLineages([]);
      setMetaError(cause instanceof Error ? cause.message : 'Удам угсааны мэдээллийг ачаалж чадсангүй.');
    } finally {
      if (requestId === metadataRequestRef.current) setMetaBusy(false);
    }
  }, []);

  const loadBranches = useCallback(async (_fid: string, lid: string) => {
    const requestId = ++metadataRequestRef.current;
    metadataAbortRef.current?.abort();
    const controller = new AbortController();
    metadataAbortRef.current = controller;
    setMetaBusy(true);
    setMetaError('');
    try {
      const result = await api<BranchSummary[]>(`/lineages/${lid}/branches`, { signal: controller.signal });
      if (requestId !== metadataRequestRef.current) return;
      setBranches(result);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== metadataRequestRef.current) return;
      setBranches([]);
      setMetaError(cause instanceof Error ? cause.message : 'Салааны мэдээллийг ачаалж чадсангүй.');
    } finally {
      if (requestId === metadataRequestRef.current) setMetaBusy(false);
    }
  }, []);

  useEffect(() => {
    peopleAbortRef.current?.abort();
    metadataAbortRef.current?.abort();
    peopleRequestRef.current += 1;
    metadataRequestRef.current += 1;
    setPeople(null);
    setLineages([]);
    setBranches([]);
    setLineageId('');
    setBranchId('');
    setError('');
  }, [familyId]);

  useEffect(() => {
    metadataRequestRef.current += 1;
    setMetaError('');
    setBranches([]);
    setLineages([]);
    setLineageId('');
    setBranchId('');
    if (!familyId) {
      setMetaBusy(false);
      return;
    }
    void loadLineages(familyId);
  }, [familyId, loadLineages]);

  useEffect(() => {
    if (!familyId || !lineageId) {
      metadataRequestRef.current += 1;
      setBranches([]);
      setBranchId('');
      setMetaBusy(false);
      return;
    }
    setBranchId('');
    void loadBranches(familyId, lineageId);
  }, [familyId, lineageId, loadBranches]);

  useEffect(() => {
    if (!familyId) return;
    const timer = window.setTimeout(() => {
      void loadPeople(familyId, query, lineageId, branchId, 1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [branchId, familyId, lineageId, query, loadPeople]);

  function chooseFamily(nextFamilyId: string) {
    if (!families.some((item) => item.id === nextFamilyId) || nextFamilyId === familyId) return;
    peopleRequestRef.current += 1;
    metadataRequestRef.current += 1;
    peopleAbortRef.current?.abort();
    metadataAbortRef.current?.abort();
    setPeople(null);
    setLineages([]);
    setBranches([]);
    setLineageId('');
    setBranchId('');
    setMetaError('');
    setError('');
    router.replace('/people?family=' + encodeURIComponent(nextFamilyId));
  }

  useEffect(() => () => {
    familyAbortRef.current?.abort();
    peopleAbortRef.current?.abort();
    metadataAbortRef.current?.abort();
  }, []);

  function clearFilters() {
    setQuery('');
    setLineageId('');
    setBranchId('');
  }

  const hasFilters = activeFilterCount(query, lineageId, branchId) > 0;

  return (
    <main className="people-page">
      <section className="people-shell">
        <div className="people-heading">
          <div>
            <Link href={familyId ? `/dashboard?family=${encodeURIComponent(familyId)}` : '/dashboard'}>← Аппын нүүр</Link>
            <p className="eyebrow">ГУУЛИНГИЙНХАН · ХҮМҮҮС</p>
            <h1>Хүмүүс</h1>
            <p className="people-lede">
              Таны эрхтэй гэр бүлийн бодит хүмүүсийг нэр болон удам угсаагаар нь олоорой.
            </p>
          </div>
          <div className="people-heading-actions">
            {families.length > 1 && (
              <label className="people-control">
                <span>Гэр бүл</span>
                <select
                  value={familyId}
                  onChange={(event) => chooseFamily(event.target.value)}
                  aria-label="Гэр бүл сонгох"
                >
                  {families.map((item) => (
                    <option value={item.id} key={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            )}
            {family && (
              <Link className="button" href={`/tree?family=${family.id}`}>Ургийн мод →</Link>
            )}
          </div>
        </div>

        {contextError && <div className="error people-error" role="alert"><span>{contextError}</span><button type="button" onClick={() => window.location.reload()}>Дахин ачаалах</button></div>}
        {error && (
          <div className="error people-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() =>
                void (familyId
                  ? loadPeople(familyId, query, lineageId, branchId, 1)
                  : window.location.reload())
              }
            >
              Дахин оролдох
            </button>
          </div>
        )}
        {family && (
        <section
          className="people-toolbar card"
          aria-label="Хүмүүсийн хайлт ба шүүлтүүр"
        >
          <label className="people-search">
            <span>Хүн хайх</span>
            <input
              id="people-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Нэрээр хайх…"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              aria-label="Гэр бүлийн хүн хайх"
            />
          </label>
          <div className="people-filters">
            <label>
              <span>Удам угсаа</span>
              <select
                value={lineageId}
                onChange={(event) => setLineageId(event.target.value)}
              >
                <option value="">Бүгд</option>
                {lineages.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Салаа</span>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                disabled={!lineageId}
              >
                <option value="">
                  {lineageId ? 'Бүх салаа' : 'Удам угсаа сонгоно уу'}
                </option>
                {branches.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={clearFilters} disabled={!hasFilters}>
              Шүүлтүүр цэвэрлэх
            </button>
          </div>
        </section>
        )}

        {metaError && family && (
          <div className="error people-error" role="alert">
            <span>{metaError}</span>
            <button
              type="button"
              onClick={() =>
                void (lineageId ? loadBranches(familyId, lineageId) : loadLineages(familyId))
              }
              disabled={metaBusy}
            >
              {metaBusy ? 'Шалгаж байна…' : 'Дахин оролдох'}
            </button>
          </div>
        )}

        {loading && !people ? (
          <section className="people-state card" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Хүмүүсийг ачаалж байна…</p>
          </section>
        ) : !families.length ? (
          <section className="people-state card">
            <h2>Гэр бүл олдсонгүй.</h2>
            <p>Танд одоогоор хандах боломжтой гэр бүл алга.</p>
            <Link className="button" href="/families">Гэр бүлүүд</Link>
          </section>
        ) : people && people.items.length === 0 ? (
          <section className="people-state card">
            <div className="people-empty-avatar personavatar" aria-hidden="true">?</div>
            <h2>
              {hasFilters
                ? 'Таны хайлтад тохирох хүн олдсонгүй.'
                : 'Одоогоор бүртгэгдсэн хүн алга.'}
            </h2>
            <p>
              {hasFilters
                ? 'Хайлтын үг эсвэл шүүлтүүрийг өөрчилж дахин үзээрэй.'
                : 'Таны эрхтэй энэ гэр бүлийн орчинд одоогоор бүртгэгдсэн хүн алга.'}
            </p>
          </section>
        ) : (
          <>
            <div className="people-results-head" aria-live="polite">
              <strong>{people?.total ?? 0} хүн</strong>
              {busy && <span role="status">Шинэчилж байна…</span>}
            </div>
            <div className="people-grid" aria-busy={busy}>
              {people?.items.map((person) => (
                <Link
                  className="card people-card"
                  key={person.id}
                  href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                  aria-label={`${personName(person) || 'Нэргүй хүн'} профайлыг нээх`}
                >
                  <div className="people-card-top">
                    <ProfilePhoto className="personavatar people-avatar" url={person.profile_photo_url} name={personName(person)} fallback={initials(person)} />
                    <div className="people-card-identity">
                      <h2>{personName(person) || 'Нэргүй хүн'}</h2>
                      <span>{lifeSummary(person)}</span>
                    </div>
                  </div>

                  <div className="people-card-tags">
                    {person.lineage_name ? (
                      <span className="tag">{person.lineage_name}</span>
                    ) : (
                      <span className="tag">Хуваарилагдаагүй</span>
                    )}
                    {person.lineage_name && (
                      <span className="people-secondary-tag">
                        {person.branch_name ?? 'Салаа хуваарилагдаагүй'}
                      </span>
                    )}
                  </div>

                  {person.short_description && (
                    <p className="people-description">{person.short_description}</p>
                  )}

                  <span className="button people-profile-link" aria-hidden="true">Профайл нээх →</span>
                </Link>
              ))}
            </div>

            <div className="people-pagination">
              <span>Хуудас {people?.page ?? 1}</span>
              {people?.has_next && (
                <button
                  type="button"
                  onClick={() =>
                    void loadPeople(
                      familyId,
                      query,
                      lineageId,
                      branchId,
                      (people?.page ?? 1) + 1,
                    )
                  }
                  disabled={busy}
                >
                  Дараагийн хүмүүс →
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}


export default function PeoplePage() {
  return (
    <Suspense
      fallback={
        <main className="people-page">
          <section className="people-shell people-state card" aria-live="polite">
            <span className="people-spinner" aria-hidden="true" />
            <p>Хүмүүсийг ачаалж байна…</p>
          </section>
        </main>
      }
    >
      <PeoplePageContent />
    </Suspense>
  );
}
