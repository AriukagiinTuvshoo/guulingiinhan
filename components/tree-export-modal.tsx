'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer, Copy, Check, X, Sparkles, Sliders, Shield, FileSpreadsheet } from 'lucide-react';
import { PRINT_EXPORT_COLORS as P } from '../lib/theme-tokens';
import { Family, TreeData, TreePerson, personName } from '../lib/api';
import { AdvancedTreeLayout } from '../lib/tree-layout';
import { exportToGedcom } from '../lib/gedcom';
import { useFocusTrap } from '../lib/use-focus-trap';

export interface TreeExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  family: Family | null;
  tree: TreeData | null;
  layout: AdvancedTreeLayout;
}

type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
type FrameStyle = 'ornate' | 'traditional' | 'minimal';
type ExportTheme = 'parchment' | 'dark' | 'royal-blue';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function initials(person: Pick<TreePerson, 'first_name' | 'last_name'>) {
  return [person.last_name, person.first_name]
    .filter(Boolean)
    .map((value) => value.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function lifeSummary(person: TreePerson) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.is_alive ? `${birth} – одоо` : `${birth} – ?`;
  return 'Огноо тодорхойгүй';
}

export function TreeExportModal({
  isOpen,
  onClose,
  family,
  tree,
  layout,
}: TreeExportModalProps) {
  const [paperSize, setPaperSize] = useState<PaperSize>('A1');
  const [frameStyle, setFrameStyle] = useState<FrameStyle>('ornate');
  const [exportTheme, setExportTheme] = useState<ExportTheme>('parchment');
  const [includeTamga, setIncludeTamga] = useState(true);
  const [includeCalligraphy, setIncludeCalligraphy] = useState(true);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, dialogRef, { onEscape: onClose });

  // Generate self-contained, publication-ready vector SVG string
  const svgString = useMemo(() => {
    if (!family || !tree || !layout) return '';

    const pad = 120;
    const headerHeight = 220;
    const footerHeight = 100;
    const totalW = Math.max(layout.width + pad * 2, 1600);
    const totalH = layout.height + headerHeight + footerHeight + pad * 2;
    const offsetX = (totalW - layout.width) / 2;
    const offsetY = pad + headerHeight;

    const isDark = exportTheme === 'dark';
    const isRoyal = exportTheme === 'royal-blue';

    const bgColor = isDark ? P.darkBg : isRoyal ? P.royalBg : P.parchmentBg;
    const textColor = isDark || isRoyal ? P.darkText : P.forestInk;
    const mutedColor = isDark || isRoyal ? P.darkMuted : P.mutedInk;
    const goldColor = P.gold;
    const frameBorderColor = isDark || isRoyal ? P.goldBright : P.goldDark;
    const cardBg = isDark ? P.darkSurface : isRoyal ? P.royalSurface : P.parchmentCard;
    const cardBorder = isDark ? P.darkBorder : isRoyal ? P.royalBorder : P.parchmentBorder;

    const formattedDate = new Date().toLocaleDateString('mn-MN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let s = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">
  <defs>
    <style>
      .t-title { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; fill: ${textColor}; }
      .t-calligraphy { font-family: 'Mongolian Bitiig', 'Segoe UI Historic', 'Noto Sans Mongolian', Georgia, serif; fill: ${goldColor}; letter-spacing: 2px; }
      .t-subtitle { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; fill: ${mutedColor}; }
      .t-name { font-family: Georgia, serif; font-size: 13px; font-weight: 700; fill: ${textColor}; }
      .t-dates { font-family: sans-serif; font-size: 11px; fill: ${mutedColor}; }
      .t-meta { font-family: sans-serif; font-size: 9.5px; fill: ${mutedColor}; }
      .t-gen-lbl { font-family: Georgia, serif; font-size: 11px; font-weight: 700; fill: ${frameBorderColor}; }
      .c-parent { stroke: ${goldColor}; stroke-width: 2.2; fill: none; stroke-linecap: round; }
      .c-spouse { stroke: ${P.gold}; stroke-width: 2.2; fill: none; stroke-linecap: round; }
      .c-history { stroke: ${P.historyStroke}; stroke-width: 2; stroke-dasharray: 6 5; fill: none; }
      .m-dot { fill: ${P.goldBright}; stroke: ${cardBg}; stroke-width: 2.5; }
    </style>
    <filter id="card-shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${P.black}" flood-opacity="${isDark ? '0.35' : '0.08'}"/>
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="${totalW}" height="${totalH}" fill="${bgColor}" />
`;

    // Ornate Mongolian Ornamental Borders (Алхан хээ ба Хүрээ)
    if (frameStyle === 'ornate' || frameStyle === 'traditional') {
      const bPad = 28;
      s += `
  <!-- Outer Ornate Frame -->
  <rect x="${bPad}" y="${bPad}" width="${totalW - bPad * 2}" height="${totalH - bPad * 2}" fill="none" stroke="${goldColor}" stroke-width="3" rx="8" />
  <rect x="${bPad + 10}" y="${bPad + 10}" width="${totalW - (bPad + 10) * 2}" height="${totalH - (bPad + 10) * 2}" fill="none" stroke="${frameBorderColor}" stroke-width="1.2" stroke-dasharray="10 5" rx="6" />

  <!-- Corner Ornamental Motifs -->
  <g fill="${goldColor}">
    <rect x="${bPad + 14}" y="${bPad + 14}" width="16" height="16" />
    <rect x="${totalW - bPad - 30}" y="${bPad + 14}" width="16" height="16" />
    <rect x="${bPad + 14}" y="${totalH - bPad - 30}" width="16" height="16" />
    <rect x="${totalW - bPad - 30}" y="${totalH - bPad - 30}" width="16" height="16" />
  </g>
`;
    } else {
      s += `
  <rect x="30" y="30" width="${totalW - 60}" height="${totalH - 60}" fill="none" stroke="${cardBorder}" stroke-width="1.5" rx="8" />
`;
    }

    // Header Calligraphy & Title Section
    const centerX = totalW / 2;
    s += `
  <!-- Header Section -->
  <g transform="translate(${centerX}, 80)">
`;

    if (includeCalligraphy) {
      s += `
    <!-- Mongolian Traditional Script Urgiin Bichig -->
    <text x="0" y="24" text-anchor="middle" font-size="28" class="t-calligraphy">ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠪᠢᠴᠢᠭ</text>
`;
    }

    s += `
    <text x="0" y="${includeCalligraphy ? 75 : 45}" text-anchor="middle" font-size="34" class="t-title">${escapeXml(family.name)} Ургийн Бичиг</text>
    <text x="0" y="${includeCalligraphy ? 105 : 75}" text-anchor="middle" class="t-subtitle">Нийт ${tree.persons.length} хүн · ${tree.marriages.length} гэрлэлт · ${layout.generationsCount} үеийн түүхэн хэлхээс</text>
    <line x1="-160" y1="${includeCalligraphy ? 122 : 92}" x2="160" y2="${includeCalligraphy ? 122 : 92}" stroke="${goldColor}" stroke-width="1.5" />
    <circle cx="0" cy="${includeCalligraphy ? 122 : 92}" r="4" fill="${goldColor}" />
  </g>
`;

    // Red Seal Stamp (Төрийн тамга маягийн Монгол улаан тамга)
    if (includeTamga) {
      const sealX = totalW - pad - 120;
      const sealY = 65;
      s += `
  <!-- Red Seal Stamp (Тамга) -->
  <g transform="translate(${sealX}, ${sealY})">
    <rect x="0" y="0" width="86" height="86" fill="${P.sealRedTint}" stroke="${P.sealRed}" stroke-width="2.5" rx="4" />
    <rect x="4" y="4" width="78" height="78" fill="none" stroke="${P.sealRed}" stroke-width="1.2" rx="2" />
    <text x="43" y="28" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="12" fill="${P.sealRed}" letter-spacing="1">ГУУЛИН</text>
    <text x="43" y="48" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="12" fill="${P.sealRed}" letter-spacing="1">ГИЙНХАН</text>
    <text x="43" y="68" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="11" fill="${P.sealRed}" letter-spacing="1">БАТЛАВ</text>
  </g>
`;
    }

    // Stage translation group
    s += `
  <!-- Family Tree Layout Stage -->
  <g transform="translate(${offsetX}, ${offsetY})">
`;

    // Generation Dividers
    for (const hdr of layout.generationHeaders) {
      s += `
    <g class="gen-divider">
      <line x1="20" y1="${hdr.y + 14}" x2="${layout.width - 20}" y2="${hdr.y + 14}" stroke="${cardBorder}" stroke-dasharray="4 6" stroke-width="1.5" />
      <rect x="24" y="${hdr.y}" width="220" height="26" rx="13" fill="${cardBg}" stroke="${goldColor}" stroke-width="1.5" />
      <text x="36" y="${hdr.y + 17}" class="t-gen-lbl">${escapeXml(hdr.label)}</text>
    </g>
`;
    }

    // Connectors: Sibling buses
    for (const bus of layout.buses) {
      s += `
    <g class="connector-bus">
      <line x1="${bus.sourceX}" y1="${bus.sourceY}" x2="${bus.sourceX}" y2="${bus.busY}" class="c-parent" />
      <line x1="${bus.minChildX}" y1="${bus.busY}" x2="${bus.maxChildX}" y2="${bus.busY}" class="c-parent" />
`;
      for (const ch of bus.children) {
        s += `      <line x1="${ch.x}" y1="${bus.busY}" x2="${ch.x}" y2="${ch.y}" class="c-parent" />\n`;
      }
      s += `    </g>\n`;
    }

    // Single Parent direct curves
    for (const edge of layout.singleParentEdges) {
      s += `    <path d="${edge.path}" class="c-parent" />\n`;
    }

    // Unions & Marriage Dots
    for (const union of layout.unions) {
      const p1 = layout.nodeById.get(union.person1Id);
      const p2 = layout.nodeById.get(union.person2Id);
      if (!p1 || !p2) continue;
      const x1 = p1.x + p1.width;
      const x2 = p2.x;
      const y = union.y;
      const isHistory = union.status !== 'married';

      s += `
    <g class="union">
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="${isHistory ? 'c-history' : 'c-spouse'}" />
      <circle cx="${union.x}" cy="${union.y}" r="6.5" class="m-dot" />
    </g>
`;
    }

    // Person Node Cards
    for (const node of layout.nodes) {
      const person = node.person;
      const isMale = person.gender === 'male';
      const isFemale = person.gender === 'female';
      const genderTopColor = isMale ? P.maleAccent : isFemale ? P.femaleAccent : P.gold;
      const avatarGrad = isMale ? P.forestInk : isFemale ? P.goldDark : P.gold;

      s += `
    <!-- Person Node: ${escapeXml(personName(person))} -->
    <g transform="translate(${node.x}, ${node.y})">
      <rect width="${node.width}" height="${node.height}" rx="14" fill="${cardBg}" stroke="${cardBorder}" stroke-width="1.5" filter="url(#card-shadow)" />
      <rect width="${node.width}" height="4" rx="2" fill="${genderTopColor}" />

      <!-- Avatar Circle -->
      <circle cx="98" cy="40" r="23" fill="${avatarGrad}" stroke="${goldColor}" stroke-width="1.8" />
      <text x="98" y="46" text-anchor="middle" fill="${P.white}" font-family="Georgia, serif" font-weight="700" font-size="14">${escapeXml(initials(person))}</text>

      <!-- Person Name & Dates -->
      <text x="98" y="82" text-anchor="middle" class="t-name">${escapeXml(personName(person) || 'Нэргүй')}</text>
      <text x="98" y="100" text-anchor="middle" class="t-dates">${escapeXml(lifeSummary(person))}</text>

      <!-- Generation Badge -->
      <rect x="48" y="112" width="100" height="18" rx="9" fill="${isDark || isRoyal ? P.badgeDark : P.goldSoft}" stroke="${goldColor}" stroke-width="0.8" />
      <text x="98" y="124" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="600" fill="${isDark || isRoyal ? P.goldLight : P.goldDark}">${layout.hasConfirmedRoot ? `${node.generation}-р үе` : '?'}</text>

      ${person.lineage_name ? `
      <!-- Lineage Tag -->
      <text x="98" y="148" text-anchor="middle" class="t-meta">Овог: ${escapeXml(person.lineage_name)}</text>
      ` : ''}
    </g>
`;
    }

    s += `  </g>\n`; // close stage group

    // Footer section
    const footY = totalH - pad - 20;
    s += `
  <!-- Footer Note & Traditional Ulzii Ornament -->
  <g transform="translate(${centerX}, ${footY})">
    <text x="0" y="0" text-anchor="middle" font-size="18" fill="${goldColor}">ᠦᠯᠵᠡᠢ · ☸ · ᠥᠯᠵᠡᠢ</text>
    <text x="0" y="24" text-anchor="middle" class="t-subtitle">Гуулингийнхан Монгол Ургийн Бичгийн Системээр үүсгэв · ${formattedDate}</text>
  </g>
</svg>
`;

    return s;
  }, [family, tree, layout, exportTheme, frameStyle, includeCalligraphy, includeTamga]);

  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!isOpen || !svgString) {
      setPreviewUrl('');
      return;
    }
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isOpen, svgString]);

  if (!isOpen) return null;

  const handleDownloadSvg = () => {
    if (!svgString || !family) return;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeFamilyName = family.name.replace(/[\s/\\:*?"<>|]+/g, '_');
    link.href = url;
    link.download = `${safeFamilyName}-Urgiin-Bichig-${paperSize}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopySvg = async () => {
    if (!svgString) return;
    try {
      await navigator.clipboard.writeText(svgString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // Fallback
    }
  };

  const handlePrint = () => {
    if (!svgString) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
<!DOCTYPE html>
<html>
  <head>
    <title>${escapeXml(family?.name ?? 'Ургийн бичиг')} - Хэвлэх</title>
    <style>
      @page {
        size: landscape;
        margin: 0;
      }
      body {
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${P.white};
      }
      svg {
        width: 100vw;
        height: 100vh;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
    </style>
  </head>
  <body>
    ${svgString}
    <script>
      window.onload = function() {
        setTimeout(function() {
          window.print();
          window.close();
        }, 500);
      };
    </script>
  </body>
</html>
    `);
    printWindow.document.close();
  };

  return (
    <div
      className="tree-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="tree-export-modal"
        style={{ width: 'min(980px, 95vw)', maxHeight: '92vh' }}
      >
        <header className="tree-export-header">
          <div className="tree-export-header-title">
            <span className="tree-export-badge">
              <Sparkles size={14} /> ВЕКТОР ЭКСПОРТ &amp; ХАНАНЫ ХЭВЛЭЛ
            </span>
            <h2 id="export-modal-title">Ургийн бичгийн хэвлэлийн эх бэлтгэл</h2>
            <p>Ургийн модоо хананд өлгөх хэмжээний өндөр нарийвчлалтай вектор (SVG/PDF) хэлбэрээр экспортлох.</p>
          </div>
          <button
            type="button"
            className="tree-modal-close"
            onClick={onClose}
            aria-label="Хаах"
          >
            <X size={18} />
          </button>
        </header>

        <div className="tree-export-body">
          {/* Settings Sidebar */}
          <aside className="tree-export-controls">
            <h3><Sliders size={15} /> Хэвлэлийн тохиргоо</h3>

            <div className="tree-export-field">
              <label>Хэвлэх хэмжээ (Цаасны стандарт)</label>
              <div className="tree-export-chip-group">
                {(['A0', 'A1', 'A2', 'A3', 'A4'] as PaperSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`tree-export-chip ${paperSize === size ? 'is-active' : ''}`}
                    onClick={() => setPaperSize(size)}
                  >
                    <strong>{size}</strong>
                    <small>{size === 'A0' ? 'Ханын том' : size === 'A1' ? 'Стандарт хана' : size === 'A4' ? 'Жижиг' : 'Дунд'}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="tree-export-field">
              <label>Хүрээний чимэглэл</label>
              <div className="tree-export-select-row">
                <button
                  type="button"
                  className={`tree-export-chip ${frameStyle === 'ornate' ? 'is-active' : ''}`}
                  onClick={() => setFrameStyle('ornate')}
                >
                  Алхан хээтэй
                </button>
                <button
                  type="button"
                  className={`tree-export-chip ${frameStyle === 'traditional' ? 'is-active' : ''}`}
                  onClick={() => setFrameStyle('traditional')}
                >
                  Уламжлалт
                </button>
                <button
                  type="button"
                  className={`tree-export-chip ${frameStyle === 'minimal' ? 'is-active' : ''}`}
                  onClick={() => setFrameStyle('minimal')}
                >
                  Минимал
                </button>
              </div>
            </div>

            <div className="tree-export-field">
              <label>Өнгөний сонголт</label>
              <div className="tree-export-select-row">
                <button
                  type="button"
                  className={`tree-export-chip ${exportTheme === 'parchment' ? 'is-active' : ''}`}
                  onClick={() => setExportTheme('parchment')}
                >
                  Нарлаг шаазан
                </button>
                <button
                  type="button"
                  className={`tree-export-chip ${exportTheme === 'dark' ? 'is-active' : ''}`}
                  onClick={() => setExportTheme('dark')}
                >
                  Хаш хар
                </button>
                <button
                  type="button"
                  className={`tree-export-chip ${exportTheme === 'royal-blue' ? 'is-active' : ''}`}
                  onClick={() => setExportTheme('royal-blue')}
                >
                  Хөх торго
                </button>
              </div>
            </div>

            <div className="tree-export-switches">
              <label className="tree-export-switch">
                <input
                  type="checkbox"
                  checked={includeCalligraphy}
                  onChange={(e) => setIncludeCalligraphy(e.target.checked)}
                />
                <span>ᠮᠣᠩᠭᠣᠯ Монгол бичгийн хос гарчиг</span>
              </label>

              <label className="tree-export-switch">
                <input
                  type="checkbox"
                  checked={includeTamga}
                  onChange={(e) => setIncludeTamga(e.target.checked)}
                />
                <span><Shield size={13} style={{ display: 'inline', verticalAlign: '-1px' }} /> Баталгаажуулалтын улаан тамга</span>
              </label>
            </div>

            <div className="tree-export-actions">
              <button
                type="button"
                className="tree-button tree-button--primary tree-export-primary-btn"
                onClick={handleDownloadSvg}
              >
                <Download size={16} /> Вектор татах (.SVG)
              </button>

              <button
                type="button"
                className="tree-button tree-button--secondary"
                onClick={handlePrint}
              >
                <Printer size={16} /> Хэвлэх (PDF / Print)
              </button>

              <button
                type="button"
                className="tree-button tree-button--secondary"
                onClick={() => {
                  if (!family || !tree) return;
                  const gedString = exportToGedcom(
                    family.name,
                    tree.persons,
                    tree.parent_child_relationships,
                    tree.marriages
                  );
                  const blob = new Blob([gedString], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${family.name.replace(/\s+/g, '_')}_uragiin_bichig.ged`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <FileSpreadsheet size={16} /> GEDCOM (.GED) татах
              </button>

              <button
                type="button"
                className="tree-button tree-button--secondary"
                onClick={handleCopySvg}
              >
                {copied ? <Check size={16} color="var(--ui-success-text)" /> : <Copy size={16} />}
                {copied ? 'Хуулагдлаа!' : 'SVG код хуулах'}
              </button>
            </div>
          </aside>

          {/* Live Preview Pane */}
          <main className="tree-export-preview-pane">
            <div className="tree-export-preview-meta">
              <span>Хэмжээ: <strong>{paperSize}</strong> ({paperSize === 'A0' ? '841 × 1189 мм' : paperSize === 'A1' ? '594 × 841 мм' : 'Стандарт'})</span>
              <span>Формат: <strong>Вектор (Infinite resolution)</strong></span>
            </div>

            <div className="tree-export-preview-frame">
              <div className="tree-export-svg-container">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={`${family?.name ?? 'Ургийн бичиг'} ургийн бичгийн загвар`}
                    style={{ display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto' }}
                  />
                ) : null}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
