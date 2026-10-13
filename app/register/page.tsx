'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, ArrowRight, TreeDeciduous } from 'lucide-react';
import { ApiError, api } from '../../lib/api';

type Mode = 'email' | 'phone';

function composeDisplayName(surname: string, givenName: string) {
  return [surname.trim(), givenName.trim()].filter(Boolean).join(' ');
}

function registerError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 409) return 'Энэ бүртгэлийг одоогоор үүсгэх боломжгүй байна. Мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503 || cause.code === 'DATABASE_UNAVAILABLE') {
      return 'Бүртгэлийн үйлчилгээ түр хугацаанд боломжгүй байна. Дахин оролдоно уу.';
    }
    if (cause.status >= 500) return 'Бүртгэлийн серверийн алдаа гарлаа. Дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return 'Бүртгэл үүсгэж чадсангүй. Дахин оролдоно уу.';
}

export default function RegisterPage() {
  const [mode, setMode] = useState<Mode>('email');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const phoneEnabled = true;
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/email/config').then((result) => setEmailEnabled(result.enabled)).catch(() => setEmailEnabled(false));
  }, []);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') ?? '');
    const confirm = String(values.get('confirm') ?? '');
    if (password !== confirm) {
      setError('Нууц үг таарахгүй байна.');
      return;
    }
    setBusy(true);
    try {
      const email = String(values.get('email') ?? '').trim();
      const displayName = composeDisplayName(
        String(values.get('surname') ?? ''),
        String(values.get('given_name') ?? ''),
      );
      if (!displayName || displayName.length > 120) {
        setError('Овог, нэрээ шалгана уу. Нийлсэн нэр 120 тэмдэгтээс хэтрэхгүй байх ёстой.');
        return;
      }
      const result = await api<{ message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      setRegisteredEmail(email);
      setNotice(result.message);
    } catch (cause) {
      setError(registerError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (values.get('password') !== values.get('confirm')) { setError('Нууц үг таарахгүй байна.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ message: string }>('/auth/register/phone', {
        method: 'POST', body: JSON.stringify({ phone: values.get('phone'), password: values.get('password'),
          display_name: composeDisplayName(String(values.get('surname') ?? ''), String(values.get('given_name') ?? '')) }),
      });
      form.reset(); setNotice(result.message);
    } catch (cause) { setError(registerError(cause)); }
    finally { setBusy(false); }
  }

  function chooseMode(nextMode: Mode) {
    setMode(nextMode);
    setRegisteredEmail('');
    setNotice('');
    setError('');
  }

  return (
    <main className="authv2-shell">
      <section className="authv2-frame" aria-label="ГУУЛИНГИЙНХАН бүртгэл">
        <div className="authv2-story">
          <div className="authv2-story-content">
            <Link href="/" className="authv2-mark-link" aria-label="Нүүр хуудас">
              <span className="authv2-mark"><TreeDeciduous size={27} /></span>
              <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
            </Link>
            <div className="authv2-story-copy">
              <p className="public-home__eyebrow">ГЭР БҮЛИЙН ӨВ</p>
              <h1>Түүхээ үлдээх орчноо эндээс эхлүүл.</h1>
              <p>Гэр бүлийнхээ холбоо, түүх, дурсамжийг бага багаар цуглуулж, дараагийн үедээ үлдээнэ.</p>
            </div>
            <div className="authv2-branch-art" aria-hidden="true"><TreeDeciduous size={132} strokeWidth={1.05} /></div>
            <Link href="/" className="authv2-back">← Нүүр хуудас</Link>
          </div>
        </div>

        <div className="authv2-form-panel">
          <div className="authv2-mobile-brand">
            <Link href="/" className="authv2-mark-link">
              <span className="authv2-mark"><TreeDeciduous size={23} /></span>
              <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
            </Link>
          </div>

          <div className="authv2-heading">
            <p className="public-home__eyebrow">ХУВИЙН ОРОН ЗАЙ</p>
            <h2>Бүртгэл үүсгэх</h2>
            <p>Гэр бүлийнхээ хувийн орчноо эхлүүлье.</p>
          </div>

          <div className="authv2-tabs" role="tablist" aria-label="Бүртгүүлэх арга">
            <button type="button" role="tab" aria-selected={mode === 'email'} className={mode === 'email' ? 'active' : ''} onClick={() => chooseMode('email')}>Имэйлээр</button>
            <button type="button" role="tab" aria-selected={mode === 'phone'} className={mode === 'phone' ? 'active' : ''} onClick={() => chooseMode('phone')} disabled={!phoneEnabled}>Утасны дугаараар{!phoneEnabled && <span className="authv2-tab-status">Түр хаалттай</span>}</button>
          </div>

          {notice && <div className="authv2-message authv2-message--success" role="status">{notice}</div>}
          {error && <div id="register-error" className="authv2-message authv2-message--error" role="alert">{error}</div>}

          {emailEnabled === null ? (
            <p className="authv2-availability" role="status">Бүртгэлийн боломжийг шалгаж байна…</p>
          ) : mode === 'email' && !emailEnabled ? (
            <div className="authv2-unavailable" role="status">
              <strong>Имэйл бүртгэл түр хаалттай</strong>
              <p>Баталгаажуулах имэйл илгээх үйлчилгээ тохируулагдаагүй байна. Тохируулсны дараа эндээс бүртгүүлж болно.</p>
            </div>
          ) : registeredEmail && mode === 'email' ? (
            <div className="authv2-complete">
              <span className="authv2-complete-mark" aria-hidden="true">✓</span>
              <h3>Бүртгэлийн хүсэлт хүлээн авлаа.</h3>
              <p><strong>{registeredEmail}</strong> хаягт шаардлагатай бол баталгаажуулах холбоос илгээгдэнэ.</p>
              <Link className="authv2-submit authv2-link-button" href={`/email-verification?email=${encodeURIComponent(registeredEmail)}`}>Имэйлээ шалгах <ArrowRight size={16} /></Link>
            </div>
          ) : mode === 'email' ? (
            <form className="authv2-form" onSubmit={submitEmail} aria-describedby={error ? 'register-error' : undefined}>
              <label htmlFor="register-surname">Овог</label>
              <input id="register-surname" name="surname" autoComplete="family-name" minLength={1} maxLength={59} required />
              <label htmlFor="register-given-name">Нэр</label>
              <input id="register-given-name" name="given_name" autoComplete="given-name" minLength={1} maxLength={59} required />
              <label htmlFor="register-email">Имэйл</label>
              <input id="register-email" name="email" type="email" autoComplete="email" maxLength={320} required />
              <label htmlFor="register-password">Нууц үг</label>
              <div className="authv2-password">
                <input id="register-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="register-password-help" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              <span id="register-password-help" className="authv2-help">8-аас доошгүй тэмдэгт.</span>
              <label htmlFor="register-confirm">Нууц үгээ дахин оруулна</label>
              <div className="authv2-password">
                <input id="register-confirm" name="confirm" type={showConfirm ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required />
                <button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'} <ArrowRight size={16} /></button>
            </form>
          ) : (
            <form className="authv2-form" onSubmit={submitPhone} aria-describedby={error ? 'register-error' : undefined}>
              <label htmlFor="register-phone-surname">Овог</label>
              <input id="register-phone-surname" name="surname" autoComplete="family-name" maxLength={59} required />
              <label htmlFor="register-phone-given-name">Нэр</label>
              <input id="register-phone-given-name" name="given_name" autoComplete="given-name" maxLength={59} required />
              <label htmlFor="register-phone">Утасны дугаар</label>
              <input id="register-phone" name="phone" type="tel" autoComplete="tel" maxLength={20} placeholder="99112233" required />
              <label htmlFor="register-phone-password">Нууц үг</label>
              <input id="register-phone-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
              <label htmlFor="register-phone-confirm">Нууц үгээ давтах</label>
              <input id="register-phone-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
              <p className="authv2-help">Нэвтэрсний дараа Тохиргооноос утсаа баталгаажуулна. Нэвтрэхэд SMS шаардахгүй.</p>
              <button type="submit" className="authv2-submit" disabled={busy}>{busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'} <ArrowRight size={16} /></button>
            </form>
          )}

          <p className="authv2-switch">Аль хэдийн бүртгэлтэй юу? <Link href="/login">Нэвтрэх</Link></p>
        </div>
      </section>
    </main>
  );
}
