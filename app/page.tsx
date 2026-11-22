import Link from 'next/link';
import { ArrowRight, Archive, BookOpen, Camera, GitFork, ShieldCheck } from 'lucide-react';

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
      {/* Top Floating Pill Navigation (Mockups 5 & 6) */}
      <header className="luxury-landing__header">
        <Link href="/" className="luxury-landing__brand" aria-label="ГУУЛИНГИЙНХАН нүүр">
          <span className="luxury-landing__wordmark">GUULIN</span>
          <span className="luxury-landing__dot" aria-hidden="true" />
        </Link>

        <nav className="luxury-landing__pill-nav" aria-label="Үндсэн хэсгүүд">
          <Link href="/tree" className="is-active">Ургийн мод</Link>
          <Link href="/memories">Дурсамж</Link>
          <Link href="/stories">Түүх</Link>
          <Link href="/archives">Архив</Link>
        </nav>

        <div className="luxury-landing__auth-actions">
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
            <Link href="/dashboard" className="luxury-landing__secondary-cta">
              Миний орчин руу орох
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

        {/* Right Arched Obsidian & Burnished-Gold Medallion (Mockups 5 & 6) */}
        <div className="luxury-landing__hero-visual">
          <div className="luxury-landing__arch-frame">
            <span className="luxury-landing__coords" aria-hidden="true">
              47.9184° N · 106.9177° E
            </span>

            <svg
              className="luxury-landing__tree-medallion"
              viewBox="0 0 360 360"
              role="img"
              aria-label="Алтан Удмын Модны бэлгэдэл"
            >
              <defs>
                <linearGradient id="medallion-gold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f5db96" />
                  <stop offset="48%" stopColor="#c99b3d" />
                  <stop offset="100%" stopColor="#7a5718" />
                </linearGradient>
              </defs>
              <circle
                cx="180"
                cy="180"
                r="142"
                fill="none"
                stroke="url(#medallion-gold)"
                strokeWidth="4.5"
              />
              <circle
                cx="180"
                cy="180"
                r="130"
                fill="none"
                stroke="rgba(232, 198, 114, 0.28)"
                strokeWidth="1"
              />
              {/* Stylized Golden Tree of Life inside Medallion */}
              <path
                d="M180 306 C178 260 176 226 174 190 C150 170 116 160 88 156 C122 152 152 158 174 174 C170 144 156 114 134 90 C160 108 174 132 180 160 C186 132 200 108 226 90 C204 114 190 144 186 174 C208 158 238 152 272 156 C244 160 210 170 186 190 C184 226 184 260 190 306 Z"
                fill="url(#medallion-gold)"
              />
              <path
                d="M174 276 C148 282 126 292 108 302 M186 276 C212 282 234 292 252 302"
                fill="none"
                stroke="url(#medallion-gold)"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
              <circle cx="180" cy="76" r="6" fill="#f7df9d" />
              <circle cx="122" cy="112" r="5" fill="#e5bd62" />
              <circle cx="238" cy="112" r="5" fill="#e5bd62" />
              <circle cx="96" cy="158" r="4.5" fill="#d9ad4e" />
              <circle cx="264" cy="158" r="4.5" fill="#d9ad4e" />
              <circle cx="146" cy="140" r="4" fill="#f5db96" />
              <circle cx="214" cy="140" r="4" fill="#f5db96" />
            </svg>

            <div className="luxury-landing__floating-badge">
              <span className="luxury-landing__badge-dot" aria-hidden="true" />
              <span>Монгол Ургийн Бичиг · Баталгаажсан удам</span>
            </div>
          </div>
        </div>
      </section>

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
          <ShieldCheck size={16} color="#b48a3e" />
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
