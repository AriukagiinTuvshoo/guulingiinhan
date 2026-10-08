'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { personName, TreeData, TreePerson } from '../lib/api';
import { focusFamilyTree, projectFamilyMap } from '../lib/family-map';
import ProfilePhoto from './profile-photo';

export type FamilyMapMode = 'overview' | 'focus' | 'list';

type Props = {
  data: TreeData;
  familyId: string;
  selectedId: string;
  mode: FamilyMapMode;
  zoom: number;
  focusDepth: number;
  activeGeneration: string;
  onModeChange: (mode: FamilyMapMode) => void;
  onZoomChange: (zoom: number) => void;
  onFocusDepthChange: (depth: number) => void;
  onGenerationChange: (generation: string) => void;
  onSelect: (personId: string) => void;
};

function initials(person: TreePerson) {
  return [person.last_name, person.first_name].filter(Boolean).map((value) => value.slice(0, 1)).join('').slice(0, 2).toUpperCase() || '?';
}

function lifeSummary(person: TreePerson) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth}–${death}`;
  if (birth) return person.is_alive ? `${birth}–одоо` : `${birth}–?`;
  return '';
}

function generationText(generation: number | null, displayGeneration: number, component: number) {
  if (component > 0) return displayGeneration === 0 ? 'Салбарын эхлэл' : `${displayGeneration + 1}-р түвшин`;
  if (generation === null) return displayGeneration === 0 ? 'Төв хүрээ' : `${displayGeneration + 1}-р түвшин`;
  if (generation === 0) return 'Төв үе';
  return generation < 0 ? `${Math.abs(generation)} үеийн өмнө` : `${generation} үеийн үргэлжлэл`;
}

function lodForZoom(zoom: number) {
  if (zoom < 0.5) return 'initials';
  if (zoom < 0.75) return 'name';
  if (zoom < 1) return 'dates';
  return 'portrait';
}

export default function FamilyMap({ data, familyId, selectedId, mode, zoom, focusDepth, activeGeneration, onModeChange, onZoomChange, onFocusDepthChange, onGenerationChange, onSelect }: Props) {
  const visibleTree = useMemo(
    () => mode === 'focus' && selectedId ? focusFamilyTree(data, selectedId, focusDepth) : data,
    [data, focusDepth, mode, selectedId],
  );
  const projection = useMemo(() => projectFamilyMap(visibleTree), [visibleTree]);
  const personById = useMemo(() => new Map(data.persons.map((person) => [person.id, person])), [data.persons]);
  const marriageStatusByPerson = useMemo(() => {
    const statuses = new Map<string, Array<TreeData['marriages'][number]['status']>>();
    for (const marriage of visibleTree.marriages) {
      const first = statuses.get(marriage.person_1_id) ?? [];
      first.push(marriage.status);
      statuses.set(marriage.person_1_id, first);
      const second = statuses.get(marriage.person_2_id) ?? [];
      second.push(marriage.status);
      statuses.set(marriage.person_2_id, second);
    }
    return statuses;
  }, [visibleTree.marriages]);
  const lod = lodForZoom(zoom);
  const generationRows = activeGeneration
    ? projection.generations.filter((row) => row.key === activeGeneration)
    : projection.generations;
  const renderLimit = mode === 'focus' ? 180 : 160;
  let rendered = 0;

  const select = (personId: string) => {
    onSelect(personId);
    if (mode === 'overview') onModeChange('focus');
  };

  return (
    <section className={`family-map family-map--${mode} family-map--${lod}`} aria-label="Удмын модны зураглал">
      <header className="family-map__toolbar">
        <div className="family-map__modes" role="group" aria-label="Удмын модны харагдац">
          <button type="button" aria-pressed={mode === 'overview'} onClick={() => onModeChange('overview')}>Ерөнхий</button>
          <button type="button" aria-pressed={mode === 'focus'} onClick={() => onModeChange('focus')} disabled={!selectedId}>Ойрын холбоо</button>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => onModeChange('list')}>Жагсаалт</button>
        </div>
        <div className="family-map__summary" aria-live="polite">
          <strong>{visibleTree.persons.length}</strong> хүн · <strong>{projection.generations.length}</strong> үеийн бүлэг
          {projection.components > 1 ? <> · <strong>{projection.components - 1}</strong> бие даасан салбар</> : null}
        </div>
        {mode !== 'list' && (
          <div className="family-map__zoom" aria-label="Мэдээллийн дэлгэрэнгүй байдал">
            <button type="button" onClick={() => onZoomChange(Math.max(0.35, Number((zoom - 0.15).toFixed(2))))} aria-label="Мэдээллийг товчлох">−</button>
            <span>{lod === 'initials' ? 'Үсэг' : lod === 'name' ? 'Нэр' : lod === 'dates' ? 'Огноо' : 'Зураг'}</span>
            <button type="button" onClick={() => onZoomChange(Math.min(1.15, Number((zoom + 0.15).toFixed(2))))} aria-label="Мэдээллийг дэлгэрүүлэх">+</button>
            <button type="button" onClick={() => onZoomChange(0.65)}>Товч</button>
          </div>
        )}
        {mode === 'focus' && (
          <label className="family-map__depth">Ойрын хүрээ
            <select value={focusDepth} onChange={(event) => onFocusDepthChange(Number(event.target.value))}>
              <option value={1}>1 холбоо</option><option value={2}>2 холбоо</option><option value={3}>3 холбоо</option>
            </select>
          </label>
        )}
      </header>

      <nav className="family-map__generations" aria-label="Үеэр шилжих">
        <button type="button" aria-pressed={!activeGeneration} onClick={() => onGenerationChange('')}>Бүх үе</button>
        {projection.generations.slice(0, 12).map((row) => (
          <button key={row.key} type="button" aria-pressed={activeGeneration === row.key} onClick={() => onGenerationChange(row.key)}>
            {row.generation === null ? row.displayGeneration + 1 : row.generation > 0 ? `+${row.generation}` : row.generation} <span>{row.people.length}</span>
          </button>
        ))}
      </nav>
      <div className="family-map__legend" aria-label="Холбоосын тайлбар">
        <span><b>│</b> Эцэг/эх · хүүхэд</span><span><b>♡</b> Хань</span><span><b>◌</b> Түүхэн гэрлэлт</span><span><b>┄</b> Бие даасан салбар</span>
      </div>

      {mode === 'list' ? (
        <div className="family-map-list">
          {generationRows.map((row) => {
            const available = Math.max(0, renderLimit - rendered);
            const people = row.people.slice(0, available);
            rendered += people.length;
            if (!people.length) return null;
            return <section key={row.key} aria-labelledby={`family-map-row-${row.key}`}>
              <h3 id={`family-map-row-${row.key}`}>
                {row.component > 0 ? 'Бие даасан салбар · ' : ''}{generationText(row.generation, row.displayGeneration, row.component)}
              </h3>
              <ul>
                {people.map(({ person, spouses }) => (
                  <li key={person.id} className={person.id === selectedId ? 'is-selected' : ''}>
                    <button type="button" onClick={() => select(person.id)}>
                      <span>{initials(person)}</span><strong>{personName(person)}</strong><small>{lifeSummary(person) || 'Огноо тодорхойгүй'}</small>
                      {spouses.length ? <em>♡ {spouses.map((id) => personById.get(id)).filter(Boolean).map((item) => personName(item!)).join(' · ')}</em> : null}
                    </button>
                    <Link href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}&from=tree`}>Профайл</Link>
                  </li>
                ))}
              </ul>
            </section>;
          })}
          {projection.people.length > rendered ? <p className="family-map-list__limit">Эхний {rendered} хүнийг харуулж байна. Үеийн шүүлт эсвэл дээрх нэрийн хайлтаар бусад хүнийг шууд олно уу.</p> : null}
        </div>
      ) : (
        <div className="family-map__viewport" tabIndex={0} aria-label="Үе, салбараар ангилсан удмын зураглал">
          {generationRows.map((row) => {
            const available = Math.max(0, renderLimit - rendered);
            const people = row.people.slice(0, available);
            rendered += people.length;
            if (!people.length) return null;
            return (
              <section className={`family-map__row ${row.component > 0 ? 'is-detached' : ''}`} key={row.key} aria-labelledby={`family-map-row-${row.key}`}>
                <div className="family-map__row-heading">
                  <span>{row.component > 0 ? 'БИЕ ДААСАН САЛБАР' : 'ҮЕ'}</span>
                  <h3 id={`family-map-row-${row.key}`}>{generationText(row.generation, row.displayGeneration, row.component)}</h3>
                  <small>{row.people.length} хүн</small>
                </div>
                <div className="family-map__people">
                  {people.map(({ person, spouses }) => {
                    const name = personName(person) || 'Нэргүй хүн';
                    const marriageStatuses = marriageStatusByPerson.get(person.id) ?? [];
                    const hasCurrentMarriage = marriageStatuses.includes('married');
                    const hasHistoricalMarriage = marriageStatuses.some((status) => status !== 'married');
                    const marriageLabel = [hasCurrentMarriage ? 'Идэвхтэй гэрлэлт' : '', hasHistoricalMarriage ? 'Түүхэн гэрлэлт' : ''].filter(Boolean).join(', ');
                    return (
                      <button
                        type="button"
                        key={person.id}
                        id={`tree-person-${person.id}`}
                        className={`family-map-node ${person.id === selectedId ? 'is-selected' : ''}`}
                        aria-pressed={person.id === selectedId}
                        aria-label={`${name}. ${lifeSummary(person) || 'Огноо тодорхойгүй'}${marriageLabel ? `. ${marriageLabel}` : ''}`}
                        onClick={() => select(person.id)}
                      >
                        <ProfilePhoto className="family-map-node__avatar" url={person.profile_photo_url} name={name} fallback={initials(person)} />
                        <span className="family-map-node__initials" aria-hidden="true">{initials(person)}</span>
                        <strong>{name}</strong>
                        <small>{lifeSummary(person)}</small>
                        {spouses.length ? <em title={marriageLabel}>{hasCurrentMarriage ? '♡' : '◌'} {spouses.length}</em> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {projection.people.length > rendered ? (
            <p className="family-map__limit">Энэ харагдац эхний {rendered} хүнийг үзүүлэв. Үе сонгох эсвэл хайлт ашиглан бусад хүнийг төвлөрүүлнэ үү.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
