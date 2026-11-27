'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { API_BASE, ApiError, api } from '../../lib/api';
import LivingTreeAuthPortal from '../../components/living-tree-auth-portal';

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

const INVITE_STORAGE_KEY = 'guulin_pending_invite';

function readPendingInviteToken(): string {
  if (typeof window === 'undefined') return '';
  const fromHash =
    new URLSearchParams(window.location.hash.slice(1)).get('invite') ||
    new URLSearchParams(window.location.hash.slice(1)).get('token') ||
    '';
  const fromQuery = new URLSearchParams(window.location.search).get('invite') || '';
  const token = (fromHash || fromQuery).trim();
  if (token) {
    try {
      window.sessionStorage.setItem(INVITE_STORAGE_KEY, token);
    } catch {
      // ignore storage errors
    }
    return token;
  }
  try {
    return (window.sessionStorage.getItem(INVITE_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export default function RegisterPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('email');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const phoneEnabled = true;
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [pendingInvite, setPendingInvite] = useState('');

  useEffect(() => {
    const inviteToken = readPendingInviteToken();
    if (inviteToken) setPendingInvite(inviteToken);
    api<{ enabled: boolean }>('/auth/email/config')
      .then((result) => {
        setEmailEnabled(result.enabled);
        if (!result.enabled) setMode('phone');
      })
      .catch(() => {
        setEmailEnabled(false);
        setMode('phone');
      });
    api<{ enabled: boolean }>('/auth/google/config').then((result) => setGoogleEnabled(result.enabled)).catch(() => setGoogleEnabled(false));
  }, []);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const values = new FormData(event.currentTarget);
    const surname = String(values.get('surname') ?? '').trim();
    const givenName = String(values.get('given_name') ?? '').trim();
    const email = String(values.get('email') ?? '').trim();
    const password = String(values.get('password') ?? '');
    const confirm = String(values.get('confirm') ?? '');
    if (!surname || !givenName) {
      setError('Овог болон нэрээ бүрэн оруулна уу.');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Зөв имэйл хаяг оруулна уу.');
      return;
    }
    if (password.length < 8) {
      setError('Нууц үг 8-аас доошгүй тэмдэгттэй байх ёстой.');
      return;
    }
    if (password !== confirm) {
      setError('Нууц үг таарахгүй байна.');
      return;
    }
    const displayName = composeDisplayName(surname, givenName);
    if (!displayName || displayName.length > 120) {
      setError('Овог, нэрээ шалгана уу. Нийлсэн нэр 120 тэмдэгтээс хэтрэхгүй байх ёстой.');
      return;
    }
    setBusy(true);
    try {
      await api<{ message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      setRegisteredEmail(email);
    } catch (cause) {
      setError(registerError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const form = event.currentTarget;
    const values = new FormData(form);
    const surname = String(values.get('surname') ?? '').trim();
    const givenName = String(values.get('given_name') ?? '').trim();
    const phone = String(values.get('phone') ?? '').trim();
    const password = String(values.get('password') ?? '');
    const confirm = String(values.get('confirm') ?? '');
    if (!surname || !givenName) {
      setError('Овог болон нэрээ бүрэн оруулна уу.');
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      setError('Зөв утасны дугаар оруулна уу (жишээ нь 99112233).');
      return;
    }
    if (password.length < 8) {
      setError('Нууц үг 8-аас доошгүй тэмдэгттэй байх ёстой.');
      return;
    }
    if (password !== confirm) {
      setError('Нууц үг таарахгүй байна.');
      return;
    }
    setBusy(true);
    try {
      const displayName = composeDisplayName(surname, givenName);
      await api<{ message: string }>('/auth/register/phone', {
        method: 'POST',
        body: JSON.stringify({ phone, password, display_name: displayName }),
      });
      // Automatically sign in the newly registered phone user and enter invite or onboarding
      try {
        await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: phone, password }),
        });
        const inviteToken = pendingInvite || readPendingInviteToken();
        if (inviteToken) {
          try { window.sessionStorage.removeItem(INVITE_STORAGE_KEY); } catch { /* ignore */ }
          router.replace(`/invite#token=${encodeURIComponent(inviteToken)}`);
          return;
        }
        router.replace('/onboarding');
        return;
      } catch {
        form.reset();
        setNotice('Бүртгэл амжилттай үүслээ. Одоо нэвтрэх хуудас руу шилжиж байна…');
        const inviteToken = pendingInvite || readPendingInviteToken();
        router.replace(inviteToken ? `/login#invite=${encodeURIComponent(inviteToken)}` : '/login');
      }
    } catch (cause) {
      setError(registerError(cause));
    } finally {
      setBusy(false);
    }
  }

  function chooseMode(nextMode: Mode) {
    setMode(nextMode);
    setRegisteredEmail('');
    setNotice('');
    setError('');
    setPasswordValue('');
    setConfirmValue('');
  }

  const passwordLongEnough = passwordValue.length >= 8;
  const passwordsMatch = confirmValue.length > 0 && passwordValue === confirmValue;
  const passwordMismatch = confirmValue.length > 0 && passwordValue !== confirmValue;

  const passwordChecklist = (
    <div
      className="authv2-help"
      aria-live="polite"
      style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 4 }}
    >
      <span style={{ color: passwordLongEnough ? 'var(--accent-ink)' : undefined, fontWeight: passwordLongEnough ? 600 : 400 }}>
        {passwordLongEnough ? '✓ 8+ тэмдэгт' : '• 8-аас доошгүй тэмдэгт'}
      </span>
      {confirmValue.length > 0 && (
        <span
          style={{
            color: passwordsMatch ? 'var(--accent-ink)' : 'var(--danger-ink, var(--danger))',
            fontWeight: 600,
          }}
        >
          {passwordsMatch ? '✓ Нууц үг таарлаа' : '✕ Нууц үг таарахгүй байна'}
        </span>
      )}
    </div>
  );

  return (
    <LivingTreeAuthPortal
      mode="register"
      regionLabel="ГУУЛИНГИЙНХАН бүртгэл"
      headline="Түүхээ үлдээх орчноо эндээс эхлүүл."
      subcopy="Алтан мөчир дээр дарж удмын гэрлээ асааж, гэр бүлийнхээ холбоо, дурсамжаа дараагийн үедээ үлдээгээрэй."
    >
      <div className="authv2-heading">
        <p className="public-home__eyebrow">ХУВИЙН ОРОН ЗАЙ</p>
        <h2>Бүртгэл үүсгэх</h2>
        <p>Гэр бүлийнхээ хувийн орчноо эхлүүлье.</p>
      </div>

      <div className="authv2-tabs" role="tablist" aria-label="Бүртгүүлэх арга">
        <button type="button" role="tab" aria-selected={mode === 'email'} className={mode === 'email' ? 'active' : ''} onClick={() => chooseMode('email')}>Имэйлээр</button>
        <button type="button" role="tab" aria-selected={mode === 'phone'} className={mode === 'phone' ? 'active' : ''} onClick={() => chooseMode('phone')} disabled={!phoneEnabled}>Утасны дугаараар{!phoneEnabled && <span className="authv2-tab-status">Түр хаалттай</span>}</button>
      </div>

      {pendingInvite && !notice && (
        <div className="authv2-message authv2-message--success" role="status">
          Урилгын холбоос хадгалагдлаа — бүртгэл дуусмагц гэр бүл рүүгээ шууд холбогдоно.
        </div>
      )}
      {notice && <div className="authv2-message authv2-message--success" role="status">{notice}</div>}
      {error && <div id="register-error" className="authv2-message authv2-message--error" role="alert">{error}</div>}

      {emailEnabled === null ? (
        <p className="authv2-availability" role="status">Бүртгэлийн боломжийг шалгаж байна…</p>
      ) : mode === 'email' && !emailEnabled ? (
        <div className="authv2-unavailable" role="status">
          <strong>Имэйл бүртгэл түр хаалттай</strong>
          <p>Баталгаажуулах имэйл илгээх үйлчилгээ тохируулагдаагүй байна. Та «Утасны дугаараар» табаар шууд бүртгүүлж болно.</p>
        </div>
      ) : registeredEmail && mode === 'email' ? (
        <div className="authv2-complete">
          <span className="authv2-complete-mark" aria-hidden="true">✓</span>
          <h3>Бүртгэлийн хүсэлт хүлээн авлаа.</h3>
          <p><strong>{registeredEmail}</strong> хаягт шаардлагатай бол баталгаажуулах холбоос илгээгдэнэ.</p>
          <Link className="authv2-submit authv2-link-button" href={`/email-verification?email=${encodeURIComponent(registeredEmail)}`}>Имэйлээ шалгах <ArrowRight size={16} /></Link>
        </div>
      ) : mode === 'email' ? (
        <form className="authv2-form" noValidate onSubmit={submitEmail} aria-describedby={error ? 'register-error' : undefined}>
          <label htmlFor="register-surname">Овог</label>
          <input id="register-surname" name="surname" autoComplete="family-name" minLength={1} maxLength={59} required />
          <label htmlFor="register-given-name">Нэр</label>
          <input id="register-given-name" name="given_name" autoComplete="given-name" minLength={1} maxLength={59} required />
          <label htmlFor="register-email">Имэйл</label>
          <input id="register-email" name="email" type="email" autoComplete="email" maxLength={320} required />
          <label htmlFor="register-password">Нууц үг</label>
          <div className="authv2-password">
            <input
              id="register-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              required
              aria-describedby="register-password-help"
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          <label htmlFor="register-confirm">Нууц үгээ давтах</label>
          <div className="authv2-password">
            <input
              id="register-confirm"
              name="confirm"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              aria-invalid={passwordMismatch}
              required
            />
            <button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          <div id="register-password-help">{passwordChecklist}</div>
          <button className="authv2-submit" type="submit" disabled={busy}>{busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'} <ArrowRight size={16} /></button>
        </form>
      ) : (
        <form className="authv2-form" noValidate onSubmit={submitPhone} aria-describedby={error ? 'register-error' : undefined}>
          <label htmlFor="register-phone-surname">Овог</label>
          <input id="register-phone-surname" name="surname" autoComplete="family-name" maxLength={59} required />
          <label htmlFor="register-phone-given-name">Нэр</label>
          <input id="register-phone-given-name" name="given_name" autoComplete="given-name" maxLength={59} required />
          <label htmlFor="register-phone">Утасны дугаар</label>
          <input id="register-phone" name="phone" type="tel" autoComplete="tel" maxLength={20} placeholder="99112233" required />
          <label htmlFor="register-phone-password">Нууц үг</label>
          <div className="authv2-password">
            <input
              id="register-phone-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              required
              aria-describedby="register-phone-password-help"
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          <label htmlFor="register-phone-confirm">Нууц үгээ давтах</label>
          <div className="authv2-password">
            <input
              id="register-phone-confirm"
              name="confirm"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              aria-invalid={passwordMismatch}
              required
            />
            <button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? 'Нууц үгийг нуух' : 'Нууц үгийг харуулах'}>{showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          <div id="register-phone-password-help">{passwordChecklist}</div>
          <p className="authv2-help">
            Утасны бүртгэл нь удмын админ таны асуумж болон дугаарыг баталсны дараа удмын модонд бүрэн нэвтрэх эрхтэй болно.
          </p>
          <button type="submit" className="authv2-submit" disabled={busy}>{busy ? 'Бүртгэж байна…' : 'Бүртгэл үүсгэх'} <ArrowRight size={16} /></button>
        </form>
      )}

      {googleEnabled && !registeredEmail && (
        <div style={{ marginTop: 12 }}>
          <div className="authv2-divider"><span>эсвэл</span></div>
          <button
            type="button"
            className="authv2-google"
            onClick={() => window.location.assign(API_BASE + '/auth/google/start')}
          >
            Google-ээр үргэлжлүүлэх
          </button>
        </div>
      )}

      <p className="authv2-switch">
        Аль хэдийн бүртгэлтэй юу?{' '}
        <Link href={pendingInvite ? `/login#invite=${encodeURIComponent(pendingInvite)}` : '/login'}>
          Нэвтрэх
        </Link>
      </p>
    </LivingTreeAuthPortal>
  );
}
