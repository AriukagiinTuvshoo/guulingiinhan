'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';

function invitationError(cause: unknown, action: 'accept' | 'create' | 'revoke') {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай.';
    if (cause.status === 403) return action === 'accept'
      ? 'Энэ урилгыг ашиглах эрхгүй байна. Урьсан имэйлээрээ нэвтэрч, шаардлагатай бол имэйлээ баталгаажуулна уу.'
      : 'Энэ урилгыг удирдах эрхгүй байна.';
    if (cause.status === 404) return action === 'accept'
      ? 'Урилга олдсонгүй, хүчингүй болсон эсвэл хугацаа нь дууссан байна.'
      : 'Гэр бүл эсвэл урилга олдсонгүй.';
    if (cause.status === 409) return action === 'accept'
      ? 'Таны гишүүнчлэлийн төлөв аль хэдийн өөрчлөгдсөн байна. Гэр бүлүүдээ шалгана уу.'
      : 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.';
    if (cause.status === 422) return 'Урилгын хүсэлт буруу байна. Дахин шалгана уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Дахин оролдоно уу.';
    if (cause.status === 0) return 'Холболтод асуудал гарлаа. Дахин оролдоно уу.';
  }
  return action === 'accept'
    ? 'Урилгыг хүлээн авч чадсангүй. Дахин оролдоно уу.'
    : 'Үйлдлийг гүйцэтгэж чадсангүй. Дахин оролдоно уу.';
}

export default function InvitePage() {
  const router = useRouter();
  const [familyId, setFamilyId] = useState('');
  const [family, setFamily] = useState<Family | null>(null);
  const [token, setToken] = useState('');
  const [issued, setIssued] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const contextRequestRef = useRef(0);
  const mutationRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    contextRequestRef.current += 1;
  }, []);

  useEffect(() => {
    function syncInvitationContext() {
      const requestId = ++contextRequestRef.current;
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const nextFamilyId = params.get('family') ?? '';
      const nextToken = hashParams.get('token') ?? '';

      setContextLoading(true);
      setError('');
      setIssued(null);
      setDone(false);
      setFamily(null);
      setFamilyId(nextFamilyId);
      setToken(nextToken);

      if (!nextFamilyId) {
        if (requestId === contextRequestRef.current) setContextLoading(false);
        return;
      }

      api<Family>(`/families/${encodeURIComponent(nextFamilyId)}`)
        .then((result) => {
          if (!mountedRef.current || requestId !== contextRequestRef.current) return;
          setFamily(result);
        })
        .catch((cause) => {
          if (!mountedRef.current || requestId !== contextRequestRef.current) return;
          setFamily(null);
          setError(invitationError(cause, 'create'));
        })
        .finally(() => {
          if (mountedRef.current && requestId === contextRequestRef.current) setContextLoading(false);
        });
    }

    syncInvitationContext();
    window.addEventListener('hashchange', syncInvitationContext);
    window.addEventListener('popstate', syncInvitationContext);
    return () => {
      window.removeEventListener('hashchange', syncInvitationContext);
      window.removeEventListener('popstate', syncInvitationContext);
    };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current || !familyId || !family) return;
    mutationRef.current = true;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ id: string; email: string; role: string; expires_at: string }>(
        `/families/${encodeURIComponent(familyId)}/invitations`,
        { method: 'POST', body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) },
      );
      if (!mountedRef.current) return;
      setIssued({ id: result.id, email: result.email });
    } catch (cause) {
      if (mountedRef.current) setError(invitationError(cause, 'create'));
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function accept() {
    if (!token || mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ family_id: string; role: string }>('/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (!mountedRef.current) return;
      if (!result.family_id) {
        setError('Урилгыг хүлээн авсан боловч гэр бүлийн орчныг тодорхойлж чадсангүй.');
        return;
      }
      setDone(true);
      router.replace(`/tree?family=${encodeURIComponent(result.family_id)}`);
    } catch (cause) {
      if (mountedRef.current) setError(invitationError(cause, 'accept'));
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function revoke() {
    if (!issued || !familyId || mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api<void>(
        `/families/${encodeURIComponent(familyId)}/invitations/${encodeURIComponent(issued.id)}`,
        { method: 'DELETE' },
      );
      if (mountedRef.current) setIssued(null);
    } catch (cause) {
      if (mountedRef.current) setError(invitationError(cause, 'revoke'));
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const acceptUncertain = error.includes('Холболтод асуудал') || error.includes('Серверийн алдаа');

  return (
    <main className="mvp">
      <section className="mvpbox" style={{ maxWidth: 620 }} aria-busy={busy || contextLoading}>
        <Link href="/families">← Гэр бүлүүд</Link>
        {token ? (
          <>
            <h1 style={{ marginTop: 22 }}>Гэр бүлийн урилга</h1>
            <p>Урилгыг зөвхөн урьсан, имэйлээ баталгаажуулсан бүртгэлээр авна.</p>
            {contextLoading && <div className="card" role="status" aria-live="polite">Урилгыг шалгаж байна…</div>}
            {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
            {acceptUncertain && (
              <div className="card" style={{ marginTop: 12 }}>
                <p>Хүлээн авах хүсэлтийн эцсийн үр дүн тодорхойгүй байж болзошгүй тул автоматаар дахин илгээгээгүй. Гэр бүлүүдийн жагсаалтаас гишүүнчлэлээ шалгаад шаардлагатай бол урилгаа дахин нээнэ үү.</p>
                <Link className="button" href="/families">Гэр бүлүүдээ шалгах →</Link>
              </div>
            )}
            {done ? (
              <div className="success" role="status" aria-live="polite">Урилгыг хүлээн авлаа. Гэр бүлийн мод руу шилжиж байна…</div>
            ) : (
              <div className="row">
                <button className="primary" disabled={busy || contextLoading} aria-busy={busy} onClick={() => void accept()}>
                  {busy ? 'Шалгаж байна…' : 'Урилга хүлээн авах'}
                </button>
                <Link href={`/login#invite=${encodeURIComponent(token)}`}>Нэвтрэх</Link>
                <Link href={`/register#invite=${encodeURIComponent(token)}`}>Бүртгүүлэх</Link>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 22 }}>{family?.name ?? 'Гэр бүлийн хүн урих'}</h1>
            <p>Урилгыг баталгаажсан и-мэйл хаяг руу илгээнэ. Холбоос 7 хоног хүчинтэй.</p>
            {contextLoading && <div className="card" role="status" aria-live="polite">Гэр бүлийн орчныг шалгаж байна…</div>}
            {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
            <form onSubmit={(event) => void create(event)}>
              <label htmlFor="invite-email">Урих имэйл</label>
              <input id="invite-email" name="email" type="email" maxLength={320} required disabled={busy || contextLoading || !family} />
              <label htmlFor="invite-role">Эрх</label>
              <select id="invite-role" name="role" defaultValue="member" disabled={busy || contextLoading || !family}>
                <option value="member">Гишүүн</option>
                <option value="editor">Засварлагч</option>
              </select>
              <button className="primary" disabled={busy || contextLoading || !family} aria-busy={busy}>
                {busy ? 'Илгээж байна…' : 'Урилга илгээх'}
              </button>
            </form>
            {issued && (
              <div className="card" style={{ marginTop: 18 }}>
                <h2>Урилга илгээгдлээ</h2>
                <p>{issued.email} хаяг руу 7 хоногийн хүчинтэй урилга илгээв.</p>
                <button type="button" disabled={busy} onClick={() => void revoke()}>Урилгыг цуцлах</button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
