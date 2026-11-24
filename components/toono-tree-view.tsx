'use client';

import { useMemo, useRef, useState } from 'react';
import { Compass, Download, Languages, RotateCw } from 'lucide-react';
import { personName, TreeData, TreePerson } from '../lib/api';
import { toTraditionalMongolianScript } from '../lib/mongolian-zodiac';

interface ToonoTreeViewProps {
  tree: TreeData;
  familyName?: string;
  selectedId: string;
  onSelect: (personId: string) => void;
  timeTravelOpen?: boolean;
  timeYear?: number;
}

interface ToonoUnit {
  person: TreePerson;
  spouse: TreePerson | null;
  parent: ToonoUnit | null;
  children: ToonoUnit[];
  gen: number;
  leaves: number;
  angle: number;
}

const SUUDAL_EIGHT = [
  'Гал',
  'Шороо',
  'Төмөр',
  'Огторгуй',
  'Ус',
  'Уул',
  'Мод',
  'Хий',
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function shortName(p: TreePerson) {
  return p.first_name || p.last_name || '?';
}

function isMale(p: TreePerson) {
  return p.gender === 'male';
}

function isAliveInYear(p: TreePerson, year: number): boolean {
  const b = p.birth_date ? Number(p.birth_date.slice(0, 4)) : NaN;
  const d = !p.is_alive && p.death_date ? Number(p.death_date.slice(0, 4)) : NaN;
  if (!Number.isNaN(b) && b > year) return false;
  if (!Number.isNaN(d) && d < year) return false;
  return true;
}

export default function ToonoTreeView({
  tree,
  familyName = 'Гуулингийнхан',
  selectedId,
  onSelect,
  timeTravelOpen = false,
  timeYear = new Date().getFullYear(),
}: ToonoTreeViewProps) {
  const [mongolianScript, setMongolianScript] = useState(false);
  const [showSuudalRing, setShowSuudalRing] = useState(true);
  const [rotation, setRotation] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const built = useMemo(() => {
    if (!tree.persons.length) return null;
    const byId = new Map<string, TreePerson>();
    tree.persons.forEach((p) => byId.set(p.id, p));

    const parentsOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    tree.parent_child_relationships.forEach((r) => {
      if (!byId.has(r.parent_id) || !byId.has(r.child_id)) return;
      const ps = parentsOf.get(r.child_id) ?? [];
      if (!ps.includes(r.parent_id)) ps.push(r.parent_id);
      parentsOf.set(r.child_id, ps);
      const cs = childrenOf.get(r.parent_id) ?? [];
      if (!cs.includes(r.child_id)) cs.push(r.child_id);
      childrenOf.set(r.parent_id, cs);
    });

    const spousesOf = new Map<string, string[]>();
    tree.marriages.forEach((m) => {
      if (!byId.has(m.person_1_id) || !byId.has(m.person_2_id)) return;
      const a = spousesOf.get(m.person_1_id) ?? [];
      if (!a.includes(m.person_2_id)) a.push(m.person_2_id);
      spousesOf.set(m.person_1_id, a);
      const b = spousesOf.get(m.person_2_id) ?? [];
      if (!b.includes(m.person_1_id)) b.push(m.person_1_id);
      spousesOf.set(m.person_2_id, b);
    });

    // Pick root ancestor (no parents, preferring one with most children / male)
    const roots = tree.persons.filter((p) => (parentsOf.get(p.id)?.length ?? 0) === 0);
    const rootPerson =
      roots.sort((a, b) => {
        const diff = (childrenOf.get(b.id)?.length ?? 0) - (childrenOf.get(a.id)?.length ?? 0);
        if (diff !== 0) return diff;
        return (isMale(b) ? 1 : 0) - (isMale(a) ? 1 : 0);
      })[0] ?? tree.persons[0];

    const visited = new Set<string>();
    const unitByPerson = new Map<string, ToonoUnit>();
    const allUnits: ToonoUnit[] = [];

    function buildUnit(p: TreePerson, parent: ToonoUnit | null, gen: number): ToonoUnit {
      visited.add(p.id);
      const spId = (spousesOf.get(p.id) ?? []).find((id) => !visited.has(id));
      const sp = spId ? byId.get(spId) ?? null : null;
      if (sp) visited.add(sp.id);

      const unit: ToonoUnit = {
        person: p,
        spouse: sp,
        parent,
        children: [],
        gen,
        leaves: 1,
        angle: 0,
      };
      allUnits.push(unit);
      unitByPerson.set(p.id, unit);
      if (sp) unitByPerson.set(sp.id, unit);

      const kidIds = new Set<string>(childrenOf.get(p.id) ?? []);
      if (sp) (childrenOf.get(sp.id) ?? []).forEach((cid) => kidIds.add(cid));

      kidIds.forEach((cid) => {
        if (!visited.has(cid) && byId.has(cid) && gen < 8) {
          unit.children.push(buildUnit(byId.get(cid)!, unit, gen + 1));
        }
      });

      unit.leaves = unit.children.length
        ? unit.children.reduce((acc, c) => acc + c.leaves, 0)
        : 1;
      return unit;
    }

    const root = buildUnit(rootPerson, null, 0);

    // Assign radial angles across 360 degrees
    const outerUnits: ToonoUnit[] = [];
    function place(u: ToonoUnit, a0: number, a1: number) {
      u.angle = (a0 + a1) / 2;
      if (u.gen > 0) outerUnits.push(u);
      const total = u.children.reduce((acc, c) => acc + c.leaves, 0);
      let cursor = a0;
      u.children.forEach((c) => {
        const span = ((a1 - a0) * c.leaves) / Math.max(1, total);
        place(c, cursor, cursor + span);
        cursor += span;
      });
    }
    place(root, -180, 180);

    const maxGen = Math.max(1, ...allUnits.map((u) => u.gen));
    const selectedUnit = unitByPerson.get(selectedId) ?? root;
    const highlightUnits = new Set<ToonoUnit>();
    for (let u: ToonoUnit | null = selectedUnit; u; u = u.parent) {
      highlightUnits.add(u);
    }

    return { root, outerUnits, maxGen, selectedUnit, highlightUnits, allUnits };
  }, [tree, selectedId]);

  if (!built) {
    return <div className="hush-empty">Тооно модонд харуулах хүн одоогоор алга.</div>;
  }

  const { root, outerUnits, maxGen, highlightUnits } = built;
  const ringRadius = (g: number) => (g === 0 ? 0 : 152 + (g - 1) * 116);
  const outerMost = ringRadius(maxGen) + (showSuudalRing ? 92 : 68);
  const S = outerMost * 2;
  const C = S / 2;

  const pos = (u: ToonoUnit): [number, number] => {
    const r = ringRadius(u.gen);
    const rad = ((u.angle + rotation) * Math.PI) / 180;
    return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
  };

  function displayName(p: TreePerson) {
    const base = shortName(p);
    return mongolianScript ? toTraditionalMongolianScript(base) : base;
  }

  function downloadSvg() {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--card').trim() || '#FFFBF2';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);

    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${familyName}-toono-mod.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPng() {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--card').trim() || '#FFFBF2';
    const svgStr = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 2048;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 2048, 2048);
        ctx.drawImage(img, 0, 0, 2048, 2048);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${familyName}-toono-mod-2048.png`;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  return (
    <div className="toono-view">
      <div className="hush-toolbar">
        <button
          type="button"
          className={`hush-chip-btn ${mongolianScript ? 'is-on' : ''}`}
          onClick={() => setMongolianScript((v) => !v)}
        >
          <Languages size={14} /> {mongolianScript ? 'Хүмүүн бичиг ✓' : 'Кирилл → Монгол бичиг'}
        </button>

        <button
          type="button"
          className={`hush-chip-btn ${showSuudalRing ? 'is-on' : ''}`}
          onClick={() => setShowSuudalRing((v) => !v)}
        >
          <Compass size={14} /> 8 Суудлын цагариг
        </button>

        <button
          type="button"
          className="hush-chip-btn"
          onClick={() => setRotation((r) => (r + 30) % 360)}
        >
          <RotateCw size={14} /> 30° эргүүлэх
        </button>

        <button type="button" className="hush-chip-btn" onClick={downloadSvg}>
          <Download size={14} /> SVG
        </button>

        <button type="button" className="hush-chip-btn" onClick={downloadPng}>
          <Download size={14} /> 2048px PNG
        </button>
      </div>

      <div className="hush-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${S} ${S}`}
          className="toono-svg"
          role="group"
          aria-label="Тооно Нархан — Ургийн Хүрд"
        >
          {/* Optional 8 Suudal Heritage Outer Ring */}
          {showSuudalRing && (
            <g className="toono-suudal-ring">
              <circle
                cx={C}
                cy={C}
                r={ringRadius(maxGen) + 64}
                fill="none"
                stroke="var(--gold)"
                strokeWidth="1.4"
                opacity="0.55"
              />
              {SUUDAL_EIGHT.map((label, idx) => {
                const deg = idx * 45 - 90 + rotation;
                const rad = (deg * Math.PI) / 180;
                const rr = ringRadius(maxGen) + 76;
                return (
                  <text
                    key={label}
                    x={C + rr * Math.cos(rad)}
                    y={C + rr * Math.sin(rad) + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="var(--gt)"
                    opacity="0.85"
                  >
                    {label}
                  </text>
                );
              })}
            </g>
          )}

          {/* Concentric Generation Rings */}
          {Array.from({ length: maxGen }, (_, i) => maxGen - i).map((g) => (
            <g key={`ring-${g}`}>
              <circle
                cx={C}
                cy={C}
                r={ringRadius(g)}
                fill="none"
                stroke="var(--gold)"
                strokeWidth={g === 1 ? 2 : 1.3}
                strokeDasharray={g === 1 ? undefined : '4 7'}
                opacity="0.8"
              />
              <text
                x={C}
                y={C - ringRadius(g) - 6}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="var(--gt)"
                opacity="0.7"
              >
                {ROMAN[g] ?? g + 1} ҮЕ
              </text>
            </g>
          ))}

          {/* 64 Ger Roof Poles (Унь) */}
          {Array.from({ length: 64 }, (_, i) => {
            const rad = ((i * 5.625 + rotation) * Math.PI) / 180;
            const r2 = ringRadius(maxGen) + 46;
            return (
              <line
                key={`uni-${i}`}
                x1={C + 88 * Math.cos(rad)}
                y1={C + 88 * Math.sin(rad)}
                x2={C + r2 * Math.cos(rad)}
                y2={C + r2 * Math.sin(rad)}
                stroke="var(--gold)"
                strokeWidth="1"
                opacity="0.26"
              />
            );
          })}

          {/* Lineage Spokes */}
          {outerUnits.map((u) => {
            const [x, y] = pos(u);
            const [px, py] = u.parent && u.parent.gen > 0 ? pos(u.parent) : [C, C];
            const hl = highlightUnits.has(u);
            return (
              <line
                key={`edge-${u.person.id}`}
                x1={px}
                y1={py}
                x2={x}
                y2={y}
                stroke={hl ? 'var(--pr)' : 'var(--gold)'}
                strokeWidth={hl ? 4.5 : 2}
                opacity={hl ? 1 : 0.82}
              />
            );
          })}

          {/* Central Toono Medallion (Root Couple) */}
          <circle cx={C} cy={C} r={86} fill="var(--card)" stroke="var(--gold)" strokeWidth="3" />
          <circle cx={C} cy={C} r={79} fill="none" stroke="var(--goldl)" strokeWidth="1" />

          {(root.spouse
            ? [
                { dx: -32, p: root.person },
                { dx: 32, p: root.spouse },
              ]
            : [{ dx: 0, p: root.person }]
          ).map(({ dx, p }) => (
            <g
              key={`root-${p.id}`}
              className={`hush-node ${isMale(p) ? 'is-male' : 'is-female'} ${p.id === selectedId ? 'is-sel' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={personName(p)}
              onClick={() => onSelect(p.id)}
            >
              <circle className="hush-node__circle" cx={C + dx} cy={C - 12} r={28} />
              <text className="hush-node__ini" x={C + dx} y={C - 3}>
                {shortName(p).slice(0, 1).toUpperCase()}
              </text>
            </g>
          ))}

          <text
            x={C}
            y={C + 44}
            textAnchor="middle"
            fontSize="12.5"
            fontWeight="700"
            fill="var(--hd)"
            style={{ fontFamily: 'var(--font-philosopher), Philosopher, serif' }}
          >
            {root.spouse
              ? `${displayName(root.person)} ⚭ ${displayName(root.spouse)}`
              : displayName(root.person)}
          </text>
          <text x={C} y={C + 60} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--gt)">
            ҮНДЭС · I ҮЕ
          </text>

          {/* Outer Generation Nodes + Spouse Satellites */}
          {outerUnits.map((u) => {
            const [x, y] = pos(u);
            const r = u.gen === 1 ? 28 : 22;
            const p = u.person;
            const name = displayName(p);
            const fs = u.gen === 1 ? 12 : 10.5;
            const w = Math.max(58, name.length * 6.8 + 18);
            const hl = highlightUnits.has(u);
            const sel = p.id === selectedId;
            const dimmed = timeTravelOpen && !isAliveInYear(p, timeYear);

            const satRad = ((u.angle + rotation + 90) * Math.PI) / 180;
            const sx = x + (r + 20) * Math.cos(satRad);
            const sy = y + (r + 20) * Math.sin(satRad);

            return (
              <g key={`u-${p.id}`}>
                <g
                  className={`hush-node ${isMale(p) ? 'is-male' : 'is-female'} ${hl ? 'is-hl' : ''} ${sel ? 'is-sel' : ''} ${dimmed ? 'is-dim' : ''}`}
                  tabIndex={0}
                  role="button"
                  aria-label={personName(p)}
                  onClick={() => onSelect(p.id)}
                >
                  <circle className="hush-node__circle" cx={x} cy={y} r={r} />
                  <text className="hush-node__ini" x={x} y={y + r * 0.34} fontSize={r * 0.85}>
                    {shortName(p).slice(0, 1).toUpperCase()}
                  </text>
                  <rect
                    className="hush-node__card"
                    x={x - w / 2}
                    y={y + r - 3}
                    width={w}
                    height={fs + 9}
                    rx={(fs + 9) / 2}
                  />
                  <text className="hush-node__name" x={x} y={y + r + fs + 1} fontSize={fs}>
                    {name}
                  </text>
                </g>

                {u.spouse && (
                  <g
                    className={`hush-node ${isMale(u.spouse) ? 'is-male' : 'is-female'} ${u.spouse.id === selectedId ? 'is-sel' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${personName(u.spouse)} (Хань)`}
                    onClick={() => onSelect(u.spouse!.id)}
                  >
                    <circle className="hush-node__circle" cx={sx} cy={sy} r={13} />
                    <text className="hush-node__ini" x={sx} y={sy + 4.5} fontSize="11.5">
                      {shortName(u.spouse).slice(0, 1).toUpperCase()}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
