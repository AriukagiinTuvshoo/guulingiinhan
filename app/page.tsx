import Link from 'next/link';
import { ArrowRight, Archive, BookOpen, Camera, GitFork, ShieldCheck, TreeDeciduous } from 'lucide-react';

const sections = [
  {
    icon: GitFork,
    eyebrow: 'УДМЫН МОД',
    title: 'Холбоогоо үе үеэр нь үлдээе.',
    text: 'Эцэг эх, хүүхэд, хань ижил болон үеийн холбоогоо нэг дор хадгалж, гэр бүлийн түүхээ ойлгомжтой үргэлжлүүлнэ.',
  },
  {
    icon: BookOpen,
    eyebrow: 'МАНАЙ ТҮҮХ',
    title: 'Яриагаар үлддэг түүхээ бичиж үлдээе.',
    text: 'Онцгой үйл явдал, хүний намтар, амьдралын түүхээ дараагийн үедээ уншуулахад бэлэн байдлаар хадгална.',
  },
  {
    icon: Camera,
    eyebrow: 'ДУРСАМЖ',
    title: 'Дурсамжаа холбоотой хүмүүсийнх нь хамт хадгална.',
    text: 'Зураг, дурсамж болон тухайн үеийн утга учрыг нэг орчинд цуглуулж, гэр бүлийнхээ түүхийн хэсэг болгоно.',
  },
  {
    icon: Archive,
    eyebrow: 'АРХИВ',
    title: 'Чухал баримтаа мартахгүй үлдээнэ.',
    text: 'Баримтын мэдээлэл, огноо, газар болон холбоотой хүмүүсээ нэг дор тэмдэглэж хадгална.',
  },
];

export default function HomePage() {
  return (
    <main className="public-home">
      <header className="public-home__nav">
        <Link className="public-home__brand" href="/" aria-label="ГУУЛИНГИЙНХАН нүүр хуудас">
          <span className="public-home__brand-mark" aria-hidden="true"><TreeDeciduous size={26} /></span>
          <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
        </Link>
        <nav className="public-home__nav-actions" aria-label="Нэвтрэх хэсэг">
          <Link className="public-home__login" href="/login">Нэвтрэх</Link>
          <Link className="public-home__register" href="/register">Бүртгүүлэх <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="public-home__hero">
        <div className="public-home__hero-copy">
          <p className="public-home__eyebrow">ГЭР БҮЛИЙН ӨВ · ТҮҮХ · ДУРСАМЖ</p>
          <h1>Өнгөрсөн үеийнхээ <em>түүхийг</em><br />дараагийн үедээ үлдээе.</h1>
          <p className="public-home__hero-lede">
            Өвөө, эмээгийн дурсамжаас өнөөдрийн түүх хүртэл — гэр бүлийнхээ хүмүүс,
            үйл явдал, дурсамж, архивыг нэг дор хадгалах хувийн орон зай.
          </p>
          <div className="public-home__hero-actions">
            <Link className="public-home__primary" href="/register">Гэр бүлийн орчноо эхлүүлэх <ArrowRight size={17} /></Link>
            <Link className="public-home__secondary" href="/login">Нэвтрэх</Link>
          </div>
          <div className="public-home__quiet-note"><ShieldCheck size={16} aria-hidden="true" /><span>Гэр бүлийн мэдээлэл зөвшөөрөлтэй оролцогчдод зориулагдана.</span></div>
        </div>

        <div className="public-home__hero-art" aria-hidden="true">
          <div className="public-home__paper">
            <svg viewBox="0 0 520 460">
              <path d="M260 410 C255 350 258 285 260 220" />
              <path d="M260 300 C220 270 185 238 150 198" />
              <path d="M260 300 C300 270 335 238 370 198" />
              <path d="M260 235 C228 210 210 177 204 142" />
              <path d="M260 235 C292 210 310 177 316 142" />
              <path d="M204 142 C194 114 183 92 163 71" />
              <path d="M316 142 C326 114 337 92 357 71" />
              <circle cx="260" cy="220" r="17" />
              <circle cx="150" cy="198" r="15" />
              <circle cx="370" cy="198" r="15" />
              <circle cx="204" cy="142" r="13" />
              <circle cx="316" cy="142" r="13" />
              <circle cx="163" cy="71" r="11" />
              <circle cx="357" cy="71" r="11" />
            </svg>
            <div className="public-home__paper-caption"><span>Гэр бүлийн түүх</span><small>Үеэс үед үлдэх тэмдэглэл</small></div>
          </div>
          <span className="public-home__botanical public-home__botanical--left" />
          <span className="public-home__botanical public-home__botanical--right" />
        </div>
      </section>

      <section className="public-home__intro">
        <div>
          <p className="public-home__eyebrow">ЯАГААД ГУУЛИНГИЙНХАН?</p>
          <h2>Нэг гэр бүлийн олон дурсамжийг нэг түүх болгож хадгалъя.</h2>
        </div>
        <p>
          Өнөөдөр бидний санаж байгаа зүйл маргааш өөрчлөгдөж болно. Харин нэр, холбоо,
          түүх, зураг, баримтаа цаг тухайд нь үлдээвэл дараагийн үе өөрийн түүхээ илүү тодорхой танина.
        </p>
      </section>

      <section className="public-home__capabilities" aria-label="Гэр бүлийн өвийн боломжууд">
        {sections.map(({ icon: Icon, eyebrow, title, text }) => (
          <article className="public-home__capability" key={eyebrow}>
            <span className="public-home__capability-icon" aria-hidden="true"><Icon size={19} /></span>
            <p className="public-home__eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="public-home__closing">
        <div>
          <p className="public-home__eyebrow">ӨНӨӨДРӨӨС ЭХЭЛЬЕ</p>
          <h2>Манай түүхийг хамтдаа хадгалъя.</h2>
          <p>Эхний алхам энгийн. Гэр бүлийнхээ хувийн орчноо үүсгээд бага багаар нэмээрэй.</p>
        </div>
        <div className="public-home__closing-actions">
          <Link className="public-home__primary" href="/register">Бүртгүүлэх <ArrowRight size={17} /></Link>
          <Link className="public-home__secondary" href="/login">Нэвтрэх</Link>
        </div>
      </section>

      <footer className="public-home__footer">
        <span>ГУУЛИНГИЙНХАН</span>
        <span>Гэр бүлийн түүхийг өнөөдрөөс хадгалъя.</span>
      </footer>
    </main>
  );
}
