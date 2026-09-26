'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Family, User } from '../../lib/api';

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts.at(-1) ?? '', last_name: parts.slice(0, -1).join(' ') };
}

function onboardingError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Нэвтэрсний дараа onboarding-оо үргэлжлүүлнэ үү.';
    if (cause.status === 403) return 'Гэр бүл үүсгэх эрхгүй байна.';
    if (cause.status === 404) return 'Шаардлагатай мэдээлэл олдсонгүй. Дахин шалгана уу.';
    if (cause.status === 409) return 'Гэр бүл үүсгэх үед зөрчил гарлаа. Гэр бүлүүдийн жагсаалтаа шалгана уу.';
    if (cause.status === 422) return 'Оруулсан мэдээллээ шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return 'Холболтын алдаа гарлаа. Хэрэв гэр бүл үүссэн байж болзошгүй бол дахин үүсгэхийн өмнө гэр бүлүүдийн жагсаалтаа шалгана уу.';
}

function validationError(values: FormData) {
  const familyName = String(values.get('family') ?? '').trim();
  const personName = String(values.get('name') ?? '').trim();
  if (!familyName) return 'Гэр бүлийн нэрийг оруулна уу.';
  if (!personName) return 'Өөрийн нэрийг оруулна уу.';
  if (familyName.length > 180) return 'Гэр бүлийн нэр 180 тэмдэгтээс урт байж болохгүй.';
  if (personName.length > 360) return 'Таны нэр 360 тэмдэгтээс урт байж болохгүй.';
  for (const key of ['father', 'mother']) {
    const value = String(values.get(key) ?? '').trim();
    if (value.length > 360) return 'Эцэг, эхийн нэр 360 тэмдэгтээс урт байж болохгүй.';
  }
  return '';
}

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [createdFamilyId, setCreatedFamilyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountName, setAccountName] = useState('');
  const requestSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const sequence = ++requestSequence.current;
    api<User>('/auth/me')
      .then((me) => {
        if (mounted.current && sequence === requestSequence.current) setAccountName(me.display_name);
      })
      .catch((cause) => {
        if (!mounted.current || sequence !== requestSequence.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(onboardingError(cause));
      })
      .finally(() => {
        if (mounted.current && sequence === requestSequence.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const values = new FormData(event.currentTarget);
    const validation = validationError(values);
    if (validation) {
      setError(validation);
      return;
    }

    const sequence = ++requestSequence.current;
    setBusy(true);
    setError('');
    setCreatedFamilyId(null);

    let family: Family | null = null;
    try {
      family = await api<Family>('/families', {
        method: 'POST',
        body: JSON.stringify({ name: String(values.get('family')).trim() }),
      });

      if (!mounted.current || sequence !== requestSequence.current) return;
      setCreatedFamilyId(family.id);

      const me = await api<{ id: string }>(`/families/${family.id}/persons`, {
        method: 'POST',
        body: JSON.stringify({
          ...splitName(String(values.get('name'))),
          gender: values.get('gender'),
          visibility: 'family',
        }),
      });

      if (!mounted.current || sequence !== requestSequence.current) return;
      await api(`/families/${family.id}/persons/${me.id}/link-me`, { method: 'POST' });

      for (const [key, type] of [['father', 'biological'], ['mother', 'biological']] as const) {
        const name = String(values.get(key) ?? '').trim();
        if (!name) continue;

        const parent = await api<{ id: string }>(`/families/${family.id}/persons`, {
          method: 'POST',
          body: JSON.stringify({
            ...splitName(name),
            gender: key === 'father' ? 'male' : 'female',
            visibility: 'family',
          }),
        });

        if (!mounted.current || sequence !== requestSequence.current) return;
        await api(`/families/${family.id}/relationships/parent-child`, {
          method: 'POST',
          body: JSON.stringify({
            parent_id: parent.id,
            child_id: me.id,
            relationship_type: type,
          }),
        });
      }

      if (mounted.current && sequence === requestSequence.current) {
        router.push(`/tree?family=${encodeURIComponent(family.id)}`);
      }
    } catch (cause) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setError(onboardingError(cause));
      if (family) setCreatedFamilyId(family.id);
    } finally {
      if (mounted.current && sequence === requestSequence.current) setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mvp" aria-busy="true">
        <section className="mvpbox">
          <p role="status" aria-live="polite">Ачаалж байна…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mvp" aria-busy={busy}>
      <section className="mvpbox" style={{ maxWidth: 580 }}>
        <Link href="/families">← Гэр бүлүүд</Link>
        <h1 style={{ marginTop: 22 }}>Ургийн модоо эхлүүлэх</h1>
        <p>Гэр бүлээ үүсгээд өөрийгөө бүртгэж, хүсвэл эцэг эхээ нэмнэ.</p>

        {error && (
          <div className="error" role="alert" aria-live="assertive">
            <p>{error}</p>
            {createdFamilyId && (
              <p>
                Гэр бүл үүссэн байж болох тул дахин үүсгэхээс өмнө{' '}
                <Link href={`/families?family=${encodeURIComponent(createdFamilyId)}`}>
                  үүссэн гэр бүлээ шалгана уу
                </Link>
                .
              </p>
            )}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <label>
            Гэр бүлийн нэр
            <input name="family" placeholder="ГУУЛИНГИЙНХАН" maxLength={180} required disabled={busy} />
          </label>

          <label>
            Таны нэр
            <input
              name="name"
              autoComplete="name"
              required
              maxLength={360}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              disabled={busy}
            />
          </label>

          <label>
            Хүйс
            <select name="gender" defaultValue="unknown" disabled={busy}>
              <option value="unknown">Тодорхойгүй</option>
              <option value="male">Эрэгтэй</option>
              <option value="female">Эмэгтэй</option>
              <option value="other">Бусад</option>
            </select>
          </label>

          <div className="row">
            <label style={{ flex: 1 }}>
              Эцгийн нэр
              <input name="father" maxLength={360} disabled={busy} />
            </label>
            <label style={{ flex: 1 }}>
              Эхийн нэр
              <input name="mother" maxLength={360} disabled={busy} />
            </label>
          </div>

          <button className="primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'Үүсгэж байна…' : 'Гэр бүлээ үүсгэх'}
          </button>
        </form>
      </section>
    </main>
  );
}
