import Link from 'next/link';
import { Archive, ArrowRight, BookOpen, Camera, GitFork, ShieldCheck } from 'lucide-react';
import { MongolianOrnamentBand } from '../components/mongolian-ornament-band';
import { ThemePicker } from '../components/theme-picker';

const features = [
  {
    icon: GitFork,
    eyebrow: '01 · АЛТАН УДМЫН МОД',
    title: 'Үе дамжсан хэлхээг алтан шугамаар зурна.',
    text: 'Эцэг өвгөд, үр хүүхэд, гэрлэлтийн холбоосыг интерактив Алтан Мод, он цагийн аялал болон ханын PDF хэлбэрээр хадгална.',
  },
  {
    icon: BookOpen,
    eyebrow: '02 · МАНАЙ ТҮҮХ & АМАН ТҮҮХ',
    title: 'Яриагаар үлдсэн өвийг ном болгон мөнхөлнө.',
    text: 'Хүний намтар, онцгой үйл явдал, ахмадуудын хууч яриаг бүртгэж, олон хуудастай Ургийн Ном PDF болгон хэвлэнэ.',
  },
  {
    icon: Camera,
    eyebrow: '03 · ДУРСАМЖ & АРХИВ',
    title: 'Хуучин зураг, баримт бүр эзэнтэйгээ үлдэнэ.',
    text: 'Гэр бүлийн нандин мөчүүд, түүхэн гэрэл зураг, бичиг баримтыг хүмүүстэй нь холбон хувийн найдвартай санд хадгална.',
  },
];

export default function HomePage() {
  return (
    <main className="luxury-landing">
      {/* Top Header — Clean Brand + Sign In (No logged-out app nav clutter) */}
      <header className="luxury-landing__header">
        <Link href="/" className="luxury-landing__brand" aria-label="ГУУЛИНГИЙНХАН нүүр">
          <span className="luxury-landing__wordmark">GUULIN</span>
          <span className="luxury-landing__dot" aria-hidden="true" />
        </Link>

        <div className="luxury-landing__auth-actions">
          <ThemePicker variant="compact" showLabel={false} />
          <Link href="/login" className="luxury-landing__signin-pill">
            Нэвтрэх
          </Link>
        </div>
      </header>

      {/* Editorial Hero Section */}
      <section className="luxury-landing__hero">
        <div className="luxury-landing__hero-copy">
          <p className="luxury-landing__eyebrow">
            HERITAGE ARCHIVE · МОНГОЛ УРГИЙН САН · EST 2026
          </p>
          <h1 className="luxury-landing__title">
            Өв удмаа <em>Мөнхөд</em> Хадгалъя.
          </h1>
          <p className="luxury-landing__lede">
            Эцэг өвгөдийнхөө уг гарвал, хөрөг зураг, амьдралын түүх болон гэр бүлийн нандин
            дурсамжаа нэгдсэн, нууцлалтай дижитал өвийн санд үеийн үед хадгална.
          </p>

          <div className="luxury-landing__cta-row">
            <Link href="/register" className="luxury-landing__primary-cta">
              <span>Архиваа эхлүүлэх</span>
              <span className="luxury-landing__cta-circle" aria-hidden="true">
                <ArrowRight size={16} />
              </span>
            </Link>
            <Link href="/tree" className="luxury-landing__secondary-cta">
              Удмын мод руу орох
            </Link>
          </div>

          <div className="luxury-landing__metrics" aria-label="Платформын боломжууд">
            <div>
              <strong>9+ үе</strong>
              <span>Ургийн гүн</span>
            </div>
            <div>
              <strong>PDF · SVG</strong>
              <span>Ургийн ном &amp; плакат</span>
            </div>
            <div>
              <strong>100%</strong>
              <span>Хувийн нууцлал</span>
            </div>
          </div>
        </div>

        {/* Right Natural Cedar & Burnished-Gold Arched Medallion */}
        <div className="luxury-landing__hero-visual">
          <div className="luxury-landing__arch-frame">
            <span className="luxury-landing__coords" aria-hidden="true">
              47.9184° N · 106.9177° E · ХАНГАЙН НУРУУ
            </span>

            <svg
              className="luxury-landing__tree-medallion"
              viewBox="0 0 360 380"
              role="img"
              aria-label="Байгалийн Хуш Удмын Модны бэлгэдэл"
            >
              <defs>
                <linearGradient id="medallion-gold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f6e4b4" />
                  <stop offset="48%" stopColor="#d4ad4d" />
                  <stop offset="100%" stopColor="#9c7322" />
                </linearGradient>
                <radialGradient id="canopy-glow" cx="50%" cy="42%" r="48%">
                  <stop offset="0%" stopColor="#3c8a5e" stopOpacity="0.46" />
                  <stop offset="65%" stopColor="#1e5438" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#122a1e" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="steppe-hill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2f6b45" stopOpacity="0.52" />
                  <stop offset="100%" stopColor="#142b1e" stopOpacity="0.08" />
                </linearGradient>
              </defs>

              {/* Soft natural pine-canopy halo */}
              <circle cx="180" cy="176" r="144" fill="url(#canopy-glow)" />

              {/* Outer & inner fine brass rings */}
              <circle
                cx="180"
                cy="184"
                r="146"
                fill="none"
                stroke="url(#medallion-gold)"
                strokeWidth="3.2"
              />
              <circle
                cx="180"
                cy="184"
                r="136"
                fill="none"
                stroke="rgba(235, 213, 154, 0.36)"
                strokeWidth="1"
                strokeDasharray="3 5"
              />

              {/* Rolling Mongolian steppe horizon inside medallion */}
              <path
                d="M52 276 Q118 250 180 264 T308 274 A142 142 0 0 1 52 276 Z"
                fill="url(#steppe-hill)"
              />

              {/* Organic cedar roots anchored into the earth */}
              <path
                d="M174 282 C152 288 128 298 106 310 M186 282 C208 288 232 298 254 310 M180 286 C174 302 162 314 148 322 M180 286 C188 302 198 314 212 322"
                fill="none"
                stroke="url(#medallion-gold)"
                strokeWidth="2.8"
                strokeLinecap="round"
                opacity="0.88"
              />

              {/* Living Cedar Trunk & Organic Spreading Branches */}
              <path
                d="M176 286 C175 244 174 214 173 184 C146 168 112 162 84 164 C116 154 148 158 173 170 C168 140 152 114 128 94 C156 108 172 132 178 156 C180 124 180 96 180 74 C180 96 180 124 182 156 C188 132 204 108 232 94 C208 114 192 140 187 170 C212 158 244 154 276 164 C248 162 214 168 187 184 C186 214 186 244 188 286 Z"
                fill="url(#medallion-gold)"
              />

              {/* Secondary natural boughs */}
              <path
                d="M175 212 C148 202 124 202 104 210 M185 212 C212 202 236 202 256 210 M176 146 C158 134 142 128 122 126 M184 146 C202 134 218 128 238 126"
                fill="none"
                stroke="#f6e4b4"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.82"
              />

              {/* Generation fruit / starlight buds */}
              <circle cx="180" cy="68" r="6" fill="#fff5d6" />
              <circle cx="124" cy="96" r="5" fill="#ebd59a" />
              <circle cx="236" cy="96" r="5" fill="#ebd59a" />
              <circle cx="90" cy="162" r="4.5" fill="#d4ad4d" />
              <circle cx="270" cy="162" r="4.5" fill="#d4ad4d" />
              <circle cx="106" cy="208" r="4" fill="#ebd59a" />
              <circle cx="254" cy="208" r="4" fill="#ebd59a" />
              <circle cx="146" cy="134" r="4" fill="#fff5d6" />
              <circle cx="214" cy="134" r="4" fill="#fff5d6" />

              {/* Subtle Ulzii diamond knot at the trunk heart */}
              <g transform="translate(180 232) scale(0.75)">
                <rect
                  x="-11"
                  y="-11"
                  width="22"
                  height="22"
                  transform="rotate(45)"
                  fill="#173525"
                  stroke="#ebd59a"
                  strokeWidth="2"
                />
                <circle r="2.6" fill="#ebd59a" />
              </g>
            </svg>

            <div className="luxury-landing__floating-badge">
              <span className="luxury-landing__badge-dot" aria-hidden="true" />
              <span>Монгол Ургийн Бичиг · Амьд удам судар</span>
            </div>
          </div>
        </div>
      </section>

      {/* Authentic Mongolian Алхан хээ Brass Divider */}
      <div className="luxury-landing__ornament-wrap">
        <MongolianOrnamentBand />
      </div>

      {/* Bottom Editorial Ticker Strip (Mockups 5 & 6) */}
      <div className="luxury-landing__ticker" aria-hidden="true">
        <span>URGIIN BICHIG</span>
        <span>·</span>
        <span>LINEAGE ARCHIVE</span>
        <span>·</span>
        <span>ORAL HISTORIES</span>
        <span>·</span>
        <span>HEIRLOOM VAULT</span>
        <span>·</span>
        <span>ГУУЛИНГИЙНХАН</span>
      </div>

      {/* Heritage Feature Pillars */}
      <section className="luxury-landing__pillars" aria-label="Үндсэн боломжууд">
        {features.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.eyebrow} className="luxury-landing__pillar-card">
              <span className="luxury-landing__pillar-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <p className="luxury-landing__pillar-eyebrow">{item.eyebrow}</p>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </article>
          );
        })}
      </section>

      <footer className="luxury-landing__footer">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={16} color="var(--gold-500)" />
          <span>ГУУЛИНГИЙНХАН — Гэр бүлийн хувийн өв, удмын сан</span>
        </div>
        <div className="luxury-landing__footer-links">
          <Link href="/login">Нэвтрэх</Link>
          <Link href="/register">Бүртгүүлэх</Link>
          <Link href="/archives">
            <Archive size={13} style={{ display: 'inline', marginRight: 4 }} />
            Архив
          </Link>
        </div>
      </footer>
    </main>
  );
}
