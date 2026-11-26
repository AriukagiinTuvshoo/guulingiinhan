'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, PersonSearchPage, api } from '../../../lib/api';

type Family = { id: string; name: string; role: string };
type ClanLink = {
  linked: boolean;
  clan_family_id: string | null;
  clan_family_name: string | null;
  household_person_id: string | null;
  household_person_name: string | null;
  clan_anchor_person_id: string | null;
  clan_anchor_person_name: string | null;
  relation: string | null;
  created_at: string | null;
};
type Households = { items: { household_family_id: string; household_family_name: string }[]; total: number };

const relations: { value: string; label: string }[] = [
  { value: 'child_of', label: 'Өрхийн хүн их үеийн хүний хүүхэд' },
  { value: 'parent_of', label: 'Өрхийн хүн их үеийн хүний эцэг/эх' },
  { value: 'spouse_of', label: 'Хоёр хүн гэрлэсэн' },
];

function message(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return 'Энэ үйлдлийг хийх эрхгүй байна.';
    if (cause.status === 404) return 'Гэр бүл эсвэл хүн олдсонгүй.';
    if (cause.status === 409) return 'Холбоос зөрчилтэй (тойрог эсвэл давхардсан).';
    if (cause.status >= 500) return 'Серверийн алдаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return 'Үйлдлийг гүйцэтгэж чадсангүй.';
}

function PersonPicker({ familyId, label, value, onChange }: {
  familyId: string; label: string; value: { id: string; name: string } | null;
  onChange: (next: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const sequence = useRef(0);

  async function search() {
    if (!familyId || !query.trim()) return;
    const current = ++sequence.current;
    setState('loading');
    try {
      const page = await api<PersonSearchPage>(
        `/families/${encodeURIComponent(familyId)}/persons/search?q=${encodeURIComponent(query.trim())}&page=1&page_size=8`,
      );
      if (current !== sequence.current) return;
      setResults(page.items.map((item) => ({ id: item.id, name: item.name })));
      setState(page.items.length ? 'idle' : 'empty');
    } catch {
      if (current !== sequence.current) return;
      setResults([]); setState('error');
    }
  }

  return <div className="card">
    <strong>{label}</strong>
    {value && <p>Сонгосон: {value.name} <button type="button" onClick={() => onChange(null)}>Цэвэрлэх</button></p>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <input aria-label={`${label}-ийг хайх`} placeholder="Нэрээр хайх" value={query}
        onChange={(event) => setQuery(event.target.value)} maxLength={100}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} />
      <button type="button" disabled={state === 'loading' || !query.trim()} onClick={() => void search()}>
        {state === 'loading' ? 'Хайж байна…' : 'Хайх'}
      </button>
    </div>
    {state === 'empty' && <p role="status">Танд харах эрхтэй хүн олдсонгүй.</p>}
    {state === 'error' && <p role="alert">Хайлтын үр дүнгийг авах боломжгүй байна.</p>}
    {results.length > 0 && <ul>{results.map((person) => <li key={person.id}>
      <button type="button" aria-pressed={value?.id === person.id} onClick={() => onChange(person)}>{person.name}</button>
    </li>)}</ul>}
  </div>;
}

function ClanLinkContent() {
  const searchParams = useSearchParams();
  const explicit = searchParams.get('family')?.trim() ?? '';
  const [families, setFamilies] = useState<Family[]>([]);
  const [household, setHousehold] = useState('');
  const [clan, setClan] = useState('');
  const [relation, setRelation] = useState('child_of');
  const [householdPerson, setHouseholdPerson] = useState<{ id: string; name: string } | null>(null);
  const [clanAnchor, setClanAnchor] = useState<{ id: string; name: string } | null>(null);
  const [link, setLink] = useState<ClanLink | null>(null);
  const [attached, setAttached] = useState<Households | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'remove'>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (familyId: string) => {
    if (!familyId) return;
    try {
      const [status, households] = await Promise.all([
        api<ClanLink>(`/families/${encodeURIComponent(familyId)}/clan-link`),
        api<Households>(`/families/${encodeURIComponent(familyId)}/clan-households`),
      ]);
      if (!mounted.current) return;
      setLink(status); setAttached(households); setError('');
    } catch (cause) {
      if (!mounted.current) return;
      setLink(null); setAttached(null); setError(message(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    api<Family[]>('/families').then((rows) => {
      if (!active) return;
      setFamilies(rows);
      const initial = rows.some((row) => row.id === explicit) ? explicit : rows[0]?.id ?? '';
      setHousehold(initial);
      setLoading(false);
      if (initial) void load(initial);
    }).catch(() => { if (active) { setLoading(false); setError('Гэр бүлүүдийг ачаалж чадсангүй.'); } });
    return () => { active = false; };
  }, [explicit, load]);

  const clanOptions = families.filter((family) => family.id !== household);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!household || !clan || !householdPerson || !clanAnchor) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      await api(`/families/${encodeURIComponent(household)}/clan-link`, {
        method: 'PUT',
        body: JSON.stringify({
          clan_family_id: clan, household_person_id: householdPerson.id,
          clan_anchor_person_id: clanAnchor.id, relation,
        }),
      });
      setNotice('Холбоос хадгалагдлаа. Модны бүтэц, харагдах байралд өөрчлөлт ороогүй.');
      await load(household);
    } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }

  async function remove() {
    if (!household) return;
    setBusy('remove'); setError(''); setNotice('');
    try {
      await api(`/families/${encodeURIComponent(household)}/clan-link`, { method: 'DELETE' });
      setNotice('Холбоосыг тасаллаа.');
      await load(household);
    } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }

  const householdFamily = families.find((family) => family.id === household);

  return <main className="mvp">
    <section className="mvpbox">
      <div className="row space">
        <div>
          <Link href={household ? `/families?family=${encodeURIComponent(household)}` : '/families'}>← Гэр бүлүүд</Link>
          <h1 style={{ marginTop: 22 }}>Их үетэй холбох</h1>
          <p>Өөрийн өрхийн нарийвчлалтай модыг их үеийн модонд залгана. Энэ нь зөвхөн холбоос нэмнэ — хүн, гэрлэлт, харагдах байрлалыг шилжүүлэхгүй.</p>
        </div>
      </div>

      {loading ? <p role="status">Ачаалж байна…</p> : families.length < 2 ? <div className="card">
        <h2>Хоёр гэр бүл хэрэгтэй</h2>
        <p>Өрх болон их үеийн гэр бүл — хоёр танд гишүүнээр байх ёстой.</p>
        <Link className="button" href="/onboarding">Гэр бүл үүсгэх</Link>
      </div> : <div className="row" style={{ alignItems: 'flex-start', gap: 20, marginTop: 20 }}>
        <div style={{ flex: '1 1 420px' }}>
          {notice && <div className="success" role="status" aria-live="polite">{notice}</div>}
          {error && <div className="error" role="alert"><p>{error}</p><button type="button" onClick={() => void load(household)}>Дахин оролдох</button></div>}

          <form onSubmit={(event) => void save(event)} className="card" style={{ marginTop: 12 }}>
            <label>Миний өрх
              <select value={household} onChange={(event) => {
                setHousehold(event.target.value); setHouseholdPerson(null); setClanAnchor(null); setNotice('');
              }}>
                {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
              </select>
            </label>
            <label>Их үе (зөвхөн таны гишүүн гэр бүлүүд)
              <select value={clan} onChange={(event) => setClan(event.target.value)} required>
                <option value="">Сонгоно уу</option>
                {clanOptions.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
              </select>
            </label>
            <label>Хамаарал
              <select value={relation} onChange={(event) => setRelation(event.target.value)}>
                {relations.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <PersonPicker familyId={household} label="Өрхийн хүн" value={householdPerson} onChange={setHouseholdPerson} />
            <PersonPicker familyId={clan} label="Их үеийн хүн" value={clanAnchor} onChange={setClanAnchor} />
            <button className="primary" type="submit" disabled={Boolean(busy) || !clan || !householdPerson || !clanAnchor}>
              {busy === 'save' ? 'Хадгалж байна…' : 'Холбоос хадгалах'}
            </button>
          </form>

          {link?.linked && <div className="card" style={{ marginTop: 12 }}>
            <h2>Одоогийн холбоос</h2>
            <p>{link.clan_family_name ? `Их үе: ${link.clan_family_name}` : 'Их үе: таны харах эрхгүй гэр бүл'}</p>
            {link.household_person_name && <p>Өрхийн тал: {link.household_person_name}</p>}
            {link.clan_anchor_person_name && <p>Их үеийн тал: {link.clan_anchor_person_name}</p>}
            {link.relation && <p>Хамаарал: {relations.find((item) => item.value === link.relation)?.label ?? link.relation}</p>}
            <button type="button" disabled={Boolean(busy)} onClick={() => void remove()}>
              {busy === 'remove' ? 'Тасалж байна…' : 'Холбоос таслах'}
            </button>
          </div>}
        </div>

        <aside style={{ flex: '1 1 260px' }} aria-label="Холбогдсон өрхүүд">
          <div className="card">
            <h2>{householdFamily?.name ?? 'Гэр бүл'}-д холбогдсон өрхүүд</h2>
            {!attached || attached.total === 0 ? <p>Одоогоор холбогдсон өрх алга.</p> :
              <ul>{attached.items.map((row) => <li key={row.household_family_id}>{row.household_family_name}</li>)}</ul>}
          </div>
        </aside>
      </div>}
    </section>
  </main>;
}

export default function ClanLinkPage() {
  return <Suspense fallback={<main className="mvp"><p role="status">Ачаалж байна…</p></main>}>
    <ClanLinkContent />
  </Suspense>;
}
