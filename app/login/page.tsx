'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { API_BASE, ApiError, api, User } from '../../lib/api';
import LivingTreeAuthPortal from '../../components/living-tree-auth-portal';


function authError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх мэдээлэл буруу байна.';
    if (cause.status === 403) {
      return cause.validationMessage || cause.message || 'Энэ нэвтрэх үйлдлийг одоогоор хийх боломжгүй байна.';
    }
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status === 502 || cause.status === 503 || cause.status === 504 || cause.code === 'BACKEND_WAKING' || cause.code === 'DATABASE_UNAVAILABLE') {
      return 'Сервер амарсан горимоос дөнгөж асаж байна. 10 секундийн дараа дахин «Нэвтрэх» дарна уу.';
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
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);

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
    setUnverifiedEmail('');
    setBusy(true);
    const values = new FormData(event.currentTarget);
    const identifier = String(values.get('identifier') || '').trim();
    const wakeTimer = window.setTimeout(() => {
      setNotice('Сервер амарсан горимоос асаж байна, түр хүлээнэ үү (30–50 сек)…');
    }, 4000);
    try {
      await api<User>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password: values.get('password') }) });
      window.clearTimeout(wakeTimer);
      setNotice('');
      await moveToApp();
    } catch (cause) {
      window.clearTimeout(wakeTimer);
      setNotice('');
      setError(authError(cause));
      const detailText = cause instanceof ApiError ? (cause.validationMessage || cause.message || '') : '';
      if (
        cause instanceof ApiError &&
        cause.status === 403 &&
        identifier.includes('@') &&
        /имэйл|баталгаажуул|email|verif/i.test(detailText)
      ) {
        setUnverifiedEmail(identifier);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!unverifiedEmail || resendBusy) return;
    setResendBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/auth/email/verification/request', {
        method: 'POST',
        body: JSON.stringify({ email: unverifiedEmail }),
      });
      setNotice(`Баталгаажуулах холбоосыг ${unverifiedEmail} хаяг руу дахин илгээлээ. Имэйл (болон Spam хавтас)-аа шалгана уу.`);
    } catch (cause) {
      setError(authError(cause));
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <LivingTreeAuthPortal
      mode="login"
      regionLabel="ГУУЛИНГИЙНХАН нэвтрэх"
      headline="Түүхийнхээ дунд буцаж орно."
      subcopy="Алтан мөчир дээр дарж удмын гэрлээ асааж, гэр бүлийнхээ хүмүүс, дурсамж, түүхээ үргэлжлүүлэн хадгалаарай."
    >
      <div className="authv2-heading">
        <p className="public-home__eyebrow">ХУВИЙН ОРОН ЗАЙ</p>
        <h2>Нэвтрэх</h2>
        <p>Гэр бүлийнхээ түүхийг үргэлжлүүлэн хадгалаарай.</p>
      </div>

      {notice && <div className="authv2-message authv2-message--success" role="status">{notice}</div>}
      {error && (
        <div id="login-error" className="authv2-message authv2-message--error" role="alert">
          <div>{error}</div>
          {unverifiedEmail && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => void resendVerification()}
                disabled={resendBusy}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid currentColor',
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {resendBusy ? 'Илгээж байна…' : 'Баталгаажуулах имэйл дахин илгээх'}
              </button>
              <Link href="/email-verification" style={{ fontSize: 12.5, textDecoration: 'underline', color: 'inherit' }}>
                Баталгаажуулах хуудас →
              </Link>
            </div>
          )}
        </div>
      )}

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
    </LivingTreeAuthPortal>
  );
}
