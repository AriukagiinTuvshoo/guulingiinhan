'use client';

import { CSSProperties, KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Maximize, Minus, Plus, LocateFixed, Info, ImageIcon, Type, X } from 'lucide-react';
import { personName, TreeData, TreePerson } from '../lib/api';
import { focusFamilyTree, projectFamilyMap } from '../lib/family-map';
import { layoutFamilyMap, visibleMapNodes } from '../lib/family-map-layout';
import ProfilePhoto from './profile-photo';

export type FamilyMapMode = 'overview' | 'focus' | 'list';
export type FamilyMapCamera = { x: number; y: number; scale: number };
type Props = {
  data: TreeData; familyId: string; selectedId: string; mode: FamilyMapMode; zoom: number; focusDepth: number; activeGeneration: string;
  initialCamera?: FamilyMapCamera | null; onCameraChange?: (camera: FamilyMapCamera) => void;
  onModeChange: (mode: FamilyMapMode) => void; onZoomChange: (zoom: number) => void;
  onFocusDepthChange: (depth: number) => void; onGenerationChange: (generation: string) => void; onSelect: (personId: string) => void;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function initials(person: TreePerson) { return [person.last_name, person.first_name].filter(Boolean).map((value) => value.slice(0, 1)).join('').slice(0, 2).toUpperCase() || '?'; }
function lifeSummary(person: TreePerson) {
  const birth = person.birth_date?.slice(0, 4), death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  return birth ? `${birth}–${death || (person.is_alive ? '' : '?')}` : death ? `† ${death}` : '';
}
function generationText(value: number) { return value === 0 ? 'ТӨВ ҮЕ' : value < 0 ? `${Math.abs(value)} ҮЕ ӨМНӨ` : `${value} ҮЕ ДАРАА`; }

export default function FamilyMap(props: Props) {
  const { data, familyId, selectedId, mode, zoom, focusDepth, activeGeneration, onModeChange, onFocusDepthChange, onGenerationChange, onSelect } = props;
  const [compact, setCompact] = useState(false);
  const [display, setDisplay] = useState<'portrait' | 'name'>('portrait');
  const [legendOpen, setLegendOpen] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<FamilyMapCamera>(props.initialCamera ?? { x: 0, y: 0, scale: zoom });
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  const pointerRef = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; camera: FamilyMapCamera; moved: boolean; personId?: string; distance?: number; wx?: number; wy?: number } | null>(null);
  const frameRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef('');
  const lastSelection = useRef(selectedId);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; }, [props]);
  const visibleTree = useMemo(() => mode === 'focus' && selectedId ? focusFamilyTree(data, selectedId, focusDepth) : data, [data, mode, selectedId, focusDepth]);
  const projection = useMemo(() => projectFamilyMap(visibleTree), [visibleTree]);
  const layout = useMemo(() => layoutFamilyMap(visibleTree, compact), [visibleTree, compact]);
  const peopleById = useMemo(() => new Map(data.persons.map((person) => [person.id, person])), [data.persons]);
  const relationsById = useMemo(() => new Map(projectFamilyMap(data).people.map((item) => [item.person.id, item])), [data]);
  const lineageIds = useMemo(() => {
    const result = new Set<string>(selectedId ? [selectedId] : []);
    for (const direction of ['parents', 'children'] as const) {
      const queue = selectedId ? [selectedId] : [], seen = new Set(queue);
      for (let cursor = 0; cursor < queue.length; cursor++) for (const id of relationsById.get(queue[cursor])?.[direction] ?? []) {
        if (seen.has(id)) continue;
        seen.add(id); result.add(id); queue.push(id);
      }
    }
    return result;
  }, [selectedId, relationsById]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const visibleNodes = useMemo(() => visibleMapNodes(layout, view, size.width, size.height, selectedId), [layout, view, size, selectedId]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => layout.edges.filter((edge) => [...edge.from, ...edge.to].some((id) => visibleIds.has(id))), [layout.edges, visibleIds]);
  const rootId = visibleTree.linked_person_id || visibleTree.root_person_id || selectedId;
  const rootNode = nodeById.get(rootId ?? '');
  const baseGeneration = mode === 'focus' ? nodeById.get(selectedId)?.generation ?? 0 : rootNode?.generation ?? 0;
  const lod = display === 'name' ? 'name' : view.scale < 0.32 ? 'initials' : view.scale < 0.48 ? 'name' : 'portrait';

  const updateView = useCallback((next: FamilyMapCamera, save = true) => {
    viewRef.current = next;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => setView(next));
    if (settleRef.current) clearTimeout(settleRef.current);
    if (save) settleRef.current = setTimeout(() => {
      callbacks.current.onZoomChange(next.scale);
      callbacks.current.onCameraChange?.(next);
    }, 150);
  }, []);
  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    const previous = viewRef.current;
    const scale = clamp(previous.scale * factor, 0.18, 2.2), ratio = scale / previous.scale;
    updateView({ scale, x: px - (px - previous.x) * ratio, y: py - (py - previous.y) * ratio });
  }, [updateView]);
  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const scale = clamp(Math.min((size.width - 32) / layout.width, (size.height - 58) / layout.height), 0.18, 1.05);
    updateView({ scale, x: (size.width - layout.width * scale) / 2, y: Math.max(22, (size.height - layout.height * scale) / 2) });
  }, [layout, size, updateView]);
  const centerOn = useCallback((personId: string) => {
    const node = nodeById.get(personId);
    if (!node) return;
    const scale = Math.max(viewRef.current.scale, size.width < 600 ? 0.7 : 0.85);
    updateView({ scale, x: size.width / 2 - (node.x + layout.nodeWidth / 2) * scale, y: size.height * 0.42 - (node.y + layout.nodeHeight / 2) * scale });
  }, [layout, nodeById, size, updateView]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!initialized.current && entry.contentRect.width < 600) setCompact(true);
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [mode]);
  useEffect(() => {
    if (!size.width || mode === 'list') return;
    const key = `${mode}:${compact}:${mode === 'focus' ? selectedId + ':' + focusDepth : data.root_person_id}:${layout.nodes.length}:${Math.round(size.width)}:${Math.round(size.height)}`;
    if (initialized.current === key) return;
    const isFirst = !initialized.current;
    initialized.current = key;
    if (isFirst && callbacks.current.initialCamera) return;
    const fitScale = Math.min((size.width - 32) / layout.width, (size.height - 58) / layout.height);
    if (fitScale >= 0.55) fit();
    else {
      const targetId = mode === 'focus' ? selectedId : visibleTree.linked_person_id || selectedId || rootId;
      const target = nodeById.get(targetId || layout.nodes[0]?.id || '');
      if (target) {
        const scale = compact ? 0.7 : 0.65;
        const frameTop = layout.frames.find((frame) => frame.key === `component-${target.component}`)?.y ?? 0;
        const targetTop = Math.min(size.height * 0.44 - layout.nodeHeight * scale / 2, (target.y - frameTop) * scale + 28);
        updateView({ scale, x: size.width / 2 - (target.x + layout.nodeWidth / 2) * scale, y: targetTop - target.y * scale });
      }
    }
  }, [size, layout, compact, mode, selectedId, focusDepth, data.root_person_id, visibleTree.linked_person_id, fit, centerOn, rootId, nodeById, updateView]);
  useEffect(() => {
    if (!selectedId || mode === 'list' || !size.width || lastSelection.current === selectedId) return;
    lastSelection.current = selectedId;
    const node = nodeById.get(selectedId);
    if (!node) return;
    const camera = viewRef.current;
    const x = camera.x + node.x * camera.scale, y = camera.y + node.y * camera.scale;
    if (x < 0 || x > size.width - layout.nodeWidth * camera.scale || y < 0 || y > size.height - layout.nodeHeight * camera.scale) centerOn(selectedId);
  }, [selectedId, mode, layout, nodeById, size, centerOn]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * 0.008), event.clientX - rect.left, event.clientY - rect.top);
      } else updateView({ ...viewRef.current, x: viewRef.current.x - event.deltaX, y: viewRef.current.y - event.deltaY });
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [mode, updateView, zoomAt]);
  useEffect(() => () => { cancelAnimationFrame(frameRef.current); if (settleRef.current) clearTimeout(settleRef.current); }, []);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-no-pan]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerRef.current.size === 1) gesture.current = { x: event.clientX, y: event.clientY, camera: { ...viewRef.current }, moved: false, personId: (event.target as Element).closest<HTMLElement>('[data-person]')?.dataset.person };
    else if (pointerRef.current.size === 2) {
      const [a, b] = [...pointerRef.current.values()], rect = event.currentTarget.getBoundingClientRect(), camera = viewRef.current;
      gesture.current = { x: 0, y: 0, camera: { ...camera }, moved: true, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, wx: ((a.x + b.x) / 2 - rect.left - camera.x) / camera.scale, wy: ((a.y + b.y) / 2 - rect.top - camera.y) / camera.scale };
    }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointerRef.current.has(event.pointerId) || !gesture.current) return;
    pointerRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (pointerRef.current.size >= 2 && current.distance) {
      const [a, b] = [...pointerRef.current.values()], rect = event.currentTarget.getBoundingClientRect();
      const scale = clamp(current.camera.scale * Math.hypot(a.x - b.x, a.y - b.y) / current.distance, 0.18, 2.2);
      updateView({ scale, x: (a.x + b.x) / 2 - rect.left - current.wx! * scale, y: (a.y + b.y) / 2 - rect.top - current.wy! * scale });
    } else {
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) > 5) current.moved = true;
      if (current.moved) updateView({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
    }
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = gesture.current;
    pointerRef.current.delete(event.pointerId);
    if (!pointerRef.current.size) {
      if (current && !current.moved && !cancel) {
        const id = current.personId;
        if (id) {
          callbacks.current.onCameraChange?.(viewRef.current);
          onSelect(id);
        }
      }
      gesture.current = null;
    } else {
      const remaining = [...pointerRef.current.values()][0];
      gesture.current = { x: remaining.x, y: remaining.y, camera: { ...viewRef.current }, moved: true };
    }
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button,a,select')) return;
    const move: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
    if (move[event.key]) { event.preventDefault(); const [dx, dy] = move[event.key]; updateView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy }); }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoomAt(event.key === '-' ? 0.8 : 1.25, size.width / 2, size.height / 2); }
    else if (event.key === '0') { event.preventDefault(); fit(); }
  };
  const relatedNames = (ids: string[]) => ids.map((id) => peopleById.get(id)).filter((person): person is TreePerson => Boolean(person)).map(personName).join(', ');
  const listRows = activeGeneration ? projection.generations.filter((row) => row.key === activeGeneration) : projection.generations;
  const listItems = listRows.flatMap((row) => row.people).slice(0, listPage * 80);

  return <section className={`family-map family-map--${mode} family-map--${lod} ${compact ? 'is-compact' : ''}`} aria-label="Удмын модны зураглал">
    <header className="family-map__toolbar">
      <div className="family-map__modes" role="group" aria-label="Удмын модны харагдац">
        <button type="button" aria-pressed={mode === 'overview'} onClick={() => onModeChange('overview')}>Ерөнхий</button>
        <button type="button" aria-pressed={mode === 'focus'} disabled={!selectedId} onClick={() => onModeChange('focus')}>Ойрын холбоо</button>
        <button type="button" aria-pressed={mode === 'list'} onClick={() => { setListPage(1); onModeChange('list'); }}>Жагсаалт</button>
      </div>
      <div className="family-map__summary" aria-live="polite">{visibleTree.persons.length} хүн · {projection.generations.length} үеийн бүлэг{projection.components > 1 ? ` · ${projection.components - 1} бие даасан салбар` : ''}</div>
      {mode !== 'list' ? <div className="family-map__tools">
        <div className="family-map__zoom"><button type="button" aria-label="Багасгах" onClick={() => zoomAt(0.8, size.width / 2, size.height / 2)}><Minus size={17} /></button><output>{Math.round(view.scale * 100)}%</output><button type="button" aria-label="Томруулах" onClick={() => zoomAt(1.25, size.width / 2, size.height / 2)}><Plus size={17} /></button></div>
        <div className="family-map__display"><button type="button" aria-pressed={display === 'portrait'} onClick={() => setDisplay('portrait')}><ImageIcon size={15} /><span>Зураг</span></button><button type="button" aria-pressed={display === 'name'} onClick={() => setDisplay('name')}><Type size={15} /><span>Нэр</span></button></div>
        <button type="button" className="family-map__compact" aria-pressed={compact} onClick={() => setCompact(!compact)}>Товч</button>
      </div> : null}
      {mode === 'focus' ? <label className="family-map__depth">Ойрын хүрээ <select value={focusDepth} onChange={(event) => onFocusDepthChange(Number(event.target.value))}><option value={1}>1 холбоо</option><option value={2}>2 холбоо</option><option value={3}>3 холбоо</option></select></label> : null}
      <nav className="family-map__generations" aria-label="Үеэр шилжих"><button type="button" aria-pressed={!activeGeneration} onClick={() => onGenerationChange('')}>Бүх үе</button>{projection.generations.map((row) => <button type="button" key={row.key} aria-pressed={activeGeneration === row.key} onClick={() => { onGenerationChange(row.key); if (row.people[0]) centerOn(row.people[0].person.id); }}>{row.component > 0 ? `Салбар ${row.component}` : row.displayGeneration - baseGeneration > 0 ? `+${row.displayGeneration - baseGeneration}` : row.displayGeneration - baseGeneration}<small>{row.people.length}</small></button>)}</nav>
    </header>
    {mode === 'list' ? <div className="family-map-list"><ol>{listItems.map((item) => <li key={item.person.id} className={item.person.id === selectedId ? 'is-selected' : ''}><button type="button" onClick={() => onSelect(item.person.id)}><ProfilePhoto className="family-map-list__avatar" url={item.person.profile_photo_url} name={personName(item.person)} fallback={initials(item.person)} /><span><strong>{personName(item.person)}</strong><small>{lifeSummary(item.person)} · {item.component > 0 ? 'Бие даасан салбар' : generationText(item.displayGeneration - baseGeneration)}</small><em>{item.parents.length ? `Эцэг/эх: ${relatedNames(item.parents)}` : ''}{item.spouses.length ? ` · Хань: ${relatedNames(item.spouses)}` : ''}</em></span></button><Link href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(item.person.id)}&from=tree`}>Профайл →</Link></li>)}</ol>{listItems.length < listRows.reduce((total, row) => total + row.people.length, 0) ? <button className="family-map-list__more" type="button" onClick={() => setListPage(listPage + 1)}>Дараагийн хүмүүс</button> : null}</div>
      : <div className="family-map__viewport" ref={viewportRef} tabIndex={0} role="region" aria-label="Удмын мод. Чирж хөдөлгөнө, хоёр хуруугаар томруулна." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => pointerEnd(event)} onPointerCancel={(event) => pointerEnd(event, true)} onKeyDown={keyboard} onDoubleClick={(event) => { if (!(event.target as Element).closest('[data-person],[data-no-pan]')) { const rect = event.currentTarget.getBoundingClientRect(); zoomAt(1.3, event.clientX - rect.left, event.clientY - rect.top); } }}>
        <svg className="family-map__mountains" viewBox="0 0 800 300" preserveAspectRatio="none" aria-hidden="true"><path d="M0 190 110 120 190 165 300 70 400 150 520 95 640 160 720 125 800 170V300H0Z" fill="#2f7249" opacity=".12" /><path d="M0 240 90 190 200 225 330 160 450 220 570 175 700 225 800 195V300H0Z" fill="#416846" opacity=".12" /><circle cx="640" cy="64" r="26" fill="#ebd081" opacity=".045" /></svg>
        <div className="family-map__scene" data-scale={view.scale.toFixed(3)} style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, '--map-scale': view.scale } as CSSProperties}>
          {layout.frames.map((branch) => branch.detached ? <div className="family-map__branch" key={branch.key} style={{ left: branch.x, top: branch.y, width: branch.width, height: branch.height }}><span>БИЕ ДААСАН САЛБАР · {branch.count} хүн</span></div> : null)}
          {layout.generations.filter((row) => row.component === 0).map((row) => { const node = row.people[0] && nodeById.get(row.people[0].person.id); return node ? <div className="family-map__band" key={row.key} style={{ top: node.y - 24, width: layout.frames[0]?.width, height: layout.nodeHeight + 46 }}><span>{generationText(row.displayGeneration - baseGeneration)}</span></div> : null; })}
          <svg className="family-map__edges" width={layout.width} height={layout.height} aria-hidden="true">{visibleEdges.map((edge) => <g key={edge.id} data-edge-kind={edge.kind}><path d={edge.path} className={`family-map__edge family-map__edge--${edge.kind}`} />{edge.kind === 'parent' ? edge.routes?.filter((route) => lineageIds.has(route.childId) && edge.from.some((id) => lineageIds.has(id))).map((route) => <path key={route.childId} d={route.path} className="family-map__lineage" />) : <g transform={`translate(${edge.x},${edge.y})`}><circle r="9" /><text textAnchor="middle" dy="4">{edge.kind === 'married' ? '♥' : edge.kind === 'widowed' ? '◈' : '◌'}</text></g>}</g>)}</svg>
          {visibleNodes.map((node) => { const person = peopleById.get(node.id); if (!person) return null; const relations = relationsById.get(node.id); const selected = node.id === selectedId; const name = personName(person); return <button type="button" key={node.id} id={`tree-person-${node.id}`} data-person={node.id} className={`family-map-node ${selected ? 'is-selected' : ''} ${node.id === data.linked_person_id ? 'is-self' : ''} ${!person.is_alive ? 'is-deceased' : ''} ${activeGeneration && node.rowKey !== activeGeneration ? 'is-dimmed' : ''}`} style={{ left: node.x, top: node.y, width: layout.nodeWidth, height: layout.nodeHeight }} aria-pressed={selected} aria-label={`${name}${lifeSummary(person) ? `. ${lifeSummary(person)}` : ''}${relations?.parents.length ? `. Эцэг эх: ${relatedNames(relations.parents)}` : ''}${relations?.spouses.length ? `. Хань: ${relatedNames(relations.spouses)}` : ''}`} onClick={(event) => { if (event.detail === 0) onSelect(node.id); }}>
            <span className="family-map-node__portrait"><ProfilePhoto className="family-map-node__avatar" url={lod === 'portrait' ? person.profile_photo_url : null} name={name} fallback={initials(person)} />{node.id === data.linked_person_id ? <b>БИ</b> : selected ? <b>СОНГОСОН</b> : null}</span><span className="family-map-node__initials" aria-hidden="true">{initials(person)}</span><strong>{name}</strong><small>{lifeSummary(person)}</small>{mode === 'focus' && node.id !== selectedId ? <em>{relations?.parents.includes(selectedId) ? 'Хүүхэд' : relations?.children.includes(selectedId) ? 'Эцэг/эх' : relations?.spouses.includes(selectedId) ? 'Хань' : 'Ойрын хүн'}</em> : null}
          </button>; })}
        </div>
        <div className="family-map__float family-map__float--left" data-no-pan>{legendOpen ? <div className="family-map__legend"><button type="button" aria-label="Тайлбар хаах" onClick={() => setLegendOpen(false)}><X size={15} /></button><span><i className="is-parent" />Эцэг/эх · хүүхэд</span><span><i className="is-spouse" />Хань</span><span><i className="is-former" />Түүхэн гэрлэлт</span><span><i className="is-detached" />Бие даасан салбар</span></div> : null}<button type="button" aria-label="Шугамын тайлбар" aria-expanded={legendOpen} onClick={() => setLegendOpen(!legendOpen)}><Info size={19} /></button></div>
        <div className="family-map__float family-map__float--right" data-no-pan><button type="button" aria-label="Сонгосон хүн рүү" onClick={() => centerOn(selectedId || rootId || '')}><LocateFixed size={20} /></button><button type="button" aria-label="Бүгдийг харах" onClick={fit}><Maximize size={19} /></button></div>
        {visibleNodes.length === 240 ? <p className="family-map__density-note" data-no-pan>Ойртуулж бусад хүнийг хараарай</p> : null}
      </div>}
    <footer className="family-map__hint">{mode === 'list' ? 'Хүн сонгож холбоос, мэдээллийг нь үзнэ.' : 'Чирж хөдөлгөнө · хоёр хуруугаар томруулна · хүн дээр дарж дэлгэрүүлнэ'}</footer>
  </section>;
}
