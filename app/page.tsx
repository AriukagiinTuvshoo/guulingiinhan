import Link from 'next/link';
import { ArrowRight, BookOpen, Camera, GitFork, ShieldCheck, TreeDeciduous, Users } from 'lucide-react';

const features = [
  {
    icon: GitFork,
    title: 'Ургийн мод',
    text: 'Үе үеийн хүмүүс, эцэг эх, хүүхэд болон гэр бүлийн холбоогоо нэг дор хадгална.',
  },
  {
    icon: BookOpen,
    title: 'Намтар ба түүх',
    text: 'Хүн бүрийн намтар, амьдралын үйл явдал, гэр бүлийн түүхийг үеийн үед үлдээнэ.',
  },
  {
    icon: Camera,
    title: 'Дурсамж',
    text: 'Гэр бүлийн зураг, дурсамж, баримт бичгийг холбоотой хүмүүстэй нь хадгална.',
  },
  {
    icon: ShieldCheck,
    title: 'Хувийн орчин',
    text: 'Таны гэр бүлийн мэдээллийг зөвшөөрөлтэй хэрэглэгчидтэйгээ хуваалцахад зориулагдсан.',
  },
];

export default function HomePage() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="ГУУЛИНГИЙНХАН нүүр хуудас">
          <span className="landing-mark"><TreeDeciduous size={30} /></span>
          <span>
            <strong>ГУУЛИНГИЙНХАН</strong>
            <small>Миний удам · Манай түүх · Ирээдүйд өвлүүлнэ</small>
          </span>
        </Link>

        <nav className="landing-actions" aria-label="Хэрэглэгчийн хэсэг">
          <Link href="/login" className="landing-login">Нэвтрэх</Link>
          <Link href="/register" className="landing-register">
            Бүртгүүлэх <ArrowRight size={16} />
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow">ГЭР БҮЛИЙН ТҮҮХЭЭ ХАДГАЛ</span>
          <h1>Удам угсаа,<br /><em>дурсамжаа</em> ирээдүйд үлдээ.</h1>
          <p>
            ГУУЛИНГИЙНХАН бол гэр бүлийнхээ ургийн мод, хүмүүс, намтар,
            дурсамж болон түүхийг нэг дор хадгалах дижитал орчин юм.
          </p>
          <div className="landing-cta">
            <Link href="/register" className="landing-primary">
              Ургийн модоо эхлүүлэх <ArrowRight size={18} />
            </Link>
            <Link href="/login" className="landing-secondary">Нэвтрэх</Link>
          </div>
          <div className="landing-trust">
            <Users size={17} />
            <span>Бүртгүүлээд гэр бүлийнхээ хувийн орчноо үүсгээрэй</span>
          </div>
        </div>

        <div className="landing-visual" aria-hidden="true">
          <div className="landing-ring ring-one" />
          <div className="landing-ring ring-two" />
          <div className="landing-tree-card">
            <div className="landing-tree-header">
              <span><TreeDeciduous size={18} /> Ургийн мод</span>
              <small>Хувийн орчин</small>
            </div>
            <div className="landing-tree-lines">
              <span /><span /><span />
            </div>
            <div className="landing-people">
              <i /><i /><i /><i /><i /><i />
            </div>
            <div className="landing-tree-footer">
              <b>Өнгөрсөн</b>
              <span>→</span>
              <b>Ирээдүй</b>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-features" aria-label="Боломжууд">
        {features.map(({ icon: Icon, title, text }) => (
          <article key={title} className="landing-feature">
            <div><Icon size={20} /></div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <footer className="landing-footer">
        <span>ГУУЛИНГИЙНХАН</span>
        <span>Гэр бүлийн түүхийг өнөөдрөөс хадгалъя.</span>
      </footer>
    </main>
  );
}
