'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Eye, Languages, Printer, Sparkles, X } from 'lucide-react';
import {
  api,
  Family,
  MemoryListItem,
  MemoryListPage,
  personName,
  StoryListItem,
  StoryListPage,
  TreeData,
} from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';
import { computeMongolianZodiac, getMotherGloryMedal, toTraditionalMongolianScript } from '../lib/mongolian-zodiac';

export interface FamilyBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  family: Family | null;
  tree: TreeData | null;
}

type BookTheme = 'gold_foil' | 'parchment' | 'emerald' | 'obsidian';

const THEME_PALETTE: Record<
  BookTheme,
  {
    label: string;
    bg: string;
    pageCard: string;
    coverBg: string;
    coverInk: string;
    accent: string;
    border: string;
    ink: string;
    muted: string;
    sealBg: string;
  }
> = {
  gold_foil: {
    label: '👑 Алтлаг дэвсгэр',
    bg: '#F4E6C2',
    pageCard: '#FCF4DE',
    coverBg: 'linear-gradient(155deg, #2C1E0E 0%, #171007 52%, #2B1D0D 100%)',
    coverInk: '#F7E7BE',
    accent: '#E1B345',
    border: '#B88A2E',
    ink: '#31200E',
    muted: '#7A5A17',
    sealBg: '#9E2A22',
  },
  parchment: {
    label: '📜 Нарлаг шаазан',
    bg: '#F7F0E3',
    pageCard: '#FFFBF2',
    coverBg: 'linear-gradient(165deg, #4A2C19 0%, #2D1A0E 100%)',
    coverInk: '#F7F0E3',
    accent: '#EBD59A',
    border: '#B88A2E',
    ink: '#3B2415',
    muted: '#7A5A17',
    sealBg: '#9E2A22',
  },
  emerald: {
    label: '🌲 Хаш ногоон',
    bg: '#FBF1DC',
    pageCard: '#FFF9EC',
    coverBg: 'linear-gradient(165deg, #1F5B3F 0%, #0F3423 100%)',
    coverInk: '#FBF1DC',
    accent: '#EBD59A',
    border: '#2F6B45',
    ink: '#2A1B10',
    muted: '#6F5326',
    sealBg: '#9E2A22',
  },
  obsidian: {
    label: '✨ Өлзий алтан',
    bg: '#EFE2C4',
    pageCard: '#F8EDD3',
    coverBg: 'linear-gradient(165deg, #14100D 0%, #090705 100%)',
    coverInk: '#F1E3BE',
    accent: '#E1B345',
    border: '#C99A2E',
    ink: '#2A1B10',
    muted: '#6F5326',
    sealBg: '#9E2A22',
  },
};

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function lifeRange(birth?: string | null, death?: string | null, isAlive?: boolean): string {
  const b = birth?.slice(0, 4);
  const d = !isAlive ? death?.slice(0, 4) : null;
  if (b && d) return `${b} – ${d}`;
  if (b) return isAlive ? `${b} – одоо` : `${b} – ?`;
  return 'Огноо тодорхойгүй';
}

export function FamilyBookModal({ isOpen, onClose, family, tree }: FamilyBookModalProps) {
  const [bookTitle, setBookTitle] = useState('');
  const [dedication, setDedication] = useState(
    'Өвөг дээдсийнхээ нэр алдар, амьдралын түүх, гэр бүлийн нандин дурсамжийг хойч үедээ өвлүүлэн үлдээв.',
  );
  const [theme, setTheme] = useState<BookTheme>('gold_foil');
  const [includeMongolianScript, setIncludeMongolianScript] = useState(true);
  const [includeTreeDiagram, setIncludeTreeDiagram] = useState(true);
  const [includeDirectory, setIncludeDirectory] = useState(true);
  const [includeStories, setIncludeStories] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [includeTimelineAndSign, setIncludeTimelineAndSign] = useState(true);
  const [stories, setStories] = useState<StoryListItem[]>([]);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen && Boolean(family), dialogRef, { onEscape: onClose });

  useEffect(() => {
    if (!isOpen || !family) return;
    let active = true;
    const controller = new AbortController();
    setLoadingContent(true);
    Promise.all([
      api<StoryListPage>(`/families/${encodeURIComponent(family.id)}/stories?page=1&page_size=20`, {
        signal: controller.signal,
      }).catch(() => ({ items: [], page: 1, page_size: 20, total: 0, has_next: false })),
      api<MemoryListPage>(`/families/${encodeURIComponent(family.id)}/memories?page=1&page_size=15`, {
        signal: controller.signal,
      }).catch(() => ({ items: [], page: 1, page_size: 15, total: 0, has_next: false })),
    ])
      .then(([storyPage, memoryPage]) => {
        if (!active) return;
        setStories(storyPage.items ?? []);
        setMemories(memoryPage.items ?? []);
      })
      .finally(() => {
        if (active) setLoadingContent(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, family]);

  const effectiveTitle = bookTitle.trim() || `${family?.name ?? 'Гэр бүлийн'} — Ургийн Ном`;
  const verticalFamilyScript = toTraditionalMongolianScript(family?.name ?? 'Гуулингийнхан');

  const directoryGroups = useMemo(() => {
    const persons = tree?.persons ?? [];
    const personById = new Map(persons.map((p) => [p.id, p]));
    const parentsByChild = new Map<string, string[]>();
    const spousesByPerson = new Map<string, string[]>();

    for (const rel of tree?.parent_child_relationships ?? []) {
      const list = parentsByChild.get(rel.child_id) ?? [];
      list.push(rel.parent_id);
      parentsByChild.set(rel.child_id, list);
    }
    for (const m of tree?.marriages ?? []) {
      const a = spousesByPerson.get(m.person_1_id) ?? [];
      a.push(m.person_2_id);
      spousesByPerson.set(m.person_1_id, a);
      const b = spousesByPerson.get(m.person_2_id) ?? [];
      b.push(m.person_1_id);
      spousesByPerson.set(m.person_2_id, b);
    }

    return [...persons]
      .sort((a, b) => (a.birth_date ?? '9999').localeCompare(b.birth_date ?? '9999'))
      .map((person) => {
        const parentNames = (parentsByChild.get(person.id) ?? [])
          .map((pid) => personById.get(pid))
          .filter(Boolean)
          .map((p) => personName(p!));
        const spouseNames = (spousesByPerson.get(person.id) ?? [])
          .map((sid) => personById.get(sid))
          .filter(Boolean)
          .map((p) => personName(p!));
        const zodiac = computeMongolianZodiac(person.birth_date, person.gender);
        return {
          id: person.id,
          fullName: personName(person),
          mongolScript: toTraditionalMongolianScript(person.first_name || personName(person)),
          life: lifeRange(person.birth_date, person.death_date, person.is_alive),
          zodiac: zodiac ? zodiac.zodiacFull : '',
          suudal: zodiac ? zodiac.suudal : '',
          lineage: [person.lineage_name, person.branch_name].filter(Boolean).join(' · '),
          parents: parentNames.join(', '),
          spouses: spouseNames.join(', '),
          isAlive: person.is_alive,
        };
      });
  }, [tree]);

  if (!isOpen || !family) return null;

  const palette = THEME_PALETTE[theme];
  const peopleCount = tree?.persons.length ?? 0;
  const marriageCount = tree?.marriages.length ?? 0;
  const livingCount = (tree?.persons ?? []).filter((p) => p.is_alive).length;
  const todayStr = new Date().toLocaleDateString('mn-MN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  function buildToonoVectorSvg(): string {
    const persons = tree?.persons ?? [];
    if (!persons.length) return '';
    const byId = new Map(persons.map((p) => [p.id, p]));
    const parentsOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    for (const r of tree?.parent_child_relationships ?? []) {
      if (!byId.has(r.parent_id) || !byId.has(r.child_id)) continue;
      parentsOf.set(r.child_id, [...(parentsOf.get(r.child_id) ?? []), r.parent_id]);
      childrenOf.set(r.parent_id, [...(childrenOf.get(r.parent_id) ?? []), r.child_id]);
    }
    const spousesOf = new Map<string, string[]>();
    for (const m of tree?.marriages ?? []) {
      if (!byId.has(m.person_1_id) || !byId.has(m.person_2_id)) continue;
      spousesOf.set(m.person_1_id, [...(spousesOf.get(m.person_1_id) ?? []), m.person_2_id]);
      spousesOf.set(m.person_2_id, [...(spousesOf.get(m.person_2_id) ?? []), m.person_1_id]);
    }
    const roots = persons.filter((p) => (parentsOf.get(p.id)?.length ?? 0) === 0);
    const rootPerson =
      roots.sort((a, b) => (childrenOf.get(b.id)?.length ?? 0) - (childrenOf.get(a.id)?.length ?? 0))[0] ?? persons[0];

    type U = { p: (typeof persons)[0]; sp: (typeof persons)[0] | null; par: U | null; k: U[]; g: number; lv: number; a: number };
    const seen = new Set<string>();
    const all: U[] = [];
    const build = (p: (typeof persons)[0], par: U | null, g: number): U => {
      seen.add(p.id);
      const spId = (spousesOf.get(p.id) ?? []).find((id) => !seen.has(id));
      const sp = spId ? byId.get(spId) ?? null : null;
      if (sp) seen.add(sp.id);
      const u: U = { p, sp, par, k: [], g, lv: 1, a: 0 };
      all.push(u);
      const kids = new Set<string>([...(childrenOf.get(p.id) ?? []), ...(sp ? childrenOf.get(sp.id) ?? [] : [])]);
      kids.forEach((cid) => {
        if (!seen.has(cid) && byId.has(cid) && g < 5) u.k.push(build(byId.get(cid)!, u, g + 1));
      });
      u.lv = u.k.length ? u.k.reduce((acc, c) => acc + c.lv, 0) : 1;
      return u;
    };
    const root = build(rootPerson, null, 0);
    const outer: U[] = [];
    const place = (u: U, a0: number, a1: number) => {
      u.a = (a0 + a1) / 2;
      if (u.g > 0) outer.push(u);
      const tot = u.k.reduce((s, c) => s + c.lv, 0);
      let cur = a0;
      u.k.forEach((c) => {
        const w = ((a1 - a0) * c.lv) / Math.max(1, tot);
        place(c, cur, cur + w);
        cur += w;
      });
    };
    place(root, -180, 180);

    const maxG = Math.max(1, ...all.map((u) => u.g));
    const rad = (g: number) => (g === 0 ? 0 : 126 + (g - 1) * 96);
    const S = 2 * (rad(maxG) + 64);
    const C = S / 2;
    const xy = (u: U): [number, number] => {
      const r = rad(u.g);
      const q = (u.a * Math.PI) / 180;
      return [C + r * Math.cos(q), C + r * Math.sin(q)];
    };

    let svg = `<svg viewBox="0 0 ${S} ${S}" style="width:100%;max-width:560px;height:auto;display:block;margin:8px auto">`;
    for (let g = maxG; g >= 1; g--) {
      svg += `<circle cx="${C}" cy="${C}" r="${rad(g)}" fill="none" stroke="${palette.border}" stroke-width="${g === 1 ? 1.8 : 1.1}" stroke-dasharray="${g === 1 ? '' : '4 6'}" opacity="0.75"/>`;
    }
    for (let i = 0; i < 64; i++) {
      const q = (i * 5.625 * Math.PI) / 180;
      const r2 = rad(maxG) + 34;
      svg += `<line x1="${C + 74 * Math.cos(q)}" y1="${C + 74 * Math.sin(q)}" x2="${C + r2 * Math.cos(q)}" y2="${C + r2 * Math.sin(q)}" stroke="${palette.border}" stroke-width="0.8" opacity="0.25"/>`;
    }
    outer.forEach((u) => {
      const [x, y] = xy(u);
      const [px, py] = u.par && u.par.g > 0 ? xy(u.par) : [C, C];
      svg += `<line x1="${px}" y1="${py}" x2="${x}" y2="${y}" stroke="${palette.border}" stroke-width="2" opacity="0.85"/>`;
    });
    svg += `<circle cx="${C}" cy="${C}" r="72" fill="${palette.pageCard}" stroke="${palette.border}" stroke-width="2.6"/>`;
    const rootLabel = root.sp ? `${root.p.first_name} ⚭ ${root.sp.first_name}` : root.p.first_name;
    svg += `<text x="${C}" y="${C - 4}" text-anchor="middle" font-family="Philosopher,serif" font-weight="700" font-size="13" fill="${palette.ink}">${escapeHtml(rootLabel)}</text>`;
    svg += `<text x="${C}" y="${C + 16}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${palette.muted}">ҮНДЭС · I ҮЕ</text>`;
    outer.forEach((u) => {
      const [x, y] = xy(u);
      const r = u.g === 1 ? 22 : 17;
      const nm = u.p.first_name || '?';
      const w = Math.max(48, nm.length * 6.5 + 14);
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${u.p.gender === 'male' ? palette.border : palette.bg}" stroke="${palette.border}" stroke-width="1.8"/>`;
      svg += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-family="Philosopher,serif" font-weight="700" font-size="${u.g === 1 ? 15 : 12}" fill="${u.p.gender === 'male' ? '#fff' : palette.ink}">${escapeHtml(nm[0].toUpperCase())}</text>`;
      svg += `<rect x="${x - w / 2}" y="${y + r - 2}" width="${w}" height="17" rx="8.5" fill="${palette.pageCard}" stroke="${palette.border}" stroke-width="1.1"/>`;
      svg += `<text x="${x}" y="${y + r + 10}" text-anchor="middle" font-family="Philosopher,serif" font-weight="700" font-size="10" fill="${palette.ink}">${escapeHtml(nm)}</text>`;
    });
    return svg + '</svg>';
  }

  function buildBookHtml(autoPrint: boolean) {
    const alkhanBand = `<svg class="alkhan-band" width="100%" height="16" aria-hidden="true"><defs><pattern id="bk-alk" width="32" height="16" patternUnits="userSpaceOnUse"><path d="M2 14V2h26v10H10V6h10" fill="none" stroke="${palette.accent}" stroke-width="1.6"/></pattern></defs><rect width="100%" height="16" fill="url(#bk-alk)"/></svg>`;
    const ulziiSvg = `<svg width="46" height="46" viewBox="-24 -24 48 48" aria-hidden="true"><rect x="-15" y="-15" width="30" height="30" transform="rotate(45)" fill="none" stroke="${palette.accent}" stroke-width="2.2"/><rect x="-8" y="-8" width="16" height="16" transform="rotate(45)" fill="none" stroke="${palette.accent}" stroke-width="1.4"/><circle r="3.2" fill="${palette.accent}"/></svg>`;

    const treeChapterHtml = includeTreeDiagram
      ? `
        <section class="book-chapter">
          <div class="chapter-head">
            <span class="chapter-num">УРГИЙН МОДНЫ ЗУРАГЛАЛ · ТООНО НАРХАН</span>
            <h2>${escapeHtml(family?.name ?? '')} — Удмын Хүрд (${peopleCount} хүн)</h2>
            ${alkhanBand}
          </div>
          <div class="tree-folio-box">
            ${buildToonoVectorSvg()}
            <p style="text-align:center;font-size:12px;color:${palette.muted};margin:8px 0 0">64 уньтай Монгол гэрийн тооны бэлгэдлээр бүх үеийг төвөөс гадагш дүрсэлсэн векторын зураглал.</p>
          </div>
        </section>`
      : '';

    const timelineEvents: { year: string; label: string; kind: string }[] = [];
    for (const p of tree?.persons ?? []) {
      if (p.birth_date) {
        timelineEvents.push({ year: p.birth_date.slice(0, 4), label: `${personName(p)} мэндэлсэн`, kind: 'Төрсөн' });
      }
    }
    for (const m of tree?.marriages ?? []) {
      if (m.start_date) {
        const p1 = tree?.persons.find((x) => x.id === m.person_1_id);
        const p2 = tree?.persons.find((x) => x.id === m.person_2_id);
        if (p1 && p2) {
          timelineEvents.push({ year: m.start_date.slice(0, 4), label: `${p1.first_name} ⚭ ${p2.first_name} гал голомтоо бадраасан`, kind: 'Гэрлэлт' });
        }
      }
    }
    timelineEvents.sort((a, b) => a.year.localeCompare(b.year));

    const honoredMothers = (tree?.persons ?? [])
      .map((p) => {
        const kids = (tree?.parent_child_relationships ?? []).filter((r) => r.parent_id === p.id).length;
        const medal = getMotherGloryMedal(p.gender, kids);
        return medal ? { name: personName(p), medal } : null;
      })
      .filter(Boolean) as { name: string; medal: { title: string; subtitle: string } }[];

    const timelineAndSignHtml = includeTimelineAndSign
      ? `
        <section class="book-chapter">
          <div class="chapter-head">
            <span class="chapter-num">БҮЛЭГ IV · УДМЫН ОН ЦАГИЙН ХЭЛХЭЭ</span>
            <h2>Гэр бүлийн түүхэн он дараалал</h2>
            ${alkhanBand}
          </div>
          ${honoredMothers.length > 0 ? `<div class="honor-box"><strong>★ Алдарт эхчүүдийн хүндэтгэл:</strong> ${honoredMothers.map((h) => `${escapeHtml(h.name)} (${escapeHtml(h.medal.title)})`).join(' · ')}</div>` : ''}
          <div class="timeline-list">
            ${timelineEvents.slice(0, 24).map((ev) => `<div class="tl-row"><b>${escapeHtml(ev.year)}</b><span class="tl-kind">${escapeHtml(ev.kind)}</span><span>${escapeHtml(ev.label)}</span></div>`).join('')}
          </div>
        </section>
        <section class="book-chapter sign-page">
          <div class="chapter-head">
            <span class="chapter-num">ТӨГСГӨЛИЙН ХУУДАС · ӨВӨГ ДЭЭДСИЙН ЗАХИАС</span>
            <h2>Хойч үедээ үлдээх захиас ба гарын үсэг</h2>
            ${alkhanBand}
          </div>
          <p style="font-size:13.5px;color:${palette.muted}">Энэхүү номыг хэвлэсний дараа гэр бүлийн ахмадууд болон гишүүд өөрийн гараар ерөөл, захиас бичиж гарын үсгээ үлдээнэ.</p>
          <div class="sign-lines">
            ${Array.from({ length: 8 }, () => '<div class="sign-line"></div>').join('')}
          </div>
          <div class="sign-boxes">
            <div><span>Өрхийн тэргүүн / Ахмадын гарын үсэг</span></div>
            <div><span>Огноо, нутаг ус</span></div>
          </div>
        </section>`
      : '';

    const directoryHtml = includeDirectory
      ? `
        <section class="book-chapter">
          <div class="chapter-head">
            <span class="chapter-num">БҮЛЭГ I · УРГИЙН ШАСТИР</span>
            <h2>Удмын гишүүдийн бүрэн лавлах (${peopleCount} хүн)</h2>
            ${alkhanBand}
          </div>
          <div class="directory-grid">
            ${directoryGroups
              .map(
                (item, idx) => `
              <article class="person-entry">
                <div class="entry-top">
                  <span class="entry-index">${idx + 1}</span>
                  <div class="entry-main">
                    <strong>${escapeHtml(item.fullName)}</strong>
                    <div class="entry-life">${escapeHtml(item.life)}${item.zodiac ? ` · ${escapeHtml(item.zodiac)}` : ''}</div>
                    ${item.lineage ? `<div class="entry-lineage">${escapeHtml(item.lineage)}</div>` : ''}
                  </div>
                  ${includeMongolianScript ? `<div class="entry-mgl-script" lang="mn-Mong">${escapeHtml(item.mongolScript)}</div>` : ''}
                </div>
                ${item.parents ? `<div class="entry-meta"><span>Эцэг, эх:</span> ${escapeHtml(item.parents)}</div>` : ''}
                ${item.spouses ? `<div class="entry-meta"><span>Хань ижил:</span> ${escapeHtml(item.spouses)}</div>` : ''}
              </article>`,
              )
              .join('')}
          </div>
        </section>`
      : '';

    const storiesHtml =
      includeStories && stories.length > 0
        ? `
        <section class="book-chapter">
          <div class="chapter-head">
            <span class="chapter-num">БҮЛЭГ II · АМАН ТҮҮХ &amp; НАМТАР</span>
            <h2>Гэр бүлийн түүх ба хууч яриа (${stories.length})</h2>
            ${alkhanBand}
          </div>
          ${stories
            .map(
              (story) => `
            <article class="story-entry">
              <h3>${escapeHtml(story.title)}</h3>
              <div class="entry-meta">${escapeHtml(story.author_name)}${story.event_date ? ` · ${escapeHtml(story.event_date)}` : ''}${story.place ? ` · ${escapeHtml(story.place)}` : ''}</div>
              <p>${escapeHtml(story.excerpt)}</p>
            </article>`,
            )
            .join('')}
        </section>`
        : '';

    const memoriesHtml =
      includeMemories && memories.length > 0
        ? `
        <section class="book-chapter">
          <div class="chapter-head">
            <span class="chapter-num">БҮЛЭГ III · НАНДИН ЦОМОГ</span>
            <h2>Гэр бүлийн дурсамжуудын товчоон (${memories.length})</h2>
            ${alkhanBand}
          </div>
          <div class="directory-grid">
            ${memories
              .map(
                (mem) => `
              <article class="person-entry">
                <strong>${escapeHtml(mem.title)}</strong>
                ${mem.memory_date ? `<div class="entry-life">${escapeHtml(mem.memory_date)}</div>` : ''}
                ${mem.description ? `<p class="entry-desc">${escapeHtml(mem.description)}</p>` : ''}
              </article>`,
              )
              .join('')}
          </div>
        </section>`
        : '';

    return `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(effectiveTitle)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Philosopher:wght@400;700&family=Noto+Serif:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Noto Serif", Georgia, serif;
      background: ${palette.bg};
      color: ${palette.ink};
      line-height: 1.65;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, h3, .cover-title { font-family: "Philosopher", Georgia, serif; }
    .cover-page {
      min-height: 262mm;
      background: ${palette.coverBg};
      color: ${palette.coverInk};
      border: 4px double ${palette.accent};
      border-radius: 12px;
      padding: 22mm 18mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
      position: relative;
      page-break-after: always;
      box-shadow: inset 0 0 0 10px rgba(225, 179, 69, 0.1);
    }
    .cover-eyebrow {
      font-size: 11px;
      letter-spacing: 0.24em;
      color: ${palette.accent};
      font-weight: 700;
      margin-top: 10px;
    }
    .cover-vertical-script {
      writing-mode: vertical-lr;
      text-orientation: sideways;
      margin: 14px auto;
      font-size: 28px;
      letter-spacing: 2px;
      color: ${palette.accent};
      min-height: 110px;
      display: inline-block;
    }
    .cover-title {
      font-size: 38px;
      line-height: 1.15;
      margin: 10px 0 14px;
      color: ${palette.coverInk};
    }
    .cover-dedication {
      max-width: 460px;
      margin: 0 auto 24px;
      font-size: 15px;
      opacity: 0.9;
      font-style: italic;
    }
    .cover-stats {
      display: inline-grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 22px;
      padding: 14px 26px;
      border-top: 1px solid rgba(225, 179, 69, 0.45);
      border-bottom: 1px solid rgba(225, 179, 69, 0.45);
    }
    .cover-stats strong {
      display: block;
      font-family: "Philosopher", serif;
      font-size: 26px;
      color: ${palette.accent};
    }
    .cover-stats span { font-size: 11px; letter-spacing: 0.1em; opacity: 0.85; }
    .tamga-seal {
      display: inline-block;
      padding: 6px 16px;
      border: 2px solid ${palette.sealBg};
      background: ${palette.sealBg};
      color: #FFFBF2;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.16em;
      border-radius: 4px;
      margin-bottom: 10px;
    }
    .cover-date { font-size: 12px; opacity: 0.78; }
    .book-chapter { padding: 10mm 4mm; page-break-after: always; }
    .chapter-head { margin-bottom: 16px; }
    .chapter-num { font-size: 11px; letter-spacing: 0.16em; color: ${palette.muted}; font-weight: 700; }
    .chapter-head h2 { margin: 4px 0 8px; font-size: 26px; color: ${palette.ink}; }
    .directory-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .person-entry {
      background: ${palette.pageCard};
      border: 1.5px solid ${palette.border};
      border-radius: 10px;
      padding: 12px 14px;
      break-inside: avoid;
    }
    .entry-top { display: flex; align-items: flex-start; gap: 10px; }
    .entry-main { flex: 1; }
    .entry-index {
      width: 24px; height: 24px; border-radius: 50%;
      background: ${palette.border}; color: #fff;
      font-family: "Philosopher", serif; font-size: 12px; font-weight: 700;
      display: grid; place-items: center; flex: none;
    }
    .entry-life { font-size: 12px; color: ${palette.muted}; font-weight: 600; margin-top: 2px; }
    .entry-lineage { font-size: 11px; color: ${palette.muted}; }
    .entry-mgl-script {
      writing-mode: vertical-lr;
      font-size: 16px;
      color: ${palette.border};
      max-height: 68px;
      line-height: 1;
    }
    .entry-meta { font-size: 12px; margin-top: 6px; color: ${palette.ink}; }
    .entry-meta span { font-weight: 700; color: ${palette.muted}; }
    .entry-desc { font-size: 12.5px; margin: 6px 0 0; }
    .story-entry {
      background: ${palette.pageCard};
      border: 1.5px solid ${palette.border};
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 14px;
      break-inside: avoid;
    }
    .story-entry h3 { margin: 0 0 6px; font-size: 21px; color: ${palette.ink}; }
    .story-entry p:first-of-type::first-letter {
      font-family: "Philosopher", Georgia, serif;
      font-size: 46px;
      float: left;
      line-height: 0.88;
      padding: 4px 8px 0 0;
      color: #9E2A22;
      font-weight: 700;
    }
    .alkhan-band { display: block; opacity: 0.88; }
    .tree-folio-box { background: ${palette.pageCard}; border: 2px solid ${palette.border}; border-radius: 14px; padding: 14px; }
    .honor-box { background: ${palette.pageCard}; border-left: 4px solid ${palette.border}; padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; }
    .timeline-list { display: grid; gap: 6px; }
    .tl-row { display: grid; grid-template-columns: 60px 76px 1fr; gap: 10px; align-items: center; padding: 7px 10px; background: ${palette.pageCard}; border: 1px solid ${palette.border}; border-radius: 8px; font-size: 13px; }
    .tl-row b { font-family: "Philosopher", serif; font-size: 15px; color: ${palette.border}; }
    .tl-kind { font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: ${palette.muted}; }
    .sign-lines { margin: 22px 0 36px; display: grid; gap: 28px; }
    .sign-line { border-bottom: 1px dashed ${palette.border}; height: 1px; }
    .sign-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 40px; }
    .sign-boxes div { border-top: 1.5px solid ${palette.border}; padding-top: 8px; font-size: 12px; color: ${palette.muted}; text-align: center; }
  </style>
</head>
<body>
  <section class="cover-page">
    <div>
      ${alkhanBand}
      <div class="cover-eyebrow">ГУУЛИНГИЙНХАН · МОНГОЛ УРГИЙН ШАСТИР</div>
    </div>
    <div>
      ${ulziiSvg}
      ${includeMongolianScript ? `<div class="cover-vertical-script" lang="mn-Mong">${escapeHtml(verticalFamilyScript)}</div>` : ''}
      <h1 class="cover-title">${escapeHtml(effectiveTitle)}</h1>
      <p class="cover-dedication">${escapeHtml(dedication)}</p>
      <div class="cover-stats">
        <div><strong>${peopleCount}</strong><span>Удмын хүн</span></div>
        <div><strong>${marriageCount}</strong><span>Гэрлэлт</span></div>
        <div><strong>${livingCount}</strong><span>Энх тунх</span></div>
      </div>
    </div>
    <div>
      <div class="tamga-seal">ГУУЛИНГИЙНХАН · УРГИЙН ТАМГА</div>
      <div class="cover-date">Хэвлэсэн огноо: ${escapeHtml(todayStr)}</div>
      ${alkhanBand}
    </div>
  </section>
  ${treeChapterHtml}
  ${directoryHtml}
  ${storiesHtml}
  ${memoriesHtml}
  ${timelineAndSignHtml}
  ${autoPrint ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});</script>` : ''}
</body>
</html>`;
  }

  function openBookWindow(autoPrint: boolean) {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open();
    win.document.write(buildBookHtml(autoPrint));
    win.document.close();
  }

  return (
    <div
      className="tree-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="family-book-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="tree-modal"
        style={{ maxWidth: '820px', width: '100%', padding: '24px' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
            borderBottom: '1.5px solid var(--goldl, #EBD59A)',
            paddingBottom: '14px',
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: 'var(--gt, #7A5A17)',
                textTransform: 'uppercase',
              }}
            >
              <Sparkles size={12} style={{ display: 'inline', marginRight: 5 }} />
              ХЭВЛЭЛИЙН СТУДИ · ОЛОН ХУУДАСТАЙ УРГИЙН НОМ PDF
            </p>
            <h2 id="family-book-modal-title" style={{ margin: '4px 0 0', fontSize: '22px', color: 'var(--hd)' }}>
              📕 Бүрэн Ургийн Ном бэлтгэх
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Цонх хаах"
            style={{
              background: 'transparent',
              border: '1.5px solid var(--goldl, #EBD59A)',
              borderRadius: '50%',
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: 'var(--hd)',
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div className="book-studio-grid">
          {/* Left: Live Gilded Hardcover Preview */}
          <div
            className="book-cover-preview"
            style={{
              background: palette.coverBg,
              color: palette.coverInk,
              border: `3px double ${palette.accent}`,
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: '0.2em', color: palette.accent, fontWeight: 700 }}>
              МОНГОЛ УРГИЙН ШАСТИР
            </span>
            {includeMongolianScript && (
              <div
                style={{
                  writingMode: 'vertical-lr',
                  fontSize: 20,
                  color: palette.accent,
                  margin: '8px auto',
                  maxHeight: 84,
                }}
              >
                {verticalFamilyScript}
              </div>
            )}
            <strong
              style={{
                fontFamily: 'var(--font-philosopher), Philosopher, serif',
                fontSize: 18,
                lineHeight: 1.2,
                display: 'block',
              }}
            >
              {effectiveTitle}
            </strong>
            <span style={{ fontSize: 11, opacity: 0.85 }}>
              {peopleCount} хүн · {marriageCount} гэрлэлт
            </span>
            <span
              style={{
                display: 'inline-block',
                padding: '3px 10px',
                borderRadius: 4,
                background: palette.sealBg,
                color: '#fff',
                fontSize: 9,
                letterSpacing: '0.14em',
                fontWeight: 700,
              }}
            >
              УРГИЙН ТАМГА
            </span>
          </div>

          {/* Right: Book Controls */}
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '4px', fontSize: '13px', fontWeight: 600 }}>
              Номын гарчиг
              <input
                type="text"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                placeholder={`${family.name} — Ургийн Ном`}
                maxLength={140}
              />
            </label>

            <label style={{ display: 'grid', gap: '4px', fontSize: '13px', fontWeight: 600 }}>
              Хавтасны оршил / Өвөг дээдсийн захиас
              <textarea
                rows={2}
                value={dedication}
                onChange={(e) => setDedication(e.target.value)}
                maxLength={400}
              />
            </label>

            <div>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Хэвлэлийн загвар (4 төрөл)
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(Object.keys(THEME_PALETTE) as BookTheme[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTheme(key)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: theme === key ? '2px solid #B88A2E' : '1px solid var(--goldl, #EBD59A)',
                      background: theme === key ? 'var(--gold-soft)' : 'transparent',
                      color: 'var(--hd)',
                    }}
                  >
                    {theme === key && <Check size={12} style={{ display: 'inline', marginRight: 4 }} />}
                    {THEME_PALETTE[key].label}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                border: '1px solid var(--goldl, #EBD59A)',
                background: 'var(--bg2)',
                display: 'grid',
                gap: '6px',
              }}
            >
              <strong style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <BookOpen size={14} /> Бүлгүүд ба Бичгийн сонголт {loadingContent ? '(Ачаалж байна…)' : ''}
              </strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeMongolianScript}
                  onChange={(e) => setIncludeMongolianScript(e.target.checked)}
                />
                <Languages size={14} /> <strong>Босоо Монгол бичиг (Хүмүүн бичиг)</strong> хавтас &amp; нэрс дээр оруулах
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeTreeDiagram} onChange={(e) => setIncludeTreeDiagram(e.target.checked)} />
                <strong>Удмын Модны Зураглал</strong> (Тооно Нархан — 64 уньтай вектор зураг)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeDirectory} onChange={(e) => setIncludeDirectory(e.target.checked)} />
                Бүлэг I: Удмын гишүүдийн лавлах ({peopleCount} хүн · 12 жилтэй)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeStories} onChange={(e) => setIncludeStories(e.target.checked)} />
                Бүлэг II: Гэр бүлийн түүх ба хууч яриа ({stories.length} түүх)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeMemories} onChange={(e) => setIncludeMemories(e.target.checked)} />
                Бүлэг III: Нандин дурсамжуудын товчоон ({memories.length} дурсамж)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeTimelineAndSign} onChange={(e) => setIncludeTimelineAndSign(e.target.checked)} />
                Бүлэг IV: Түүхэн он цагийн хэлхээ, Алдарт эх &amp; Гарын үсгийн хуудас
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px', flexWrap: 'wrap' }}>
          <button type="button" className="hush-chip-btn" onClick={onClose}>
            Хаах
          </button>
          <button type="button" className="hush-chip-btn" onClick={() => openBookWindow(false)}>
            <Eye size={15} /> Урьдчилан харах
          </button>
          <button type="button" className="dash-tree-showcase__open" onClick={() => openBookWindow(true)}>
            <Printer size={15} /> Ургийн ном хэвлэх (PDF)
          </button>
        </div>
      </div>
    </div>
  );
}
