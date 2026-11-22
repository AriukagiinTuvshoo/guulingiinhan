'use client';

import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { Sparkles, Sun, Moon, TreeDeciduous } from 'lucide-react';
import '../app/living-tree-auth.css';

interface LivingTreeAuthPortalProps {
  mode: 'login' | 'register';
  regionLabel: string;
  headline: string;
  subcopy: string;
  children: ReactNode;
}

const FIREFLIES = [
  { left: '18%', top: '62%', delay: '0s', duration: '5.2s' },
  { left: '34%', top: '42%', delay: '0.9s', duration: '6.1s' },
  { left: '52%', top: '28%', delay: '1.7s', duration: '5.6s' },
  { left: '68%', top: '46%', delay: '0.4s', duration: '4.9s' },
  { left: '78%', top: '66%', delay: '2.1s', duration: '6.4s' },
  { left: '28%', top: '74%', delay: '1.3s', duration: '5.8s' },
  { left: '60%', top: '20%', delay: '2.6s', duration: '5.0s' },
  { left: '44%', top: '56%', delay: '0.6s', duration: '6.2s' },
];

export default function LivingTreeAuthPortal({
  mode,
  regionLabel,
  headline,
  subcopy,
  children,
}: LivingTreeAuthPortalProps) {
  const [isLit, setIsLit] = useState(true);
  const [isPulling, setIsPulling] = useState(false);

  function toggleBranchLight() {
    setIsPulling(true);
    setIsLit((prev) => !prev);
    window.setTimeout(() => setIsPulling(false), 520);
  }

  return (
    <main className="living-auth-shell" data-lit={isLit ? 'true' : 'false'}>
      <div className="living-auth-stars" aria-hidden="true" />

      <section className="living-auth-frame" aria-label={regionLabel}>
        {/* Left Interactive Living Heritage Tree */}
        <div className="living-tree-stage">
          <div className="living-tree-topbar">
            <Link href="/" className="living-brand-link" aria-label="Нүүр хуудас">
              <span className="living-brand-mark">
                <TreeDeciduous size={22} />
              </span>
              <span>
                <strong>ГУУЛИНГИЙНХАН</strong>
                <small>Миний удам · Манай түүх</small>
              </span>
            </Link>
            <Link href="/" className="living-home-back">
              ← Нүүр
            </Link>
          </div>

          <div className="living-tree-canvas">
            <div className="living-tree-halo" aria-hidden="true" />

            <div className="living-fireflies" aria-hidden="true">
              {FIREFLIES.map((fly, index) => (
                <span
                  key={index}
                  className="living-firefly"
                  style={{
                    left: fly.left,
                    top: fly.top,
                    animationDelay: fly.delay,
                    animationDuration: fly.duration,
                  }}
                />
              ))}
            </div>

            <svg
              className="living-tree-svg"
              viewBox="0 0 560 500"
              role="img"
              aria-label="Гэрэлтдэг удмын мод"
            >
              <defs>
                <linearGradient id="living-trunk-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#123026" />
                  <stop offset="50%" stopColor="#1e4a3b" />
                  <stop offset="100%" stopColor="#0b2019" />
                </linearGradient>
                <radialGradient id="living-canopy-grad" cx="50%" cy="42%" r="55%">
                  <stop offset="0%" stopColor="#2f7d5d" />
                  <stop offset="65%" stopColor="#174c39" />
                  <stop offset="100%" stopColor="#0d2f23" />
                </radialGradient>
                <linearGradient id="living-gold-vein" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0%" stopColor="#b57c18" />
                  <stop offset="50%" stopColor="#f5d070" />
                  <stop offset="100%" stopColor="#fff1bf" />
                </linearGradient>
              </defs>

              {/* Soft Ground Mound */}
              <ellipse cx="270" cy="456" rx="190" ry="22" fill="rgba(14, 46, 35, 0.72)" />
              <ellipse cx="270" cy="456" rx="126" ry="12" fill="rgba(212, 175, 55, 0.16)" />

              {/* Layered Heritage Canopy */}
              <g className="living-canopy-layer">
                <circle cx="270" cy="186" r="118" fill="url(#living-canopy-grad)" opacity="0.86" />
                <circle cx="176" cy="212" r="82" fill="url(#living-canopy-grad)" opacity="0.82" />
                <circle cx="366" cy="208" r="86" fill="url(#living-canopy-grad)" opacity="0.84" />
                <circle cx="222" cy="128" r="74" fill="#23664c" opacity="0.72" />
                <circle cx="324" cy="126" r="72" fill="#23664c" opacity="0.72" />
                <circle cx="272" cy="96" r="62" fill="#2f7d5d" opacity="0.65" />
              </g>

              {/* Ancient Trunk & Spreading Branches */}
              <path
                d="M244 452 C248 390 250 330 246 270 C222 246 184 232 146 218 C178 220 218 228 248 242 C246 200 236 168 214 136 C242 158 258 188 264 218 C272 180 288 148 318 124 C298 158 286 196 284 236 C318 222 362 214 414 216 C366 232 322 246 290 266 C288 326 292 388 302 452 C282 444 260 444 244 452 Z"
                fill="url(#living-trunk-grad)"
              />

              {/* Golden Glowing Sap Veins (animate on toggle!) */}
              <path
                className="living-sap-vein"
                d="M270 448 C270 380 268 310 268 246 C268 194 282 156 312 128"
                fill="none"
                stroke="url(#living-gold-vein)"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              <path
                className="living-sap-vein"
                d="M268 262 C236 244 196 230 152 218"
                fill="none"
                stroke="url(#living-gold-vein)"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                className="living-sap-vein"
                d="M270 256 C318 238 368 224 426 218"
                fill="none"
                stroke="url(#living-gold-vein)"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
              <path
                className="living-sap-vein"
                d="M264 226 C252 184 236 156 216 138"
                fill="none"
                stroke="url(#living-gold-vein)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />

              {/* Shimmering Golden Heritage Blossoms */}
              <g>
                <circle className="living-leaf-spark" cx="182" cy="182" r="4.5" fill="#f7d87c" />
                <circle className="living-leaf-spark" cx="232" cy="116" r="5" fill="#ffe8a3" />
                <circle className="living-leaf-spark" cx="316" cy="114" r="4.8" fill="#f7d87c" />
                <circle className="living-leaf-spark" cx="372" cy="176" r="5.2" fill="#ffe8a3" />
                <circle className="living-leaf-spark" cx="272" cy="78" r="5.5" fill="#fff1c4" />
                <circle className="living-leaf-spark" cx="146" cy="216" r="4.2" fill="#f4cf72" />
                <circle className="living-leaf-spark" cx="342" cy="156" r="3.8" fill="#f7d87c" />
              </g>
            </svg>

            {/* Interactive Clickable Hanging Golden Branch Trigger */}
            <button
              type="button"
              className={`living-branch-trigger${isPulling ? ' is-pulling' : ''}`}
              onClick={toggleBranchLight}
              aria-pressed={isLit}
              aria-label={
                isLit
                  ? 'Алтан мөчир дээр дарж гэрлээ унтраан нэвтрэх хэсгийг нуух'
                  : 'Алтан мөчир дээр дарж модоо гэрэлтүүлэн нэвтрэх хэсгийг нээх'
              }
            >
              <span className="living-branch-cord" aria-hidden="true" />
              <span className="living-branch-lantern" aria-hidden="true">
                {isLit ? <Sun size={20} /> : <Moon size={19} />}
              </span>
              <span className="living-branch-hint">
                {isLit ? '✨ Мөчир дарах (Унтраах)' : '🌿 Мөчир дарж асаах'}
              </span>
            </button>
          </div>

          <div className="living-tree-caption">
            <span className="living-script" aria-hidden="true">
              ᠮᠣᠩᠭᠣᠯ ᠤᠷᠤᠭ ᠤᠨ ᠪᠢᠴᠢᠭ
            </span>
            <h1>{headline}</h1>
            <p>{subcopy}</p>
          </div>
        </div>

        {/* Right Column: Glassmorphic Auth Card (Illuminated by the Tree!) */}
        <div className="living-auth-panel-wrap">
          <div className={`living-dimmed-prompt${!isLit ? ' is-visible' : ''}`} aria-hidden={isLit}>
            <Sparkles size={32} color="#f4cf72" />
            <h2>Удмын модны гэрлээ асаана уу</h2>
            <p>
              Зүүн талын алтан мөчир эсвэл доорх товч дээр дарахад мод гэрэлтэж, нэвтрэх болон
              бүртгүүлэх хэсэг нээгдэнэ.
            </p>
            <button type="button" className="living-relight-btn" onClick={toggleBranchLight}>
              <Sun size={16} /> Мөчир дарж гэрэл асаах
            </button>
          </div>

          <div className={`living-auth-card${!isLit ? ' is-hidden' : ''}`} aria-hidden={!isLit}>
            <div className="living-auth-card-top">
              <div className="living-auth-mode-pill" role="navigation" aria-label="Нэвтрэх эсвэл бүртгүүлэх">
                <Link href="/login" className={mode === 'login' ? 'is-active' : ''}>
                  Нэвтрэх
                </Link>
                <Link href="/register" className={mode === 'register' ? 'is-active' : ''}>
                  Бүртгүүлэх
                </Link>
              </div>
              <button
                type="button"
                className="living-light-toggle-mini"
                onClick={toggleBranchLight}
                title="Мөчир дарж гэрлийг унтраах"
              >
                <Moon size={13} /> Унтраах
              </button>
            </div>
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}
