'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown, Plus } from 'lucide-react';
import { personName, TreeData, TreePerson } from '../lib/api';
import {
  computeMongolianZodiac,
  getMotherGloryMedal,
  toMongolianGenitive,
} from '../lib/mongolian-zodiac';
import { UlziiKnot } from './mongolian-ornament-band';
import type { RelativeRole } from './pedigree-wizard-modal';

interface HushTreeViewProps {
  tree: TreeData;
  selectedId: string;
  onSelect: (personId: string) => void;
  canEdit?: boolean;
  onQuickAdd?: (anchorPersonId: string, role: RelativeRole) => void;
  timeTravelOpen?: boolean;
  timeYear?: number;
}

type SideFilter = 'all' | 'paternal' | 'maternal';

function shortName(p: TreePerson) {
  return p.first_name || p.last_name || '?';
}

function initialChar(p: TreePerson) {
  return shortName(p).slice(0, 1).toUpperCase();
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

export default function HushTreeView({
  tree,
  selectedId,
  onSelect,
  canEdit = false,
  onQuickAdd,
  timeTravelOpen = false,
  timeYear = new Date().getFullYear(),
}: HushTreeViewProps) {
  const [side, setSide] = useState<SideFilter>('all');
  const [inverted, setInverted] = useState(false); // false = upward-growing cedar (roots bottom), true = top-down

  const model = useMemo(() => {
    const byId = new Map<string, TreePerson>();
    tree.persons.forEach((p) => byId.set(p.id, p));

    const parentsOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    tree.parent_child_relationships.forEach((rel) => {
      if (!byId.has(rel.parent_id) || !byId.has(rel.child_id)) return;
      const pList = parentsOf.get(rel.child_id) ?? [];
      if (!pList.includes(rel.parent_id)) pList.push(rel.parent_id);
      parentsOf.set(rel.child_id, pList);

      const cList = childrenOf.get(rel.parent_id) ?? [];
      if (!cList.includes(rel.child_id)) cList.push(rel.child_id);
      childrenOf.set(rel.parent_id, cList);
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

    const focal =
      byId.get(selectedId) ??
      tree.persons.find((p) => (parentsOf.get(p.id)?.length ?? 0) === 0) ??
      tree.persons[0] ??
      null;

    if (!focal) return null;

    const focalSpouseId = (spousesOf.get(focal.id) ?? [])[0] ?? null;
    const focalSpouse = focalSpouseId ? byId.get(focalSpouseId) ?? null : null;

    // Parents of focal
    let parentIds = parentsOf.get(focal.id) ?? [];
    if (parentIds.length === 0 && focalSpouse) {
      // If focal has no parents, check spouse's parents only if needed? No, keep focal's true parents.
    }
    let parents = parentIds.map((id) => byId.get(id)!).filter(Boolean);
    if (side === 'paternal') {
      const dads = parents.filter((p) => isMale(p));
      if (dads.length) parents = dads;
    } else if (side === 'maternal') {
      const moms = parents.filter((p) => !isMale(p));
      if (moms.length) parents = moms;
    }

    // Siblings (sharing at least one parent with focal)
    const siblingSet = new Set<string>([focal.id]);
    parentIds.forEach((pid) => {
      (childrenOf.get(pid) ?? []).forEach((cid) => siblingSet.add(cid));
    });
    const siblings = Array.from(siblingSet)
      .map((id) => byId.get(id)!)
      .filter(Boolean);

    // Children of focal (or union with focalSpouse)
    const childSet = new Set<string>(childrenOf.get(focal.id) ?? []);
    if (focalSpouse) {
      (childrenOf.get(focalSpouse.id) ?? []).forEach((cid) => childSet.add(cid));
    }
    const children = Array.from(childSet)
      .map((id) => byId.get(id)!)
      .filter(Boolean);

    // Ancestor chain label
    const chain: string[] = [];
    let cursor: TreePerson | undefined = focal;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      const spId = (spousesOf.get(cursor.id) ?? [])[0];
      const sp = spId ? byId.get(spId) : undefined;
      chain.unshift(sp && (parentsOf.get(cursor.id)?.length ?? 0) === 0 ? `${shortName(cursor)} ⚭ ${shortName(sp)}` : shortName(cursor));
      const pIds: string[] = parentsOf.get(cursor.id) ?? [];
      const nextId: string | undefined = pIds.find((id: string) => {
        const person = byId.get(id);
        return person ? isMale(person) : false;
      }) ?? pIds[0];
      cursor = nextId ? byId.get(nextId) : undefined;
    }

    return {
      byId,
      childrenOf,
      spousesOf,
      focal,
      focalSpouse,
      parents,
      siblings,
      children,
      chain,
    };
  }, [tree, selectedId, side]);

  if (!model) {
    return (
      <div className="hush-empty">
        <p>Ургийн модонд хүн бүртгэгдээгүй байна.</p>
      </div>
    );
  }

  const { focal, focalSpouse, parents, siblings, children, childrenOf, spousesOf, byId, chain } = model;

  // Layout geometry (responsive SVG viewBox)
  const R = 30;
  const W = Math.max(820, Math.max(siblings.length, children.length, 3) * 148 + 140);
  const CX = W / 2;
  const Y_ROOT = inverted ? 86 : 408;
  const Y_MID = 248;
  const Y_KIDS = inverted ? 408 : 86;

  // Position parents row
  const parentNodes = parents.slice(0, 2);
  const parentPositions =
    parentNodes.length === 2
      ? [
          { person: parentNodes[0], x: CX - 56, y: Y_ROOT },
          { person: parentNodes[1], x: CX + 56, y: Y_ROOT },
        ]
      : parentNodes.length === 1
      ? [{ person: parentNodes[0], x: CX, y: Y_ROOT }]
      : [];

  // Position middle row (siblings + focal with spouse)
  type MidSlot = { person: TreePerson; spouse: TreePerson | null; cx: number; x1: number; x2?: number };
  const midSlotsRaw = siblings.map((s) => {
    const sp = s.id === focal.id ? focalSpouse : null;
    return { person: s, spouse: sp, width: sp ? 176 : 112 };
  });
  const totalMidW =
    midSlotsRaw.reduce((acc, s) => acc + s.width, 0) + Math.max(0, midSlotsRaw.length - 1) * 28;
  let mx = CX - totalMidW / 2;
  const midSlots: MidSlot[] = midSlotsRaw.map((s) => {
    const cx = mx + s.width / 2;
    mx += s.width + 28;
    return {
      person: s.person,
      spouse: s.spouse,
      cx,
      x1: s.spouse ? cx - 44 : cx,
      x2: s.spouse ? cx + 44 : undefined,
    };
  });
  const focalSlot = midSlots.find((s) => s.person.id === focal.id) ?? midSlots[0];

  // Position children row
  const kidSpacing = 128;
  const totalKidW = Math.max(0, children.length - 1) * kidSpacing;
  const kidPositions = children.map((kid, idx) => ({
    person: kid,
    x: CX - totalKidW / 2 + idx * kidSpacing,
    y: Y_KIDS,
  }));

  function relationLabel(p: TreePerson, roleGroup: 'parent' | 'mid' | 'spouse' | 'child') {
    if (p.id === focal.id) return 'Сонгосон хүн';
    if (roleGroup === 'spouse') return 'Хань';
    if (roleGroup === 'parent') return isMale(p) ? 'Эцэг' : 'Эх';
    if (roleGroup === 'child') return isMale(p) ? 'Хүү' : 'Охин';
    return isMale(p) ? 'Ах / дүү' : 'Эгч / дүү';
  }

  function renderBranch(sx: number, sy: number, ex: number, ey: number, highlight: boolean, key: string) {
    const cy1 = (sy + ey) / 2 + (inverted ? -18 : 18);
    const cy2 = (sy + ey) / 2 + (inverted ? 18 : -18);
    return (
      <path
        key={key}
        className={`hush-branch ${highlight ? 'is-hl' : ''}`}
        d={`M${sx} ${sy} C${sx} ${cy1}, ${ex} ${cy2}, ${ex} ${ey}`}
      />
    );
  }

  function renderPersonNode(
    p: TreePerson,
    x: number,
    y: number,
    role: string,
    key: string,
  ) {
    const label = shortName(p);
    const pillW = Math.max(72, label.length * 7.8 + 24);
    const zodiac = computeMongolianZodiac(p.birth_date, p.gender);
    const kidCount = childrenOf.get(p.id)?.length ?? 0;
    const medal = getMotherGloryMedal(p.gender, kidCount);
    const active = p.id === selectedId;
    const dimmed = timeTravelOpen && !isAliveInYear(p, timeYear);
    const fatherId = parents.find((par) => isMale(par))?.id;
    const fatherName = p.id === focal.id && fatherId ? byId.get(fatherId)?.first_name : undefined;
    const genitiveTag = fatherName ? toMongolianGenitive(fatherName) : null;

    return (
      <g
        key={key}
        className={`hush-node ${isMale(p) ? 'is-male' : 'is-female'} ${active ? 'is-sel' : ''} ${dimmed ? 'is-dim' : ''}`}
        tabIndex={0}
        role="button"
        aria-label={`${personName(p)}, ${role}`}
        onClick={() => onSelect(p.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(p.id);
          }
        }}
      >
        <text className="hush-node__role" x={x} y={y - R - 8}>
          {genitiveTag ? `${genitiveTag} · ${role}` : role}
        </text>
        <circle className="hush-node__circle" cx={x} cy={y} r={R} />
        <text className="hush-node__ini" x={x} y={y + 9}>
          {initialChar(p)}
        </text>
        {zodiac && (
          <g transform={`translate(${x + R - 4}, ${y - R + 6})`}>
            <circle r="11" fill="var(--card)" stroke="var(--gold)" strokeWidth="1.4" />
            <text
              textAnchor="middle"
              y="3.5"
              fontSize="8.5"
              fontWeight="700"
              fill="var(--gt)"
            >
              {zodiac.animalLabel.slice(0, 2)}
            </text>
          </g>
        )}
        {medal && (
          <g transform={`translate(${x - R + 4}, ${y - R + 6})`}>
            <circle r="10" fill="var(--gold)" stroke="var(--card)" strokeWidth="1.4" />
            <text textAnchor="middle" y="3.5" fontSize="9" fontWeight="700" fill="#fff">
              ★
            </text>
          </g>
        )}
        <rect
          className="hush-node__card"
          x={x - pillW / 2}
          y={y + R - 3}
          width={pillW}
          height={23}
          rx={11.5}
        />
        <text className="hush-node__name" x={x} y={y + R + 12}>
          {label}
        </text>
      </g>
    );
  }

  return (
    <div className="hush-view">
      <div className="hush-toolbar">
        <div className="hush-seg" role="group" aria-label="Удмын тал шүүх">
          {(
            [
              ['all', 'Бүгд'],
              ['paternal', 'Аавын тал'],
              ['maternal', 'Эхийн тал'],
            ] as [SideFilter, string][]
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              className={side === id ? 'is-on' : ''}
              onClick={() => setSide(id)}
            >
              {text}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="hush-chip-btn"
          onClick={() => setInverted((v) => !v)}
          title="Модны ургах чиглэлийг солих"
        >
          <ArrowUpDown size={14} aria-hidden="true" />
          {inverted ? 'Дээрээс доош' : 'Үндсээс дээш (Хуш)'}
        </button>

        <div className="hush-path" aria-label="Өвөг дээдсийн зам">
          <strong>Өвөг дээдсийн зам:</strong> {chain.join(' → ')}
        </div>
      </div>

      <div className="hush-canvas">
        <svg viewBox={`0 0 ${W} 495`} className="hush-svg" role="group" aria-label="Амьд Хуш мод">
          {/* Natural ground hill */}
          <path
            d={
              inverted
                ? `M0 0 H${W} V46 Q${CX} 72 0 46 Z`
                : `M0 444 Q${CX} 412 ${W} 444 V495 H0 Z`
            }
            fill="var(--pr)"
            opacity="0.13"
          />

          {/* Branches: Parents -> Siblings */}
          {parentPositions.length > 0 &&
            midSlots.map((slot) =>
              renderBranch(
                CX,
                inverted ? Y_ROOT + 42 : Y_ROOT - 14,
                slot.x1,
                inverted ? Y_MID - 42 : Y_MID + 52,
                slot.person.id === focal.id,
                `p-m-${slot.person.id}`,
              ),
            )}

          {/* Branches: Focal -> Children */}
          {focalSlot &&
            kidPositions.map((kp) =>
              renderBranch(
                focalSlot.cx,
                inverted ? Y_MID + 42 : Y_MID - (focalSlot.spouse ? 10 : 32),
                kp.x,
                inverted ? Y_KIDS - 42 : Y_KIDS + 52,
                false,
                `m-k-${kp.person.id}`,
              ),
            )}

          {/* Parent couple marriage bar & Ulzii knot */}
          {parentPositions.length === 2 && (
            <>
              <line
                x1={parentPositions[0].x}
                y1={Y_ROOT}
                x2={parentPositions[1].x}
                y2={Y_ROOT}
                stroke="var(--hd)"
                strokeWidth="3"
              />
              <UlziiKnot x={CX} y={Y_ROOT} scale={0.62} />
            </>
          )}

          {/* Render Parents */}
          {parentPositions.map((pp) =>
            renderPersonNode(pp.person, pp.x, pp.y, relationLabel(pp.person, 'parent'), `par-${pp.person.id}`),
          )}

          {/* Render Mid Row (Focal + Spouse + Siblings) */}
          {midSlots.map((slot) => (
            <g key={`slot-${slot.person.id}`}>
              {slot.spouse && slot.x2 !== undefined && (
                <>
                  <line
                    x1={slot.x1}
                    y1={Y_MID}
                    x2={slot.x2}
                    y2={Y_MID}
                    stroke="var(--hd)"
                    strokeWidth="3"
                  />
                  <UlziiKnot x={slot.cx} y={Y_MID} scale={0.62} />
                </>
              )}
              {renderPersonNode(slot.person, slot.x1, Y_MID, relationLabel(slot.person, 'mid'), `mid-${slot.person.id}`)}
              {slot.spouse &&
                slot.x2 !== undefined &&
                renderPersonNode(slot.spouse, slot.x2, Y_MID, relationLabel(slot.spouse, 'spouse'), `sp-${slot.spouse.id}`)}
            </g>
          ))}

          {/* Render Children */}
          {kidPositions.map((kp) =>
            renderPersonNode(kp.person, kp.x, kp.y, relationLabel(kp.person, 'child'), `kid-${kp.person.id}`),
          )}

          {/* Direct-on-Canvas Ghost Action Nodes */}
          {canEdit && onQuickAdd && parentPositions.length === 0 && (
            <g
              className="hush-ghost"
              tabIndex={0}
              role="button"
              aria-label="Эцэг эх нэмэх"
              onClick={() => onQuickAdd(focal.id, 'father')}
            >
              <circle cx={CX} cy={Y_ROOT} r={R} />
              <text x={CX} y={Y_ROOT + 4}>+ Эцэг эх</text>
            </g>
          )}

          {canEdit && onQuickAdd && kidPositions.length === 0 && focalSlot && (
            <g
              className="hush-ghost"
              tabIndex={0}
              role="button"
              aria-label="Хүүхэд нэмэх"
              onClick={() => onQuickAdd(focal.id, 'son')}
            >
              <circle cx={focalSlot.cx} cy={Y_KIDS} r={R} />
              <text x={focalSlot.cx} y={Y_KIDS + 4}>+ Хүүхэд</text>
            </g>
          )}

          {canEdit && onQuickAdd && !focalSpouse && focalSlot && (
            <g
              className="hush-ghost"
              tabIndex={0}
              role="button"
              aria-label="Хань нэмэх"
              onClick={() => onQuickAdd(focal.id, 'spouse')}
            >
              <circle cx={focalSlot.x1 + 88} cy={Y_MID} r={24} />
              <text x={focalSlot.x1 + 88} y={Y_MID + 4}>+ Хань</text>
            </g>
          )}
        </svg>
      </div>

      {canEdit && onQuickAdd && (
        <div className="hush-quick-bar">
          <button type="button" className="hush-chip-btn" onClick={() => onQuickAdd(focal.id, 'father')}>
            <Plus size={14} /> Эцэг / Эх
          </button>
          <button type="button" className="hush-chip-btn" onClick={() => onQuickAdd(focal.id, 'spouse')}>
            <Plus size={14} /> Хань
          </button>
          <button type="button" className="hush-chip-btn" onClick={() => onQuickAdd(focal.id, 'son')}>
            <Plus size={14} /> Хүү / Охин
          </button>
        </div>
      )}
    </div>
  );
}
