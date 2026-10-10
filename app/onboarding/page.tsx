'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, type Family, type User } from '../../lib/api';

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts.at(-1) ?? '', last_name: parts.slice(0, -1).join(' ') };
}
const failure = (cause: unknown) => cause instanceof ApiError
  ? cause.validationMessage || cause.message : 'Холболт тасарлаа. Дахин оролдохдоо энэ бүртгэлээ үргэлжлүүлнэ.';

export default function OnboardingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const familyId = params.get('family') || '';
  const [user, setUser] = useState<User | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newFamily, setNewFamily] = useState(false);
  const [consent, setConsent] = useState(false);
  const [revision, setRevision] = useState(0);
  const attempt = useRef<string | null>(null);
  const mounted = useRef(false);
  const family = families.find(item => item.id === familyId);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setLoading(true); setError(''); setUser(null); setFamilies([]); setConsent(false); attempt.current = null;
    Promise.all([api<User>('/auth/me', { signal: controller.signal }), api<Family[]>('/families', { signal: controller.signal })])
      .then(([me, rows]) => {
        if (controller.signal.aborted) return;
        setUser(me); setName(me.display_name); setFamilies(rows);
        setNewFamily(rows.length === 0);
        if (familyId && !rows.some(item => item.id === familyId)) setError('Энэ гэр бүлд нэгдсэн бүртгэл олдсонгүй. Урилгаа хүлээн авах эсвэл өөрийн гэр бүлээ сонгоно уу.');
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { router.replace('/login'); return; }
        setError(failure(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [familyId, revision, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !user || (familyId && !family)) return;
    const values = new FormData(event.currentTarget);
    const familyName = String(values.get('family') || '').trim();
    if (!familyId && !familyName) { setError('Гэр бүлийн нэрээ оруулна уу.'); return; }
    if (!user.person_id && !name.trim()) { setError('Өөрийн нэрээ оруулна уу.'); return; }
    const personName = splitName(name);
    if (!user.person_id && (personName.first_name.length > 120 || personName.last_name.length > 120)) { setError('Нэр болон овог тус бүр 120 тэмдэгтээс урт байж болохгүй.'); return; }
    if (familyId && user.person_id && !consent) { setError('Өөрийн бүртгэлээ энэ гэр бүлийн модонд ашиглах зөвшөөрлөө батална уу.'); return; }
    setBusy(true); setError('');
    try {
      const storageKey = `guulingiinhan:onboarding:${user.id}:${familyId || 'new'}`;
      if (!attempt.current) {
        try { attempt.current = sessionStorage.getItem(storageKey); } catch { /* Browser may disable storage. */ }
        attempt.current ||= crypto.randomUUID();
        try { sessionStorage.setItem(storageKey, attempt.current); } catch { /* In-memory retries retain the same key. */ }
      }
      const result = await api<{ family_id: string; person_id: string }>('/families/onboarding', {
        method: 'POST', body: JSON.stringify({
          request_key: attempt.current,
          ...(familyId ? { family_id: familyId } : { family_name: familyName }),
          ...(!user.person_id ? { ...personName, gender: values.get('gender') || 'unknown' } : {}),
          reuse_existing_person: Boolean(user.person_id && consent),
        }),
      });
      if (!mounted.current) return;
      try { sessionStorage.removeItem(storageKey); } catch { /* No persisted state to clear. */ }
      router.push(`/tree?view=family&family=${encodeURIComponent(result.family_id)}&person=${encodeURIComponent(result.person_id)}`);
    } catch (cause) { if (mounted.current) setError(failure(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <main className="mvp" aria-busy={loading || busy}><section className="mvpbox" style={{ maxWidth: 640 }}>
    <Link href="/families">← Миний гэр бүлүүд</Link>
    <h1 style={{ marginTop: 22 }}>🌳 {familyId ? 'Модонд өөрийгөө бүртгэх' : 'Гэр бүлийн модоо эхлүүлэх'}</h1>
    <p>{familyId ? `${family?.name || 'Гэр бүл'} — байгаа модоо хамтдаа үргэлжлүүлнэ.` : 'Урилгаар нэгдсэн бол байгаа гэр бүлээ сонгоорой. Шинэ мод үүсгэх шаардлагагүй.'}</p>
    {error && <div className="error" role="alert">{error}</div>}
    {loading ? <p role="status">Таны гэр бүл, бүртгэлийг шалгаж байна…</p> : !user ? <button onClick={() => setRevision(value => value + 1)}>Дахин ачаалах</button> : familyId && !family ? <Link className="button" href="/invite">Урилгаа шалгах →</Link> : <>
      {!familyId && families.length > 0 && <section className="card"><h2>Миний гэр бүлүүд</h2><p>Эндээс модоо үргэлжлүүлэх гэр бүлээ сонгоно.</p><div className="cards">{families.map(item => <Link className="button" key={item.id} href={`/people?family=${encodeURIComponent(item.id)}`}>{item.name} →</Link>)}</div>{!user.person_id && <button style={{ marginTop: 16 }} onClick={() => setNewFamily(value => !value)}>{newFamily ? 'Шинэ мод үүсгэхийг болих' : 'Тусдаа шинэ гэр бүл үүсгэх'}</button>}</section>}
      {(familyId || newFamily) && <form onSubmit={submit} style={{ marginTop: 24 }}>
        {!familyId && <label>Гэр бүлийн нэр<input name="family" maxLength={180} required disabled={busy} placeholder="Гэр бүлийн нэр" /></label>}
        {user.person_id ? <><p>Таны аккаунт өмнөх удмын бүртгэлтэй холбогдсон. Нэг хүнийг дахин үүсгэхгүй.</p>{familyId && <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} style={{ width: 22, minWidth: 22 }} />Өөрийн удмын бүртгэлийг энэ гэр бүлийн модонд ашиглахыг зөвшөөрч байна. Миний бусад гэр бүлийн түүх, архив энэ гэр бүлд шилжихгүй.</label>}</> : <><label>Таны нэр<input name="name" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={360} required disabled={busy} /></label><label>Хүйс<select name="gender" defaultValue="unknown" disabled={busy}><option value="unknown">Тодорхойгүй</option><option value="male">Эрэгтэй</option><option value="female">Эмэгтэй</option><option value="other">Бусад</option></select></label><p>Өмнө бүртгэгдсэн бол <Link href={familyId ? `/people?family=${encodeURIComponent(familyId)}` : '/families'}>байгаа бүртгэлтэйгээ холбогдоорой</Link>. Эцэг, эх, ханиа дараагийн алхамд модноос сонгож нэмнэ.</p></>}
        <button className="primary" type="submit" disabled={busy || Boolean(familyId && user.person_id && !consent)}>{busy ? 'Хадгалж байна…' : familyId ? 'Модондоо нэгдэх' : 'Гэр бүлийн модоо эхлүүлэх'}</button>
      </form>}
      {!familyId && <p style={{ marginTop: 24 }}><Link href="/invite">Урилгаар гэр бүлд нэгдэх →</Link></p>}
    </>}
  </section></main>;
}
