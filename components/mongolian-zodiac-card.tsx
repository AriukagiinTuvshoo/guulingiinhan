'use client';

import { Award, Compass, Sparkles } from 'lucide-react';
import {
  computeMongolianZodiac,
  getMotherGloryMedal,
  SUUDAL_MEANINGS,
  SUUDAL_WHEEL,
  toMongolianGenitive,
  toTraditionalMongolianScript,
} from '../lib/mongolian-zodiac';

interface MongolianZodiacCardProps {
  firstName: string;
  lastName?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  isAlive?: boolean;
  childrenCount?: number;
}

export default function MongolianZodiacCard({
  firstName,
  lastName,
  birthDate,
  gender,
  isAlive = true,
  childrenCount = 0,
}: MongolianZodiacCardProps) {
  const zodiac = computeMongolianZodiac(birthDate, gender);
  const medal = getMotherGloryMedal(gender, childrenCount);
  const mongolScript = toTraditionalMongolianScript(firstName);
  const genitive = toMongolianGenitive(lastName || firstName);

  if (!zodiac && !medal && !mongolScript) return null;

  const activeIdx = zodiac ? SUUDAL_WHEEL.indexOf(zodiac.suudal) : -1;

  return (
    <section className="card profile-card" aria-label="Монгол уламжлалт хувийн карт">
      <div className="profile-card-heading">
        <div>
          <p className="eyebrow">МОНГОЛ УЛАМЖЛАЛ · ХУВИЙН КАРТ</p>
          <h2>Билгийн тоолол &amp; Суудал</h2>
        </div>
        {mongolScript && (
          <div
            title={`Монгол бичгээр: ${firstName}`}
            style={{
              writingMode: 'vertical-lr',
              textOrientation: 'upright',
              fontFamily: '"Noto Sans Mongolian", "Mongolian Baiti", serif',
              fontSize: '20px',
              lineHeight: 1.2,
              color: 'var(--ui-accent-text, #8a6a27)',
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid var(--ui-accent-border, #d8cda9)',
              background: 'var(--ui-accent-soft, #faf5e8)',
              minHeight: '56px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {mongolScript}
          </div>
        )}
      </div>

      {medal && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 14px',
            marginBottom: '14px',
            borderRadius: '10px',
            border: '1px solid var(--ui-accent-border, #d7c093)',
            background: 'var(--ui-accent-soft, #f3e9d4)',
            color: 'var(--ui-accent-text, #7a5920)',
          }}
        >
          <Award size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ display: 'block', fontSize: '13.5px' }}>{medal.title}</strong>
            <span style={{ fontSize: '12px', opacity: 0.9 }}>{medal.subtitle}</span>
          </div>
        </div>
      )}

      {zodiac ? (
        <div style={{ display: 'grid', gap: '14px' }}>
          {/* Lunar Zodiac Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid var(--ui-border, #e2d9c8)',
              background: 'var(--ui-surface-subtle, #faf6ee)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={18} style={{ color: 'var(--ui-accent, #9a7432)', flexShrink: 0 }} aria-hidden="true" />
              <div>
                <strong style={{ display: 'block', fontSize: '14px', color: 'var(--ui-text, #1f1c18)' }}>
                  {zodiac.zodiacFull}
                </strong>
                <span style={{ fontSize: '12px', color: 'var(--ui-text-secondary, #4a433a)' }}>
                  {zodiac.birthYear} оны билгийн жил · {zodiac.element} махбод
                  {isAlive ? ` · Билгийн нас ${zodiac.lunarAge}` : ''}
                </span>
              </div>
            </div>
            {genitive && (
              <span
                style={{
                  fontSize: '11.5px',
                  fontWeight: 600,
                  padding: '4px 9px',
                  borderRadius: '6px',
                  border: '1px solid var(--ui-border, #ddd2be)',
                  color: 'var(--ui-text-muted, #736a5d)',
                  whiteSpace: 'nowrap',
                }}
              >
                Тийн ялгал: {genitive}
              </span>
            )}
          </div>

          {/* 8-Trigram Suudal Compass Wheel */}
          {isAlive && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '124px minmax(0, 1fr)',
                gap: '16px',
                alignItems: 'center',
                padding: '14px',
                borderRadius: '10px',
                border: '1px solid var(--ui-border, #e2d9c8)',
                background: 'var(--ui-surface-subtle, #faf6ee)',
              }}
            >
              <svg
                viewBox="0 0 120 120"
                width="120"
                height="120"
                role="img"
                aria-label={`Суудлын хүрд: ${zodiac.suudal}`}
                style={{ display: 'block', margin: '0 auto' }}
              >
                <circle cx="60" cy="60" r="54" fill="none" stroke="var(--ui-border-strong, #c5b69c)" strokeWidth="1" />
                <circle cx="60" cy="60" r="24" fill="var(--ui-surface, #fffdf9)" stroke="var(--ui-accent-border, #d7c093)" strokeWidth="1.2" />
                {SUUDAL_WHEEL.map((seat, idx) => {
                  const startAngle = ((idx * 45 - 112.5) * Math.PI) / 180;
                  const endAngle = (((idx + 1) * 45 - 112.5) * Math.PI) / 180;
                  const midAngle = (startAngle + endAngle) / 2;
                  const rOut = 54;
                  const rIn = 24;
                  const x1 = 60 + rOut * Math.cos(startAngle);
                  const y1 = 60 + rOut * Math.sin(startAngle);
                  const x2 = 60 + rOut * Math.cos(endAngle);
                  const y2 = 60 + rOut * Math.sin(endAngle);
                  const x3 = 60 + rIn * Math.cos(endAngle);
                  const y3 = 60 + rIn * Math.sin(endAngle);
                  const x4 = 60 + rIn * Math.cos(startAngle);
                  const y4 = 60 + rIn * Math.sin(startAngle);
                  const isActive = idx === activeIdx;
                  const lx = 60 + 39 * Math.cos(midAngle);
                  const ly = 60 + 39 * Math.sin(midAngle);
                  return (
                    <g key={seat}>
                      <path
                        d={`M ${x1} ${y1} A ${rOut} ${rOut} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 0 0 ${x4} ${y4} Z`}
                        fill={isActive ? 'var(--ui-primary, #1e3d2f)' : 'transparent'}
                        stroke="var(--ui-border, #ddd2be)"
                        strokeWidth="0.9"
                      />
                      <text
                        x={lx}
                        y={ly}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="7.2"
                        fontWeight={isActive ? '700' : '500'}
                        fill={isActive ? 'var(--ui-primary-contrast, #faf6ee)' : 'var(--ui-text-secondary, #4a433a)'}
                      >
                        {seat.slice(0, 5)}
                      </text>
                    </g>
                  );
                })}
                <text
                  x="60"
                  y="56"
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="700"
                  fill="var(--ui-text, #1f1c18)"
                >
                  {zodiac.lunarAge}
                </text>
                <text
                  x="60"
                  y="68"
                  textAnchor="middle"
                  fontSize="7"
                  fill="var(--ui-text-muted, #736a5d)"
                >
                  нас
                </text>
              </svg>

              <div style={{ display: 'grid', gap: '5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Compass size={15} style={{ color: 'var(--ui-accent, #9a7432)' }} aria-hidden="true" />
                  <strong style={{ fontSize: '15px', color: 'var(--ui-text, #1f1c18)' }}>
                    {zodiac.suudal} суудал
                  </strong>
                  <span style={{ fontSize: '11.5px', color: 'var(--ui-accent-text, #7a5920)', fontWeight: 600 }}>
                    ({SUUDAL_MEANINGS[zodiac.suudal].direction})
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.55, color: 'var(--ui-text-secondary, #4a433a)' }}>
                  {zodiac.suudalExplanation} {SUUDAL_MEANINGS[zodiac.suudal].note}.
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--ui-text-muted, #736a5d)' }}>
                  Ирэх Цагаан сараас: <strong>{zodiac.nextSuudal} суудал</strong> · Энэ жил: {zodiac.currentYearZodiac}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="profile-note">
          Төрсөн огноо оруулснаар Билгийн тоолол (12 жил) болон 8 Суудлын хүрд автоматаар тооцогдоно.
        </p>
      )}
    </section>
  );
}
