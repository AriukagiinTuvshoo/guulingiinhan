'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Compass,
  FileBadge,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Scan,
} from 'lucide-react';
import { API_BASE, personName, TreePerson } from '../lib/api';
import { AdvancedTreeLayout } from '../lib/tree-layout';
import '../app/golden-tree.css';

interface GoldenHeritageTreeProps {
  layout: AdvancedTreeLayout;
  selectedId: string;
  onSelect: (personId: string) => void;
  onToggleCollapse?: (unitId: string, focalPersonId: string, isFrontier: boolean) => void;
  loadingUnitId?: string | null;
  bloodlineMode: string;
  activeBloodlineIds: Set<string>;
  timeTravelOpen: boolean;
  timeYear: number;
  currentYear: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onSwitchToClassic: () => void;
  onOpenKinship: () => void;
  onOpenCertificate: () => void;
  onOpenBook: () => void;
  onOpenExport: () => void;
}

function initials(person: Pick<TreePerson, 'first_name' | 'last_name'>) {
  return (
    [person.last_name, person.first_name]
      .filter(Boolean)
      .map((value) => value.slice(0, 1))
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

function yearsText(person: TreePerson) {
  const b = person.birth_date?.slice(0, 4);
  const d = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (b && d) return `${b} – ${d}`;
  if (b) return person.is_alive ? `${b} – одоо` : `${b} – ?`;
  return person.is_alive ? 'Энх тунх' : 'Дурсгалд';
}

export default function GoldenHeritageTree({
  layout,
  selectedId,
  onSelect,
  onToggleCollapse,
  loadingUnitId,
  bloodlineMode,
  activeBloodlineIds,
  timeTravelOpen,
  timeYear,
  currentYear,
  isFullscreen,
  onToggleFullscreen,
  onSwitchToClassic,
  onOpenKinship,
  onOpenCertificate,
  onOpenBook,
  onOpenExport,
}: GoldenHeritageTreeProps) {
  const [zoom, setZoom] = useState(0.88);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const anchorRef = useRef<{ personId: string; prevX: number; prevY: number } | null>(null);

  // Preserve the clicked node's exact screen position after collapse/expand relayout.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const nextNode = layout.nodeById.get(anchor.personId);
    anchorRef.current = null;
    if (!nextNode) return;
    const dx = (nextNode.x - anchor.prevX) * zoom;
    const dy = (nextNode.y - anchor.prevY) * zoom;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollLeft = Math.max(0, scroller.scrollLeft + dx);
        scroller.scrollTop = Math.max(0, scroller.scrollTop + dy);
      } else {
        setPan((prev) => ({ x: Math.round(prev.x - dx), y: Math.round(prev.y - dy) }));
      }
    }
  }, [layout, zoom]);

  const handleFitToScreen = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || layout.width <= 0 || layout.height <= 0) return;
    const vw = Math.max(320, scroller.clientWidth - 48);
    const vh = Math.max(320, scroller.clientHeight - 104);
    const fitZoom = Math.max(0.22, Math.min(1.1, Math.min(vw / layout.width, vh / layout.height)));
    const roundedZoom = Number(fitZoom.toFixed(2));
    setZoom(roundedZoom);
    setPan({ x: 0, y: 0 });
    scroller.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  }, [layout.height, layout.width]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPan({
      x: Math.round(panStart.current.x + (e.clientX - dragStart.current.x)),
      y: Math.round(panStart.current.y + (e.clientY - dragStart.current.y)),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div className={`golden-tree-viewport${isFullscreen ? ' is-fullscreen' : ''}`}>
      <div
        ref={scrollRef}
        className={`golden-tree-scroll${dragging ? ' is-dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label="Алтан удмын модны интерактив талбар"
      >
        <div
          style={{
            width: Math.max(layout.width * zoom + 120, 760),
            height: Math.max(layout.height * zoom + 140, 560),
            position: 'relative',
          }}
        >
          <div
            className="golden-tree-stage"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: dragging ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Root-anchored Generation Labels (1-р үе … 9-р үе, or ? when root not loaded) */}
            {layout.generationHeaders.map((header) => (
              <div
                key={`gen-${header.generation}`}
                className="golden-gen-badge"
                style={{ top: header.y + 6 }}
                aria-label={`${header.label} (${header.count} хүн)`}
              >
                <span>{header.label}</span>
                <small>({header.count})</small>
              </div>
            ))}

            {/* Calligraphic Burnished-Gold Curved Bezier Connectors */}
            <svg
              className="golden-tree-svg"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="guulin-gold-stroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--gold-300)" />
                  <stop offset="55%" stopColor="var(--gold-500)" />
                  <stop offset="100%" stopColor="var(--gold-700)" />
                </linearGradient>
              </defs>

              {/* Marriage bridges inside couple units */}
              {layout.unions.map((u) => {
                const n1 = layout.nodeById.get(u.person1Id);
                const n2 = layout.nodeById.get(u.person2Id);
                if (!n1 || !n2) return null;
                const left = n1.x <= n2.x ? n1 : n2;
                const right = n1.x <= n2.x ? n2 : n1;
                const x1 = left.x + left.width;
                const x2 = right.x;
                return (
                  <g key={u.id}>
                    <line
                      x1={x1}
                      y1={u.y}
                      x2={x2}
                      y2={u.y}
                      className={`golden-marriage-line${u.status === 'divorced' ? ' is-divorced' : ''}`}
                    />
                    <circle
                      cx={u.x}
                      cy={u.y}
                      r={3.5}
                      className="golden-union-knot"
                    />
                  </g>
                );
              })}

              {/* Smooth S-curve Bezier parent -> child branches */}
              {layout.buses.map((bus) => {
                const parentActive =
                  bloodlineMode !== 'none' && bus.parents.some((pid) => activeBloodlineIds.has(pid));
                return bus.children.map((child) => {
                  const childActive = bloodlineMode !== 'none' && activeBloodlineIds.has(child.id);
                  const isActive = parentActive && childActive;
                  const isDimmed = bloodlineMode !== 'none' && !isActive;
                  const midY = Math.round((bus.sourceY + child.y) / 2);
                  const d = `M ${bus.sourceX} ${bus.sourceY} C ${bus.sourceX} ${midY}, ${child.x} ${midY}, ${child.x} ${child.y}`;
                  return (
                    <path
                      key={`${bus.id}-${child.id}`}
                      d={d}
                      className={`golden-bezier-path${isActive ? ' is-active' : isDimmed ? ' is-dimmed' : ''}`}
                    />
                  );
                });
              })}

              {/* Non-tree secondary lineage parent dashed edges */}
              {layout.secondaryEdges.map((edge) => {
                const midY = Math.round((edge.y1 + edge.y2) / 2);
                const d = `M ${edge.x1} ${edge.y1} C ${edge.x1} ${midY}, ${edge.x2} ${midY}, ${edge.x2} ${edge.y2}`;
                return (
                  <path
                    key={edge.id}
                    d={d}
                    className="golden-bezier-path is-secondary"
                  />
                );
              })}
            </svg>

            {/* Compact Obsidian Portrait Cards (Photo, Name, Years only) */}
            {layout.nodes.map((node) => {
              const person = node.person;
              const selected = person.id === selectedId;
              const isHighlighted = bloodlineMode !== 'none' && activeBloodlineIds.has(person.id);
              const isDimmed = bloodlineMode !== 'none' && !isHighlighted;

              let timeClass = '';
              let ageAtYear: number | null = null;
              if (timeTravelOpen) {
                const bYear = person.birth_date ? Number.parseInt(person.birth_date.slice(0, 4), 10) : Number.NaN;
                const dYear = person.death_date ? Number.parseInt(person.death_date.slice(0, 4), 10) : Number.NaN;
                if (!Number.isNaN(bYear)) {
                  if (timeYear < bYear) timeClass = ' is-time-unborn';
                  else if (!person.is_alive && !Number.isNaN(dYear) && timeYear > dYear) timeClass = ' is-time-passed';
                  else {
                    timeClass = ' is-time-alive';
                    ageAtYear = timeYear - bYear;
                  }
                } else if (person.is_alive && timeYear >= currentYear - 35) {
                  timeClass = ' is-time-alive';
                } else {
                  timeClass = ' is-time-unborn';
                }
              }

              return (
                <article
                  key={person.id}
                  id={`tree-person-${person.id}`}
                  className={`golden-node-card${selected ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}${timeClass}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                  }}
                >
                  {timeTravelOpen && ageAtYear !== null && (
                    <span className="tree-time-age-pill">{ageAtYear} нас</span>
                  )}
                  <button
                    type="button"
                    className="golden-node-btn"
                    aria-pressed={selected}
                    aria-label={`${personName(person)} хүнийг сонгох`}
                    onClick={() => onSelect(person.id)}
                  >
                    <span className="golden-node-avatar" aria-hidden="true">
                      {person.profile_photo_url ? (
                        <img
                          src={
                            person.profile_photo_url.startsWith('/')
                              ? `${API_BASE}${person.profile_photo_url}`
                              : person.profile_photo_url
                          }
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        initials(person)
                      )}
                    </span>
                    <strong className="golden-node-name">{personName(person) || 'Нэргүй хүн'}</strong>
                    <span className="golden-node-years">{yearsText(person)}</span>
                  </button>
                </article>
              );
            })}

            {/* Per-unit Collapse / Expand Pills with Descendant Count */}
            {onToggleCollapse &&
              layout.unitControls.map((ctrl) => {
                const isLoading = loadingUnitId === ctrl.unitId;
                const labelText = isLoading
                  ? '…'
                  : ctrl.isCollapsed
                    ? ctrl.hiddenDescendantCount > 0
                      ? `+${ctrl.hiddenDescendantCount}`
                      : '+…'
                    : '−';
                return (
                  <button
                    key={`ctrl-${ctrl.unitId}`}
                    type="button"
                    className={`golden-dock-btn golden-unit-toggle${ctrl.isCollapsed ? ' is-active' : ''}`}
                    style={{ left: ctrl.x, top: ctrl.y }}
                    disabled={isLoading}
                    aria-expanded={!ctrl.isCollapsed}
                    aria-label={
                      ctrl.isCollapsed
                        ? `Салбар нээх (${ctrl.hiddenDescendantCount} үр хойч)`
                        : 'Салбар хураах'
                    }
                    onClick={() => {
                      const focalNode = layout.nodeById.get(ctrl.focalPersonId);
                      if (focalNode) {
                        anchorRef.current = {
                          personId: ctrl.focalPersonId,
                          prevX: focalNode.x,
                          prevY: focalNode.y,
                        };
                      }
                      onToggleCollapse(ctrl.unitId, ctrl.focalPersonId, ctrl.isFrontier);
                    }}
                  >
                    {labelText}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* Floating Bottom-Center Glassmorphic Dock */}
      <div className="golden-tree-dock" role="toolbar" aria-label="Удмын модны удирдлага">
        <button type="button" className="golden-dock-btn is-active" aria-pressed={true}>
          Алтан Мод
        </button>
        <button type="button" className="golden-dock-btn" onClick={onSwitchToClassic}>
          Сонгодог 2D
        </button>
        <span className="golden-dock-divider" aria-hidden="true" />
        <button
          type="button"
          className="golden-dock-btn"
          onClick={() => setZoom((z) => Math.max(0.22, Number((z - 0.1).toFixed(2))))}
          aria-label="Жижигрүүлэх"
        >
          <Minus size={14} />
        </button>
        <span className="golden-dock-zoom-readout">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="golden-dock-btn"
          onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.1).toFixed(2))))}
          aria-label="Томруулах"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="golden-dock-btn"
          onClick={handleFitToScreen}
          aria-label="Дэлгэцэд багтаах"
          title="Дэлгэцэд багтаах"
        >
          <Scan size={13} /> Багтаах
        </button>
        <button
          type="button"
          className="golden-dock-btn"
          onClick={() => {
            setZoom(0.88);
            setPan({ x: 0, y: 0 });
            scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }}
          aria-label="Тэгшлэх"
        >
          <RotateCcw size={13} />
        </button>
        <span className="golden-dock-divider" aria-hidden="true" />
        <button type="button" className="golden-dock-btn" onClick={onOpenKinship}>
          <Compass size={13} /> Ургийн холбоо
        </button>
        <button type="button" className="golden-dock-btn" onClick={onOpenCertificate}>
          <FileBadge size={13} /> Батламж
        </button>
        <button type="button" className="golden-dock-btn" onClick={onOpenBook}>
          <BookOpen size={13} /> Ургийн ном
        </button>
        <button type="button" className="golden-dock-btn" onClick={onOpenExport}>
          <Printer size={13} /> PDF / SVG
        </button>
        <button
          type="button"
          className="golden-dock-btn"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Бүтэн дэлгэцээс гарах' : 'Бүтэн дэлгэц'}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
    </div>
  );
}
