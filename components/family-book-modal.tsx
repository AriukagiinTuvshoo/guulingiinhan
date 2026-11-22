'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Printer, X, Check, Sparkles } from 'lucide-react';
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

export interface FamilyBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  family: Family | null;
  tree: TreeData | null;
}

type BookTheme = 'parchment' | 'emerald' | 'gold';

const THEME_PALETTE: Record<
  BookTheme,
  { bg: string; coverBg: string; coverInk: string; accent: string; border: string; ink: string; muted: string }
> = {
  parchment: {
    bg: '#fcf8ee',
    coverBg: '#103428',
    coverInk: '#fbf4e2',
    accent: '#c49635',
    border: '#d6c5a0',
    ink: '#1a3328',
    muted: '#5d6e65',
  },
  emerald: {
    bg: '#f5fbf8',
    coverBg: '#0b2a20',
    coverInk: '#eefaf3',
    accent: '#2a9d6f',
    border: '#b8d9ca',
    ink: '#103326',
    muted: '#4d6b5e',
  },
  gold: {
    bg: '#fffdf7',
    coverBg: '#3a260a',
    coverInk: '#fff5d9',
    accent: '#d49a24',
    border: '#e5cd92',
    ink: '#2d1f0a',
    muted: '#735b33',
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
  const [theme, setTheme] = useState<BookTheme>('parchment');
  const [includeDirectory, setIncludeDirectory] = useState(true);
  const [includeStories, setIncludeStories] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [stories, setStories] = useState<StoryListItem[]>([]);
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen && Boolean(family), dialogRef, { onEscape: onClose });

  useEffect(() => {
    if (!isOpen || !family) return;
    let active = true;
    const controller = new AbortController();
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
        return {
          id: person.id,
          fullName: personName(person),
          life: lifeRange(person.birth_date, person.death_date, person.is_alive),
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

  function handlePrintBook() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const directoryHtml = includeDirectory
      ? `
        <section class="book-chapter">
          <div class="chapter-head">
            <span class="chapter-num">БҮЛЭГ I</span>
            <h2>Удмын гишүүдийн бүрэн лавлах (${peopleCount} хүн)</h2>
          </div>
          <div class="directory-grid">
            ${directoryGroups
              .map(
                (item, idx) => `
              <article class="person-entry">
                <div class="entry-top">
                  <span class="entry-index">${idx + 1}</span>
                  <div>
                    <strong>${escapeHtml(item.fullName)}</strong>
                    <div class="entry-life">${escapeHtml(item.life)}${item.lineage ? ` · ${escapeHtml(item.lineage)}` : ''}</div>
                  </div>
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
            <span class="chapter-num">БҮЛЭГ II</span>
            <h2>Гэр бүлийн түүх ба хууч яриа (${stories.length})</h2>
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
            <span class="chapter-num">БҮЛЭГ III</span>
            <h2>Нандин дурсамжуудын товчоон (${memories.length})</h2>
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

    printWindow.document.open();
    printWindow.document.write(`<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(effectiveTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: ${palette.bg};
      color: ${palette.ink};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .cover-page {
      min-height: 256mm;
      background: ${palette.coverBg};
      color: ${palette.coverInk};
      border: 4px double ${palette.accent};
      border-radius: 10px;
      padding: 28mm 20mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
      page-break-after: always;
    }
    .cover-script {
      font-size: 16px;
      letter-spacing: 3px;
      color: ${palette.accent};
      margin-bottom: 12px;
    }
    .cover-eyebrow {
      font-size: 11px;
      letter-spacing: 4px;
      text-transform: uppercase;
      opacity: 0.8;
    }
    .cover-title {
      font-size: 34px;
      line-height: 1.25;
      margin: 18px 0 14px;
      color: ${palette.coverInk};
    }
    .cover-dedication {
      max-width: 44ch;
      margin: 0 auto;
      font-size: 15px;
      line-height: 1.7;
      opacity: 0.9;
      font-style: italic;
    }
    .cover-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      max-width: 420px;
      margin: 26px auto;
      padding: 14px;
      border: 1px solid ${palette.accent};
      border-radius: 10px;
    }
    .cover-stats strong { display: block; font-size: 24px; color: ${palette.accent}; }
    .cover-stats span { font-size: 11px; opacity: 0.85; }
    .tamga-seal {
      display: inline-block;
      margin: 0 auto;
      padding: 10px 18px;
      border: 2px solid #c53030;
      color: #f8b4b4;
      font-weight: 700;
      letter-spacing: 2px;
      font-size: 12px;
      border-radius: 6px;
    }
    .cover-date { font-size: 12px; opacity: 0.78; margin-top: 12px; }
    .book-chapter { page-break-before: always; padding-top: 4mm; }
    .chapter-head {
      border-bottom: 2px solid ${palette.accent};
      padding-bottom: 8px;
      margin-bottom: 14px;
    }
    .chapter-num {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 3px;
      color: ${palette.accent};
    }
    .chapter-head h2 { margin: 4px 0 0; font-size: 20px; }
    .directory-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .person-entry, .story-entry {
      border: 1px solid ${palette.border};
      border-radius: 8px;
      padding: 10px 12px;
      background: #ffffff;
      break-inside: avoid;
      margin-bottom: 8px;
    }
    .entry-top { display: flex; gap: 8px; align-items: flex-start; }
    .entry-index {
      width: 22px; height: 22px; border-radius: 50%;
      background: ${palette.coverBg}; color: ${palette.coverInk};
      font-size: 11px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .entry-life, .entry-meta { font-size: 11px; color: ${palette.muted}; margin-top: 3px; }
    .entry-meta span { font-weight: 700; color: ${palette.ink}; }
    .entry-desc, .story-entry p { font-size: 12px; line-height: 1.55; margin: 6px 0 0; }
    .story-entry h3 { margin: 0 0 4px; font-size: 15px; }
  </style>
</head>
<body>
  <section class="cover-page">
    <div>
      <div class="cover-script">ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠨᠣᠮ</div>
      <div class="cover-eyebrow">ГУУЛИНГИЙНХАН · ӨВ УЛАМЖЛАЛЫН САН</div>
    </div>
    <div>
      <h1 class="cover-title">${escapeHtml(effectiveTitle)}</h1>
      <p class="cover-dedication">${escapeHtml(dedication)}</p>
      <div class="cover-stats">
        <div><strong>${peopleCount}</strong><span>Удмын хүн</span></div>
        <div><strong>${marriageCount}</strong><span>Гэрлэлт</span></div>
        <div><strong>${livingCount}</strong><span>Энх тунх</span></div>
      </div>
    </div>
    <div>
      <div class="tamga-seal">ГУУЛИНГИЙНХАН · БАТАЛГААЖУУЛАВ</div>
      <div class="cover-date">Хэвлэсэн огноо: ${escapeHtml(todayStr)}</div>
    </div>
  </section>
  ${directoryHtml}
  ${storiesHtml}
  ${memoriesHtml}
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`);
    printWindow.document.close();
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
        style={{ maxWidth: '680px', width: '100%', padding: '24px' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-subtle, #e2d8c5)',
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
                color: '#b47c18',
                textTransform: 'uppercase',
              }}
            >
              <Sparkles size={12} style={{ display: 'inline', marginRight: 5 }} />
              ХЭВЛЭЛИЙН СТУДИ · ОЛОН ХУУДАСТАЙ PDF
            </p>
            <h2 id="family-book-modal-title" style={{ margin: '4px 0 0', fontSize: '21px' }}>
              📕 Бүрэн Ургийн Ном бэлтгэх
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Цонх хаах"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle, #d5c8b2)',
              borderRadius: '50%',
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: '14px' }}>
          <label style={{ display: 'grid', gap: '5px', fontSize: '13px', fontWeight: 600 }}>
            Номын гарчиг
            <input
              type="text"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder={`${family.name} — Ургийн Ном`}
              maxLength={140}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle, #d5c8b2)',
                fontSize: '14px',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '5px', fontSize: '13px', fontWeight: 600 }}>
            Хавтасны оршил / Өвөг дээдсийн захиас
            <textarea
              rows={2}
              value={dedication}
              onChange={(e) => setDedication(e.target.value)}
              maxLength={400}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle, #d5c8b2)',
                fontSize: '13.5px',
                fontFamily: 'inherit',
              }}
            />
          </label>

          <div>
            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Хэвлэлийн загвар
            </span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(
                [
                  ['parchment', '📜 Нарлаг шаазан'],
                  ['emerald', '🌲 Хаш ногоон'],
                  ['gold', '👑 Алтан хээт'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTheme(key)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '999px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: theme === key ? '2px solid #c49635' : '1px solid var(--border-subtle, #d5c8b2)',
                    background: theme === key ? 'rgba(196, 150, 53, 0.14)' : 'transparent',
                  }}
                >
                  {theme === key && <Check size={12} style={{ display: 'inline', marginRight: 4 }} />}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle, #e2d8c5)',
              background: 'rgba(196, 150, 53, 0.06)',
              display: 'grid',
              gap: '8px',
            }}
          >
            <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookOpen size={15} /> Номонд орох бүлгүүд {loadingContent ? '(Ачаалж байна…)' : ''}
            </strong>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeDirectory}
                onChange={(e) => setIncludeDirectory(e.target.checked)}
              />
              Бүлэг I: Удмын гишүүдийн бүрэн лавлах ({peopleCount} хүн)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeStories}
                onChange={(e) => setIncludeStories(e.target.checked)}
              />
              Бүлэг II: Гэр бүлийн түүх ба хууч яриа ({stories.length} түүх)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeMemories}
                onChange={(e) => setIncludeMemories(e.target.checked)}
              />
              Бүлэг III: Нандин дурсамжуудын товчоон ({memories.length} дурсамж)
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <button type="button" className="tree-button tree-button--secondary" onClick={onClose}>
              Хаах
            </button>
            <button
              type="button"
              className="tree-button tree-button--primary"
              onClick={handlePrintBook}
              style={{
                background: 'linear-gradient(135deg, #104535, #0a2d22)',
                color: '#fbf4e2',
                border: '1px solid #c49635',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                fontWeight: 700,
              }}
            >
              <Printer size={15} /> Ургийн ном хэвлэх (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
