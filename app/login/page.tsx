'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, TreeDeciduous } from 'lucide-react';
import { API_BASE, ApiError, api, User } from '../../lib/api';


function authError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх мэдээлэл буруу байна.';
    if (cause.status === 403) return 'Энэ нэвтрэх үйлдлийг одоогоор хийх боломжгүй байна.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 503 || cause.code === 'DATABASE_UNAVAILABLE') {
      return 'Нэвтрэх үйлчилгээ түр хугацаанд боломжгүй байна. Дахин оролдоно уу.';
    }
    if (cause.status >= 500) return 'Нэвтрэх серверийн алдаа гарлаа. Дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return 'Нэвтэрч чадсангүй. Дахин оролдоно уу.';
}

export default function LoginPage() {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/google/config').then((result) => setGoogleEnabled(result.enabled)).catch(() => setGoogleEnabled(false));
    if (new URLSearchParams(window.location.search).get('google') === 'failed') {
      setError('Google-ээр нэвтрэх боломжгүй боллоо. Өмнөх нэвтрэх аргаа ашиглаарай.');
    }
  }, []);

  async function moveToApp() {
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if (invite) {
      router.push(`/invite#token=${encodeURIComponent(invite)}`);
      return;
    }
    try {
      await api('/admin/me');
      router.push('/admin');
    } catch {
      router.push('/dashboard');
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      await api<User>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: values.get('identifier'), password: values.get('password') }) });
      await moveToApp();
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authv2-shell">
      <section className="authv2-frame" aria-label="ГУУЛИНГИЙНХАН нэвтрэх">
        <div className="authv2-story">
          <div className="authv2-story-content">
            <Link href="/" className="authv2-mark-link" aria-label="Нүүр хуудас">
              <span className="authv2-mark"><TreeDeciduous size={27} /></span>
              <span><strong>ГУУЛИНГИЙНХАН</strong><small>Миний удам · Манай түүх</small></span>
            </Link>
            <div className="authv2-story-copy">
              <p className="public-home__eyebrow">ГЭР БҮЛИЙН ӨВ</p>
              <h1>Түүхийнхээ дунд буцаж орно.</h1>
              <p>Хүмүүс, холбоо, дурсамж, түүхээ гэр бүлийнхээ хувийн орчноос үргэлжлүүлэн хадгална.</p>
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
            <h2>Нэвтрэх</h2>
            <p>Гэр бүлийнхээ түүхийг үргэлжлүүлэн хадгалаарай.</p>
          </div>

          {notice && <div className="authv2-message authv2-message--success" role="status">{notice}</div>}
          {error && <div id="login-error" className="authv2-message authv2-message--error" role="alert">{error}</div>}


            <form className="authv2-form" onSubmit={submitEmail}>
              <label htmlFor="login-email">Имэйл эсвэл утасны дугаар</label>
              <input id="login-email" name="identifier" type="text" autoComplete="username" required maxLength={320} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
              <label htmlFor="login-password">Нууц үг</label>
              <div className="authv2-password">
                <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div className="authv2-forgot-row"><Link href="/password-reset">Нууц үгээ мартсан уу?</Link></div>
              <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Нэвтэрч байна…' : 'Нэвтрэх'} <ArrowRight size={16} /></button>
              {googleEnabled && (
                <>
                  <div className="authv2-divider"><span>эсвэл</span></div>
                  <button type="button" className="authv2-google" onClick={() => window.location.assign(API_BASE + '/auth/google/start')}>Google-ээр нэвтрэх</button>
                </>
              )}
            </form>

          <p className="authv2-switch">Бүртгэлгүй юу? <Link href="/register">Бүртгэл үүсгэх</Link></p>
        </div>
      </section>
    </main>
  );
}
