// Natural heritage home visual system.
import Link from 'next/link';
import { ArrowRight, Archive, BookOpen, Camera, GitFork, ShieldCheck, TreeDeciduous } from 'lucide-react';

const sections = [
  {
    icon: BookOpen,
    eyebrow: 'МАНАЙ ТҮҮХ',
    title: 'Яриагаар үлдсэн түүхээ бичиж үлдээе.',
    text: 'Хүний намтар, онцгой үйл явдал, амьдралын жижигхэн түүх бүрийг дараагийн үедээ уншуулахад бэлэн байлгана.',
  },
  {
    icon: Camera,
    eyebrow: 'ДУРСАМЖ',
    title: 'Зураг бүрийн цаадах мөчийг хадгална.',
    text: 'Гэр бүлийн мөчүүдээ хүмүүс, он жил, газар нутагтай нь холбон нэгэн амьд дурсамж болгон үлдээнэ.',
  },
  {
    icon: Archive,
    eyebrow: 'АРХИВ',
    title: 'Өвлөж ирсэн баримтаа мартахгүй.',
    text: 'Хуучин зураг, бичиг баримт, огноо, эх сурвалжийг нэг дор тэмдэглэн дараагийн үедээ өвлүүлнэ.',
  },
];

function HeritageTree({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`heritage-tree${compact ? ' heritage-tree--compact' : ''}`} role="img" aria-label="Олон үеийг төлөөлөх өндөр настай модны дүрслэл">
      <div className="heritage-tree__mist" aria-hidden="true" />
      <div className="heritage-tree__moon" aria-hidden="true" />
      <svg className="heritage-tree__svg" viewBox="0 0 620 680" aria-hidden="true">
        <defs>
          <linearGradient id="tree-trunk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0a251d" />
            <stop offset=".38" stopColor="#173f32" />
            <stop offset=".68" stopColor="#2c5947" />
            <stop offset="1" stopColor="#0b2a20" />
          </linearGradient>
          <linearGradient id="tree-leaf" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#153b30" />
            <stop offset=".48" stopColor="#285746" />
            <stop offset="1" stopColor="#60765f" />
          </linearGradient>
          <filter id="tree-shadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="18" stdDeviation="13" floodColor="#03150f" floodOpacity=".45" />
          </filter>
        </defs>

        <g filter="url(#tree-shadow)">
          <path className="heritage-tree__ground" d="M54 635c96-31 157-13 244-16 93-3 159-29 269 13-98 27-410 28-513 3Z" />

          <g className="heritage-tree__roots">
            <path d="M306 548c-52 13-102 35-171 75" />
            <path d="M324 551c58 9 112 31 183 70" />
            <path d="M304 565c-25 25-41 48-55 78" />
            <path d="M327 565c24 23 42 48 57 78" />
            <path d="M292 558c-49 1-92 9-131 25" />
            <path d="M341 558c48 0 92 9 137 27" />
          </g>

          <path className="heritage-tree__trunk" fill="url(#tree-trunk)"
            d="M286 568c-11-61-8-112 1-166-13-44-27-78-55-111-18-21-35-39-64-59-9-7-5-21 7-20 61 5 102 37 131 82 16-31 43-68 91-99 22-15 41-20 57-17 10 2 12 15 3 22-45 32-77 72-94 119 14 65 19 137 8 249l-85 1Z" />

          <g className="heritage-tree__bark" fill="none">
            <path d="M299 565c-5-83 2-142-7-207M326 558c-2-68-1-122-18-186M277 475c-28-44-40-72-71-98M340 459c28-49 43-76 74-101" />
            <path d="M309 546c-18-62-15-102-10-141M329 529c14-52 9-88 2-119" />
          </g>

          <g className="heritage-tree__branches">
            <path d="M307 422c-48-63-83-91-141-122-37-19-66-24-94-22" />
            <path d="M304 366c-20-73-50-119-101-160-30-24-55-39-82-45" />
            <path d="M314 401c50-61 86-91 147-121 35-17 65-21 98-17" />
            <path d="M322 344c17-69 46-115 94-156 29-25 57-41 87-48" />
            <path d="M289 329c-8-54-25-92-58-128-27-30-56-52-88-62" />
            <path d="M335 313c10-54 29-91 64-126 28-29 57-47 91-57" />
          </g>

          <g className="heritage-tree__canopy" fill="url(#tree-leaf)">
            <path d="M78 268c-37-21-47-65-24-96-11-43 23-82 66-78 20-42 77-47 105-11 36-10 72 15 77 52 44 9 64 57 42 94-20 35-69 43-102 18-29 32-83 32-110 2-19 21-35 30-54 19Z" />
            <path d="M244 171c-16-43 12-88 57-91 18-43 76-55 109-17 44-17 88 17 82 64 44 18 48 75 10 101-31 22-75 12-97-17-34 24-82 13-98-24-31 9-54 2-63-16Z" />
            <path d="M366 258c-20-41 6-86 48-89 13-42 69-54 100-20 43-10 79 29 69 70 37 18 40 67 6 92-30 21-72 13-93-14-35 28-81 17-99-18-17 8-25 2-31-21Z" />
            <path d="M118 364c-26-35-7-80 31-89 9-41 61-58 94-27 40-12 78 22 72 63 39 18 46 68 12 96-29 24-75 17-99-14-36 25-88 13-110-29Z" />
            <path d="M333 374c-22-39 5-84 46-91 18-38 69-47 99-13 40-5 70 31 60 69 39 18 44 66 10 91-30 22-73 12-91-17-36 24-88 9-101-39-10 5-17 4-23 0Z" />
          </g>

          <g className="heritage-tree__leaf-clusters">
            <circle cx="106" cy="154" r="7" /><circle cx="151" cy="116" r="5" /><circle cx="201" cy="148" r="6" />
            <circle cx="279" cy="104" r="6" /><circle cx="347" cy="115" r="7" /><circle cx="414" cy="131" r="5" />
            <circle cx="489" cy="168" r="7" /><circle cx="533" cy="224" r="5" /><circle cx="438" cy="221" r="6" />
            <circle cx="139" cy="286" r="6" /><circle cx="201" cy="258" r="5" /><circle cx="248" cy="302" r="7" />
            <circle cx="400" cy="298" r="6" /><circle cx="471" cy="278" r="5" /><circle cx="515" cy="328" r="7" />
            <circle cx="157" cy="377" r="5" /><circle cx="235" cy="354" r="6" /><circle cx="390" cy="376" r="5" />
          </g>

          <g className="heritage-tree__birds" aria-hidden="true">
            <path d="M111 77c7-6 14-6 20 0-6-2-11 0-20 0Z" />
            <path d="M473 85c8-7 16-7 23 0-7-2-13 0-23 0Z" />
          </g>
        </g>
      </svg>

      {!compact && (
        <>
          <span className="heritage-tree__label heritage-tree__label--past">Өнгөрсөн</span>
          <span className="heritage-tree__label heritage-tree__label--today">Өнөөдөр</span>
          <span className="heritage-tree__label heritage-tree__label--next">Дараагийн үе</span>
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="public-home public-home--heritage">
      <header className="public-home__nav">
        <Link className="public-home__brand" href="/" aria-label="ГУУЛИНГИЙНХАН нүүр хуудас">
          <span className="public-home__brand-mark" aria-hidden="true"><TreeDeciduous size={23} /></span>
          <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
        </Link>
        <nav className="public-home__nav-actions" aria-label="Нэвтрэх хэсэг">
          <Link className="public-home__login" href="/login">Нэвтрэх</Link>
          <Link className="public-home__register" href="/register">Бүртгүүлэх <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="public-home__hero" aria-labelledby="home-title">
        <div className="public-home__hero-copy">
          <p className="public-home__eyebrow">УДАМ · ӨВ · ТҮҮХ · ДУРСАМЖ</p>
          <h1 id="home-title">Бидний <em>удам.</em><br />Бидний түүх.<br />Бидний дурсамж.</h1>
          <p className="public-home__hero-lede">
            Өвөө, эмээгийн хууч ярианаас өнөөдрийн дурсамж хүртэл — гэр бүлийнхээ хүмүүс,
            удам угсаа, зураг, түүх, архивыг нэгэн амьд орчинд хадгална.
          </p>
          <div className="public-home__hero-actions">
            <Link className="public-home__primary" href="/register">Гэр бүлийнхээ түүхийг эхлүүлэх <ArrowRight size={17} /></Link>
            <Link className="public-home__secondary" href="/login">Нэвтрэх</Link>
          </div>
          <p className="public-home__quiet-note"><ShieldCheck size={15} aria-hidden="true" />Гэр бүлийн мэдээлэл зөвшөөрөлтэй оролцогчдод зориулагдана.</p>
        </div>
        <div className="public-home__hero-art">
          <HeritageTree />
        </div>
      </section>

      <section className="public-home__intro" aria-labelledby="intro-title">
        <div>
          <p className="public-home__eyebrow">НЭГ ГЭР БҮЛ · НЭГ ТҮҮХ</p>
          <h2 id="intro-title">Үндэс нь өнгөрсөнд, мөчир нь бидэнд, үр нь маргаашид.</h2>
        </div>
        <p>Нэр, холбоо, төрсөн нутаг, хэлж үлдээсэн үг бүр нэг түүхийн хэсэг. Тэдгээрийг хамтад нь хадгалбал дараагийн үе өөрийнхөө хаанаас ирснийг илүү тодорхой мэднэ.</p>
      </section>

      <section className="public-home__tree-section" aria-labelledby="tree-title">
        <div className="public-home__tree-copy">
          <p className="public-home__eyebrow">УДМЫН МОД</p>
          <h2 id="tree-title">Гэр бүлийнхээ холбоог амьд мод шиг харъя.</h2>
          <p>Үе бүр дараагийн мөчиртэйгөө холбогдоно. Хүмүүс, он жил, гэр бүлийн холбоо нэг дор харагдана.</p>
          <Link className="public-home__text-link" href="/login">Удам угсаагаа үзэх <ArrowRight size={16} /></Link>
        </div>
        <div className="public-home__tree-mini"><HeritageTree compact /></div>
      </section>

      <section className="public-home__story" aria-labelledby="story-title">
        <div className="public-home__story-mark" aria-hidden="true">01</div>
        <div>
          <p className="public-home__eyebrow">МАНАЙ ТҮҮХ</p>
          <h2 id="story-title">Үеийн дуу хоолойг таслахгүй хадгалъя.</h2>
          <p>Өмнөх үеийн амьдрал, дурсамж, сургамжийг он цагийн дарааллаар тэмдэглэж, гэр бүлийн хүмүүсийнхээ нэртэй холбон үлдээнэ.</p>
          <Link className="public-home__text-link" href="/login">Түүхээ үргэлжлүүлэх <ArrowRight size={16} /></Link>
        </div>
      </section>

      <section className="public-home__editorial" aria-label="Гэр бүлийн өвийн хэсгүүд">
        {sections.map(({ icon: Icon, eyebrow, title, text }, index) => (
          <article className="public-home__editorial-row" key={eyebrow}>
            <span className="public-home__editorial-number">0{index + 2}</span>
            <span className="public-home__capability-icon" aria-hidden="true"><Icon size={18} /></span>
            <div>
              <p className="public-home__eyebrow">{eyebrow}</p>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="public-home__closing" aria-labelledby="closing-title">
        <div>
          <p className="public-home__eyebrow">ӨНӨӨДРӨӨС ЭХЭЛЬЕ</p>
          <h2 id="closing-title">Гэр бүлийнхээ модыг ургуулж үлдээе.</h2>
          <p>Өнөөдөр нэг хүний нэрээс эхлээд, маргааш бүхэл бүтэн гэр бүлийн түүх болоод үлдэнэ.</p>
        </div>
        <div className="public-home__closing-actions">
          <Link className="public-home__primary" href="/register">Удам угсаагаа хадгалъя <ArrowRight size={17} /></Link>
          <Link className="public-home__secondary" href="/login">Нэвтрэх</Link>
        </div>
      </section>

      <footer className="public-home__footer">
        <span>ГУУЛИНГИЙНХАН</span>
        <span>Удам · Түүх · Дурсамж · Өв</span>
      </footer>
    </main>
  );
}
