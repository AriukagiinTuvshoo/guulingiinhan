'use client';

import { useRef, useState } from 'react';
import { BookOpen, Compass, FileBadge, Maximize2, Minimize2, Minus, Plus, Printer, RotateCcw } from 'lucide-react';
import { API_BASE, personName, TreePerson } from '../lib/api';
import { AdvancedTreeLayout } from '../lib/tree-layout';
import '../app/golden-tree.css';

interface GoldenHeritageTreeProps {
  layout: AdvancedTreeLayout;
  selectedId: string;
  onSelect: (personId: string) => void;
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
  const [zoom, setZoom] = useState(0.92);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

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
              transition: dragging ? 'none' : 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
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
                  <stop offset="0%" stopColor="#f3d68b" />
                  <stop offset="55%" stopColor="#c89a3e" />
                  <stop offset="100%" stopColor="#8f6b24" />
                </linearGradient>
              </defs>

              {/* Marriage bridges */}
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
                      className="golden-marriage-line"
                    />
                    <circle
                      cx={u.x}
                      cy={u.y}
                      r={4}
                      fill="#f0cf7b"
                      stroke="#1a1610"
                      strokeWidth="1.5"
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
            </svg>

            {/* Luxury Obsidian Portrait Cards */}
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
                    <span className="tree-time-age-pill">✨ {ageAtYear} нас</span>
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
          </div>
        </div>
      </div>

      {/* Floating Bottom-Center Luxury Glassmorphic Dock */}
      <div className="golden-tree-dock" role="toolbar" aria-label="Удмын модны удирдлага">
        <button type="button" className="golden-dock-btn is-active" aria-pressed={true}>
          ✨ Алтан Мод
        </button>
        <button type="button" className="golden-dock-btn" onClick={onSwitchToClassic}>
          Сонгодог 2D
        </button>
        <span className="golden-dock-divider" aria-hidden="true" />
        <button
          type="button"
          className="golden-dock-btn"
          onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.1).toFixed(2))))}
          aria-label="Жижигрүүлэх"
        >
          <Minus size={14} />
        </button>
        <span style={{ fontSize: 11.5, color: '#e6cfa0', fontWeight: 700, minWidth: 36, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
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
          onClick={() => {
            setZoom(0.92);
            setPan({ x: 0, y: 0 });
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
