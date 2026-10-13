'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';

type Challenge = {
  challenge_id: string; challenge_token: string; sms_uri: string;
  sms_text: string; display_instruction: string; expires_in: number; resend_after: number;
};

export default function PhoneVerification({ purpose, currentPhone = '', onVerified }: {
  purpose: 'account' | 'recovery'; currentPhone?: string; onVerified: () => void;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const prefix = purpose === 'account' ? 'account-phone' : 'recovery-phone';

  useEffect(() => {
    const controller = new AbortController();
    api<{ verification_provider: string | null }>('/auth/phone/config', { signal: controller.signal })
      .then((value) => setEnabled(value.verification_provider === 'verify_mn'))
      .catch(() => { if (!controller.signal.aborted) setEnabled(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!challenge) return;
    const expires = Date.now() + challenge.expires_in * 1000;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((expires - Date.now()) / 1000)));
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  function fail(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 429) return 'Түр хүлээгээд дахин оролдоно уу.';
    if (cause instanceof ApiError && cause.status === 401) return 'Нэвтрэлт эсвэл одоогийн нууц үгээ шалгана уу.';
    if (cause instanceof ApiError && cause.status === 409) return 'Энэ дугаар баталгаажсан эсвэл холбох боломжгүй байна.';
    if (cause instanceof ApiError && cause.status === 422) return 'Монголын утасны дугаар болон оруулсан мэдээллээ шалгана уу.';
    if (cause instanceof ApiError && cause.status === 400) return 'Баталгаажуулалт хүлээгдэж байна, эсвэл хүсэлтийн хугацаа дууссан байна.';
    return 'Баталгаажуулах үйлчилгээтэй холбогдож чадсангүй. Дахин оролдоно уу.';
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<Challenge>(purpose === 'account'
        ? '/auth/me/phone/verification/request' : '/auth/password-reset/phone/verification/request', {
        method: 'POST', body: JSON.stringify({ phone: values.get('phone'),
          ...(purpose === 'account' ? { current_password: values.get('current_password') } : {}) }),
      });
      form.reset();
      setRemaining(result.expires_in); setChallenge(result);
    } catch (cause) { setError(fail(cause)); }
    finally { setBusy(false); }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy || remaining <= 0 || cooldown > 0) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (purpose === 'recovery' && values.get('password') !== values.get('confirm')) {
      setError('Нууц үг таарахгүй байна.'); return;
    }
    setBusy(true); setError(''); setNotice(''); setCooldown(3);
    try {
      const result = await api<{ status: string } | void>(purpose === 'account'
        ? '/auth/me/phone/verification/confirm' : '/auth/password-reset/phone/verification/confirm', {
        method: 'POST', body: JSON.stringify({ challenge_id: challenge.challenge_id,
          challenge_token: challenge.challenge_token,
          ...(purpose === 'recovery' ? { new_password: values.get('password') } : {}) }),
      });
      if (result?.status === 'pending') { setNotice('SMS баталгаажуулалт хүлээгдэж байна.'); return; }
      if (result?.status === 'expired') { setRemaining(0); return; }
      form.reset(); setChallenge(null); onVerified();
    } catch (cause) { setError(fail(cause)); }
    finally { setBusy(false); }
  }

  return <div className="phone-verification">
    {error && <p id={`${prefix}-error`} className="auth-message error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {enabled === null ? <p role="status">Үйлчилгээний боломжийг шалгаж байна…</p>
      : !enabled ? <p role="status">Утас баталгаажуулах үйлчилгээ одоогоор боломжгүй байна.</p>
      : !challenge ? <form className="settings-inline-form auth-form" onSubmit={start} aria-describedby={error ? `${prefix}-error` : undefined}>
        <label htmlFor={`${prefix}-number`}>{currentPhone ? 'Баталгаажуулах эсвэл шинэ утасны дугаар' : 'Утасны дугаар'}</label>
        <input id={`${prefix}-number`} name="phone" type="tel" autoComplete="tel" defaultValue={currentPhone} maxLength={20} placeholder="99112233" required disabled={busy} />
        {purpose === 'account' && <><label htmlFor={`${prefix}-password`}>Одоогийн нууц үг</label>
          <input id={`${prefix}-password`} name="current_password" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} /></>}
        <p className="settings-help">Өөрийн дугаараас 144773 руу SMS илгээж баталгаажуулна. Нэг SMS-ийн операторын төлбөр 150₮.</p>
        <button className="settings-button settings-button--dark auth-primary" disabled={busy}>{busy ? 'Бэлтгэж байна…' : 'Баталгаажуулалт эхлүүлэх'}</button>
      </form> : <div>
        {remaining > 0 ? <>
          <p>{challenge.display_instruction}</p>
          <p>144773 → <strong>{challenge.sms_text}</strong></p>
          <a className="settings-button settings-button--dark auth-primary" href={`sms:144773?body=${encodeURIComponent(challenge.sms_text)}`}>SMS апп нээх</a>
          <p role="timer" aria-live="off">Хүчинтэй хугацаа: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>
          <form className="settings-inline-form auth-form" onSubmit={confirm} aria-describedby={error ? `${prefix}-error` : undefined}>
            {purpose === 'recovery' && <><label htmlFor={`${prefix}-new-password`}>Шинэ нууц үг</label>
              <input id={`${prefix}-new-password`} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} />
              <label htmlFor={`${prefix}-confirm`}>Нууц үгээ давтах</label>
              <input id={`${prefix}-confirm`} name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} /></>}
            <button className="settings-button settings-button--dark auth-primary" disabled={busy || cooldown > 0}>{busy ? 'Шалгаж байна…' : purpose === 'recovery' ? 'Баталгаажуулаад нууц үг шинэчлэх' : 'Баталгаажуулалтыг шалгах'}</button>
          </form>
        </> : <p role="status">Хугацаа дууслаа. Өмнөх SMS текстийг дахин ашиглахгүй; шинэ хүсэлт эхлүүлнэ үү.</p>}
        <button className="settings-button settings-button--text" type="button" disabled={busy || remaining > Math.max(0, challenge.expires_in - challenge.resend_after)} onClick={() => { setChallenge(null); setNotice(''); setError(''); }}>Шинэ хүсэлт / болих</button>
      </div>}
  </div>;
}
