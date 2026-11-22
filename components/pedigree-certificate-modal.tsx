'use client';

import { useMemo, useRef, useState } from 'react';
import { Download, Printer, X, Shield, Award, Check } from 'lucide-react';
import { Family, FamilyStats, Person } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';

export interface PedigreeCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  family: Family | null;
  stats?: FamilyStats | null;
  people?: Person[];
  relationships?: Array<{ parent_id: string; child_id: string }>;
  founderName?: string;
}

export function PedigreeCertificateModal({
  isOpen,
  onClose,
  family,
  stats,
  people = [],
  relationships = [],
  founderName,
}: PedigreeCertificateModalProps) {
  const [recipientTitle, setRecipientTitle] = useState('Бүх үе залгамжлагчдад');
  const [certificateTheme, setCertificateTheme] = useState<'parchment' | 'emerald' | 'gold'>('parchment');
  const [showTamga, setShowTamga] = useState(true);
  const [customNote, setCustomNote] = useState(
    'Өв соёл, цусан холбоо, удмын сүлжээг үеийн үед бататган нандигнав.'
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen && Boolean(family), dialogRef, { onEscape: onClose });

  const issueDateStr = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${year} оны ${month} дугаар сарын ${day}`;
  }, []);

  const roots = useMemo(() => {
    if (founderName) return [founderName];
    if (people.length === 0) return [];

    // Identify true tree roots: parents with no incoming parent edges
    if (relationships && relationships.length > 0) {
      const childIds = new Set(relationships.map((r) => r.child_id));
      const parentIds = new Set(relationships.map((r) => r.parent_id));

      const rootPeople = people.filter((p) => parentIds.has(p.id) && !childIds.has(p.id));
      if (rootPeople.length > 0) {
        return rootPeople
          .slice(0, 4)
          .map((p) => `${p.last_name ? p.last_name + ' ' : ''}${p.first_name}`.trim())
          .filter(Boolean);
      }
    }

    // Fallback: earliest birth date
    const sortedByAge = [...people].sort((a, b) => {
      const aDate = a.birth_date ? new Date(a.birth_date).getTime() : Infinity;
      const bDate = b.birth_date ? new Date(b.birth_date).getTime() : Infinity;
      return aDate - bDate;
    });
    return sortedByAge
      .slice(0, 3)
      .map((p) => `${p.last_name ? p.last_name + ' ' : ''}${p.first_name}`.trim())
      .filter(Boolean);
  }, [founderName, people, relationships]);

  const totalCount = stats?.total_persons ?? people.length;
  const generationDepth = stats?.generation_depth && stats.generation_depth > 0 ? `${stats.generation_depth} үе` : 'Тодорхойгүй';

  if (!isOpen || !family) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="pedigree-certificate-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="certificate-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--ui-backdrop)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        overflowY: 'auto',
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="pedigree-certificate-container"
        style={{
          background: 'var(--ui-surface)',
          color: 'var(--ui-text)',
          borderRadius: '16px',
          boxShadow: 'var(--ui-shadow-modal)',
          maxWidth: '920px',
          width: '100%',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--ui-border)',
        }}
      >
        {/* Modal Toolbar Header */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 24px',
            background: 'var(--ui-surface)',
            borderBottom: '1px solid var(--ui-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Award size={22} style={{ color: 'var(--ui-accent-bright)' }} />
            <div>
              <h3 id="certificate-modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--ui-text)' }}>
                Монгол Ургийн Батламж үүсгэх
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--ui-text-muted)' }}>
                Монгол уламжлалт хэв маяг бүхий удмын сангийн дотоод дурсгалын батламж
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={handlePrint}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                background: '#17372b',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Printer size={15} /> Хэвлэх / PDF татах
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ui-text-muted)',
                padding: '6px',
                borderRadius: '6px',
              }}
              title="Хаах"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Configuration Bar */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            padding: '12px 24px',
            background: 'var(--ui-surface-subtle)',
            borderBottom: '1px solid var(--ui-border)',
            fontSize: '12.5px',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--ui-text-secondary)' }}>
            Зориулалт:
            <input
              type="text"
              value={recipientTitle}
              onChange={(e) => setRecipientTitle(e.target.value)}
              placeholder="Жишээ: Бүх үе залгамжлагчдад"
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid var(--ui-input-border)',
                background: 'var(--ui-input-bg)',
                color: 'var(--ui-input-text)',
                fontSize: '12.5px',
                width: '180px',
              }}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--ui-text-secondary)' }}>
            Уриа үг:
            <input
              type="text"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid var(--ui-input-border)',
                background: 'var(--ui-input-bg)',
                color: 'var(--ui-input-text)',
                fontSize: '12.5px',
                width: '260px',
              }}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--ui-text-secondary)' }}>
            <input
              type="checkbox"
              checked={showTamga}
              onChange={(e) => setShowTamga(e.target.checked)}
            />
            Улаан тамга оруулах
          </label>
        </div>

        {/* Printable Certificate Sheet */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '30px',
            display: 'flex',
            justifyContent: 'center',
            background: 'var(--ui-bg)',
          }}
        >
          <div
            id="pedigree-certificate-sheet"
            className="certificate-print-sheet"
            style={{
              width: '100%',
              maxWidth: '780px',
              minHeight: '1020px',
              background: '#fffef9',
              boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
              padding: '48px 56px',
              boxSizing: 'border-box',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              fontFamily: '"Times New Roman", "Baskerville", serif',
              color: '#1a2e22',
              border: '12px double #b45309',
            }}
          >
            {/* Ornate Inner Border */}
            <div
              style={{
                position: 'absolute',
                inset: '8px',
                border: '1px solid rgba(180, 83, 9, 0.4)',
                pointerEvents: 'none',
              }}
            />

            {/* Top Ornamental Header */}
            <div style={{ textAlign: 'center', position: 'relative' }}>
              <div
                style={{
                  fontFamily: '"Mongolian Bitihe", "Noto Sans Mongolian", serif',
                  fontSize: '22px',
                  lineHeight: '1.2',
                  color: '#b45309',
                  letterSpacing: '2px',
                  marginBottom: '10px',
                }}
              >
                ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠪᠠᠲᠤᠯᠠᠮᠵᠢ
              </div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '4px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: '#65776d',
                  marginBottom: '6px',
                }}
              >
                ГУУЛИНГИЙНХАН • УРГИЙН БИЧГИЙН ДУРСГАЛЫН БАТЛАМЖ
              </div>
              <h1
                style={{
                  fontSize: '34px',
                  fontWeight: 700,
                  color: '#17372b',
                  margin: '0 0 10px',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                }}
              >
                УРГИЙН БАТЛАМЖ
              </h1>
              <div
                style={{
                  width: '140px',
                  height: '2px',
                  background: 'linear-gradient(90deg, transparent, #b45309, transparent)',
                  margin: '0 auto 20px',
                }}
              />
            </div>

            {/* Certificate Body */}
            <div style={{ textAlign: 'center', margin: '20px 0', lineHeight: 1.8 }}>
              <p style={{ fontSize: '15px', color: '#4b5563', margin: '0 0 8px' }}>
                Энэхүү батламжийг хүлээн авагч:
              </p>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#0f291e',
                  fontStyle: 'italic',
                  marginBottom: '20px',
                }}
              >
                {recipientTitle}
              </div>

              <div
                style={{
                  fontSize: '16.5px',
                  color: '#1f2937',
                  maxWidth: '620px',
                  margin: '0 auto',
                  textAlign: 'justify',
                  textJustify: 'inter-word',
                  textIndent: '28px',
                }}
              >
                Монгол түмний язгуур уламжлал, удмын ухааны их соёлыг дээдлэн өвлөж буй <strong>“{family.name}”</strong> удмын ургийн сангийн бүртгэлийг албан ёсоор нягтлан баталгаажуулж, өвөг дээдсээс өнөөг хүртэл залгамжилсан үе дамжсан холбоос, ураг удмын түүхийг энэхүү батламжид мөнхлөн үлдээв.
              </div>

              {/* Family Lineage Highlights */}
              <div
                style={{
                  margin: '36px auto',
                  padding: '20px 24px',
                  background: 'rgba(23, 55, 43, 0.03)',
                  border: '1px solid rgba(180, 83, 9, 0.25)',
                  borderRadius: '10px',
                  maxWidth: '580px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '16px',
                  textAlign: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#65776d', letterSpacing: '1px' }}>
                    Нийт бүртгэгдсэн
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: '#17372b', marginTop: '4px' }}>
                    {totalCount} гишүүн
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#65776d', letterSpacing: '1px' }}>
                    Үе дамжсан гүн
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: '#17372b', marginTop: '4px' }}>
                    {generationDepth}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#65776d', letterSpacing: '1px' }}>
                    Бүртгэлийн огноо
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#17372b', marginTop: '8px' }}>
                    {issueDateStr.slice(0, 11)}
                  </div>
                </div>
              </div>

              {roots.length > 0 && (
                <div style={{ fontSize: '14px', color: '#4b5563', margin: '14px auto', maxWidth: '580px' }}>
                  <strong>Язгуур өвөг дээдэс:</strong> {roots.join(', ')}
                </div>
              )}

              <p
                style={{
                  fontSize: '15px',
                  fontStyle: 'italic',
                  color: '#78350f',
                  margin: '28px auto 0',
                  maxWidth: '560px',
                }}
              >
                “{customNote}”
              </p>
            </div>

            {/* Seal Stamp and Signatures */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                marginTop: '40px',
                paddingTop: '20px',
              }}
            >
              {/* Left Signee */}
              <div style={{ textAlign: 'center', width: '200px' }}>
                <div style={{ borderBottom: '1px solid #17372b', height: '36px', marginBottom: '6px' }} />
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#17372b' }}>
                  Ургийн сангийн тэргүүн
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                  (Гарын үсэг, нэр)
                </div>
              </div>

              {/* Center Red Seal Stamp */}
              {showTamga && (
                <div
                  style={{
                    position: 'relative',
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    border: '3px solid #dc2626',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#dc2626',
                    transform: 'rotate(-6deg)',
                    margin: '0 20px',
                    boxShadow: 'inset 0 0 0 2px #dc2626',
                    background: 'rgba(220, 38, 38, 0.02)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '8px',
                      fontWeight: 800,
                      letterSpacing: '1.5px',
                      textAlign: 'center',
                      lineHeight: 1.2,
                    }}
                  >
                    ГУУЛИНГИЙНХАН
                  </div>
                  <div
                    style={{
                      fontFamily: '"Mongolian Bitihe", "Noto Sans Mongolian", serif',
                      fontSize: '18px',
                      margin: '2px 0',
                    }}
                  >
                    ᠪᠠᠲᠤᠯᠠᠪᠠ
                  </div>
                  <div
                    style={{
                      fontSize: '8px',
                      fontWeight: 800,
                      letterSpacing: '1px',
                      borderTop: '1px solid #dc2626',
                      paddingTop: '2px',
                    }}
                  >
                    БАТЛАВ
                  </div>
                </div>
              )}

              {/* Right Issue Date */}
              <div style={{ textAlign: 'center', width: '200px' }}>
                <div style={{ borderBottom: '1px solid #17372b', height: '36px', marginBottom: '6px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontSize: '13px', fontWeight: 600 }}>
                  {issueDateStr}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#17372b' }}>
                  Олгосон огноо
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                  Улаанбаатар хот
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .pedigree-certificate-overlay {
            position: absolute !important;
            inset: 0 !important;
            background: white !important;
            padding: 0 !important;
            backdrop-filter: none !important;
          }
          .pedigree-certificate-container {
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            max-height: none !important;
          }
          .no-print {
            display: none !important;
          }
          #pedigree-certificate-sheet,
          #pedigree-certificate-sheet * {
            visibility: visible !important;
          }
          #pedigree-certificate-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            min-height: 100vh !important;
            box-shadow: none !important;
            padding: 40px !important;
          }
        }
      `}</style>
    </div>
  );
}
