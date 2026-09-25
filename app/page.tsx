import Link from 'next/link';
import { ArrowRight, Archive, BookOpen, Camera, GitFork, ShieldCheck } from 'lucide-react';

const sections = [
  {
    icon: GitFork,
    eyebrow: 'УДМЫН МОД',
    title: 'Үеэс үед үргэлжлэх холбоо.',
    text: 'Эцэг эх, хүүхэд, хань ижил болон үеийн холбоогоо нэг дор хадгалж, гэр бүлийнхээ модыг амьд түүх болгон үргэлжлүүлнэ.',
  },
  {
    icon: BookOpen,
    eyebrow: 'МАНАЙ ТҮҮХ',
    title: 'Яриагаар үлдсэн түүхээ бичиж үлдээе.',
    text: 'Онцгой үйл явдал, хүний намтар, амьдралын түүхээ дараагийн үедээ уншуулахад бэлэн байдлаар хадгална.',
  },
  {
    icon: Camera,
    eyebrow: 'ДУРСАМЖ',
    title: 'Зураг бүрийн цаадах мөчийг хадгална.',
    text: 'Зураг, дурсамж болон тухайн үеийн утга учрыг хүмүүс, он жилтэй нь холбон гэр бүлийн түүхийн хэсэг болгоно.',
  },
  {
    icon: Archive,
    eyebrow: 'АРХИВ',
    title: 'Өвлөж ирсэн баримтаа мартахгүй.',
    text: 'Хуучин зураг, бичиг баримт, огноо, газар болон эх сурвалжийг нэг дор тэмдэглэн дараагийн үедээ үлдээнэ.',
  },
];

function HeritageTree() {
  return (
    <div className="heritage-tree" role="img" aria-label="Олон үеийг төлөөлөх настай модны дүрслэл">
      <div className="heritage-tree__halo" />
      <svg className="heritage-tree__svg" viewBox="0 0 560 620" aria-hidden="true">
        <defs>
          <linearGradient id="trunk" x1="0" x2="1">
            <stop offset="0" stopColor="#102d24" />
            <stop offset=".52" stopColor="#285646" />
            <stop offset="1" stopColor="#0e2b22" />
          </linearGradient>
          <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#173f32" />
            <stop offset=".55" stopColor="#35634f" />
            <stop offset="1" stopColor="#58725a" />
          </linearGradient>
          <filter id="treeShadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#061b15" floodOpacity=".3" />
          </filter>
        </defs>
        <g filter="url(#treeShadow)">
          <path className="heritage-tree__trunk" fill="url(#trunk)" d="M267 572c-9-79-3-147 4-201-16-48-42-75-80-106-10-8-7-22 6-20 48 9 80 37 101 72 24-41 57-70 103-83 13-4 19 10 9 20-34 32-59 63-75 112 11 59 17 128 9 206H267Z"/>
          <path className="heritage-tree__branch" d="M280 388c-22-65-54-117-105-161M282 347c18-63 55-116 112-158M278 301c-7-67-33-119-74-166M300 296c14-69 42-119 92-163M268 410c-55-34-100-39-153-28M301 406c55-35 101-39 151-24" />
          <g className="heritage-tree__canopy" fill="url(#leaf)">
            <path d="M91 242c-39-23-42-74-4-101-7-47 37-80 78-60 29-42 91-29 101 20 40-13 75 22 65 60 48 5 64 61 32 92-18 39-73 43-103 18-35 35-94 21-111-20-19 15-40 14-58-9Z"/>
            <path d="M286 178c-12-45 21-85 65-84 19-45 81-45 105-7 42-14 82 24 70 67 47 14 55 75 17 101-17 39-72 48-103 17-32 27-88 15-101-23-38 14-78-20-53-71Z"/>
            <path d="M105 319c-20-37 6-79 46-78 13-40 67-49 91-12 42-7 70 40 47 76-9 42-63 57-94 28-28 28-75 16-90-14Z"/>
            <path d="M317 317c-15-43 20-82 61-75 25-39 83-25 91 19 42 4 61 54 34 84-20 37-72 35-95 5-33 23-78 8-91-33Z"/>
          </g>
          <g className="heritage-tree__leaves">
            <circle cx="111" cy="164" r="7"/><circle cx="158" cy="113" r="6"/><circle cx="210" cy="151" r="7"/>
            <circle cx="350" cy="105" r="7"/><circle cx="414" cy="141" r="6"/><circle cx="462" cy="180" r="7"/>
            <circle cx="151" cy="280" r="6"/><circle cx="204" cy="246" r="5"/><circle cx="385" cy="252" r="6"/>
            <circle cx="438" cy="286" r="5"/>
          </g>
          <g className="heritage-tree__roots">
            <path d="M278 541c-37 8-69 22-106 43M292 545c37 6 68 18 103 39M279 555c-8 18-12 29-17 47M297 555c8 16 12 28 17 45"/>
          </g>
        </g>
      </svg>
      <span className="heritage-tree__label heritage-tree__label--past">Өнгөрсөн</span>
      <span className="heritage-tree__label heritage-tree__label--today">Өнөөдөр</span>
      <span className="heritage-tree__label heritage-tree__label--next">Дараагийн үе</span>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="public-home public-home--heritage">
      <header className="public-home__nav">
        <Link className="public-home__brand" href="/" aria-label="ГУУЛИНГИЙНХАН нүүр хуудас">
          <span className="public-home__brand-mark" aria-hidden="true"><span className="public-home__brand-tree">⌁</span></span>
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
          <p className="public-home__quiet-note"><ShieldCheck size={16} aria-hidden="true" /><span>Гэр бүлийн мэдээлэл зөвшөөрөлтэй оролцогчдод зориулагдана.</span></p>
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
        <p>
          Хүний нэр, холбоо, төрсөн нутаг, хэлж үлдээсэн үг бүр нэг түүхийн хэсэг.
          Тэдгээрийг хамтад нь хадгалбал дараагийн үе өөрийнхөө хаанаас ирснийг илүү тодорхой мэднэ.
        </p>
      </section>

      <section className="public-home__tree-section" aria-labelledby="tree-title">
        <div className="public-home__tree-copy">
          <p className="public-home__eyebrow">УДМЫН МОД</p>
          <h2 id="tree-title">Гэр бүлийнхээ холбоог амьд мод шиг харъя.</h2>
          <p>Үе бүр дараагийн мөчиртэйгөө холбогдоно. Хүмүүс, он жил, гэр бүлийн холбоо нэг дор харагдана.</p>
          <Link className="public-home__text-link" href="/login">Удам угсаагаа үзэх <ArrowRight size={16} /></Link>
        </div>
        <div className="public-home__tree-mini" aria-hidden="true"><HeritageTree /></div>
      </section>

      <section className="public-home__capabilities" aria-label="Гэр бүлийн өвийн боломжууд">
        {sections.map(({ icon: Icon, eyebrow, title, text }) => (
          <article className="public-home__capability" key={eyebrow}>
            <span className="public-home__capability-icon" aria-hidden="true"><Icon size={18} /></span>
            <p className="public-home__eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p>{text}</p>
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
