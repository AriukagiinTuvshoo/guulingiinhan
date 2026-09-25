'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  api,
  BranchSummary,
  Family,
  LineageSummary,
  PersonDirectoryItem,
  PersonDirectoryPage,
  personName,
} from '../../lib/api';

const PAGE_SIZE = 24;

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

export default function PeoplePage() {
  const router = useRouter();
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
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

  const loadPeople = useCallback(async (
    fid: string,
    nextQuery: string,
    nextLineageId: string,
    nextBranchId: string,
    nextPage: number,
  ) => {
    if (!fid) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: String(PAGE_SIZE),
      });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      if (nextLineageId) params.set('lineage_id', nextLineageId);
      if (nextBranchId) params.set('branch_id', nextBranchId);
      const result = await api<PersonDirectoryPage>(
        `/families/${fid}/people?${params.toString()}`,
      );
      setPeople(result);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Хүмүүсийг ачаалж чадсангүй.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    const requestedFamily = new URLSearchParams(window.location.search).get('family') ?? '';
    api<Family[]>('/families')
      .then((list) => {
        setFamilies(list);
        if (!list.length) {
          setLoading(false);
          return;
        }
        const selected = list.find((item) => item.id === requestedFamily) ?? list[0];
        setFamilyId(selected.id);
        if (selected.id !== requestedFamily) {
          router.replace('/people?family=' + encodeURIComponent(selected.id));
        }
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
      });
  }, [router]);

  useEffect(() => {
    if (!familyId) return;
    setMetaError('');
    setLineages([]);
    setBranches([]);
    setLineageId('');
    setBranchId('');
    api<LineageSummary[]>(`/families/${familyId}/lineages`)
      .then(setLineages)
      .catch((cause) => {
        setMetaError(
          cause instanceof Error
            ? cause.message
            : 'Удам угсааны мэдээллийг ачаалж чадсангүй.',
        );
      });
  }, [familyId]);

  useEffect(() => {
    if (!familyId || !lineageId) {
      setBranches([]);
      return;
    }
    setBranchId('');
    api<BranchSummary[]>(`/lineages/${lineageId}/branches`)
      .then(setBranches)
      .catch((cause) => {
        setBranches([]);
        setMetaError(
          cause instanceof Error
            ? cause.message
            : 'Салааны мэдээллийг ачаалж чадсангүй.',
        );
      });
  }, [familyId, lineageId]);

  useEffect(() => {
    if (!familyId) return;
    const timer = window.setTimeout(() => {
      void loadPeople(familyId, query, lineageId, branchId, 1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [branchId, familyId, lineageId, query, loadPeople]);

  function chooseFamily(nextFamilyId: string) {
    setFamilyId(nextFamilyId);
    setLineages([]);
    setBranches([]);
    setLineageId('');
    setBranchId('');
    setPeople(null);
    router.replace('/people?family=' + encodeURIComponent(nextFamilyId));
  }

  function clearFilters() {
    setQuery('');
    setLineageId('');
    setBranchId('');
  }

  const family = families.find((item) => item.id === familyId) ?? null;
  const hasFilters = activeFilterCount(query, lineageId, branchId) > 0;

  return (
    <main className="people-page">
      <section className="people-shell">
        <div className="people-heading">
          <div>
            <Link href="/dashboard">← Аппын нүүр</Link>
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

        {error && (
          <div className="error people-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadPeople(familyId, query, lineageId, branchId, 1)}
            >
              Дахин оролдох
            </button>
          </div>
        )}
        {metaError && (
          <div className="error people-error" role="alert">
            <span>{metaError}</span>
          </div>
        )}

        <section
          className="people-toolbar card"
          aria-label="Хүмүүсийн хайлт ба шүүлтүүр"
        >
          <label className="people-search">
            <span>Хүн хайх</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Нэрээр хайх…"
              autoComplete="off"
              spellCheck={false}
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
                : 'Одоогоор харагдах хүн алга.'}
            </h2>
            <p>
              {hasFilters
                ? 'Хайлтын үг эсвэл шүүлтүүрийг өөрчилж дахин үзээрэй.'
                : 'Энэ гэр бүлийн нууцлалын тохиргоонд нийцэх хүн одоогоор бүртгэлгүй байна.'}
            </p>
          </section>
        ) : (
          <>
            <div className="people-results-head">
              <strong>{people?.total ?? 0} хүн</strong>
              {busy && <span role="status">Шинэчилж байна…</span>}
            </div>
            <div className="people-grid" aria-busy={busy}>
              {people?.items.map((person) => (
                <article className="card people-card" key={person.id}>
                  <div className="people-card-top">
                    <span className="personavatar people-avatar" aria-hidden="true">
                      {initials(person)}
                    </span>
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

                  <Link
                    className="button people-profile-link"
                    href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
                  >
                    Профайл нээх →
                  </Link>
                </article>
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
