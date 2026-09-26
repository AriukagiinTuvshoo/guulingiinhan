'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, Family } from '../../lib/api';

function familyError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Нэвтрэх шаардлагатай. Нэвтэрсний дараа гэр бүлүүдээ дахин ачаална уу.';
    if (cause.status === 403) return 'Энэ гэр бүлийн мэдээлэлд хандах эрхгүй байна.';
    if (cause.status === 404) return 'Гэр бүл олдсонгүй эсвэл танд хандах эрхгүй байна.';
    if (cause.status === 409) return 'Гэр бүлийн үйлдэл зөрчилтэй байна. Дахин оролдоно уу.';
    if (cause.status === 422) return 'Гэр бүлийн мэдээллийг шалгаад дахин оролдоно уу.';
    if (cause.status === 429) return 'Хэт олон оролдлого байна. Түр хүлээгээд дахин оролдоно уу.';
    if (cause.status >= 500) return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  }
  return 'Гэр бүлүүдийг ачаалж чадсангүй. Холболтоо шалгаад дахин оролдоно уу.';
}

function FamiliesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitFamilyId = searchParams.get('family')?.trim() ?? '';
  const [families, setFamilies] = useState<Family[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadFamilies = useCallback(() => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    setFamilies([]);
    setSelectedFamilyId(null);

    api<Family[]>('/families')
      .then((data) => {
        if (sequence !== requestSequence.current) return;
        setFamilies(data);
      })
      .catch((cause) => {
        if (sequence !== requestSequence.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        setError(familyError(cause));
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
  }, [router]);

  useEffect(() => {
    loadFamilies();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadFamilies]);

  useEffect(() => {
    if (!explicitFamilyId) {
      setSelectedFamilyId(null);
      return;
    }
    const exists = families.some((family) => family.id === explicitFamilyId);
    setSelectedFamilyId(exists ? explicitFamilyId : null);
  }, [explicitFamilyId, families]);

  function selectFamily(familyId: string) {
    if (!families.some((family) => family.id === familyId)) return;
    setSelectedFamilyId(familyId);
    router.replace(`/families?family=${encodeURIComponent(familyId)}`);
  }

  const explicitFamilyInvalid =
    !loading && !error && Boolean(explicitFamilyId) && !families.some((family) => family.id === explicitFamilyId);
  const selectedFamily = selectedFamilyId
    ? families.find((family) => family.id === selectedFamilyId) ?? null
    : null;

  return (
    <main className="mvp" aria-busy={loading}>
      <section className="mvpbox">
        <div className="row space">
          <div>
            <Link href="/dashboard">← Аппын нүүр</Link>
            <h1 style={{ marginTop: 22 }}>Миний гэр бүлүүд</h1>
          </div>
          <div className="row">
            <Link className="button" href="/account/security">Нэвтрэх тохиргоо</Link>
            <Link className="button" href="/onboarding">+ Гэр бүл үүсгэх</Link>
          </div>
        </div>

        {loading ? (
          <p role="status" aria-live="polite">Гэр бүлүүдийг ачаалж байна…</p>
        ) : error ? (
          <div className="error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={loadFamilies}>Дахин оролдох</button>
          </div>
        ) : explicitFamilyInvalid ? (
          <div className="error" role="alert">
            <h2>Гэр бүл олдсонгүй</h2>
            <p>Энэ гэр бүлийн ID таны эрхтэй гэр бүлүүдийн жагсаалтад байхгүй байна. Өөр гэр бүл сонгоно уу.</p>
            <button type="button" onClick={() => router.replace('/families')}>Гэр бүлүүд рүү буцах</button>
          </div>
        ) : families.length === 0 ? (
          <div className="card" style={{ marginTop: 20 }}>
            <h2>Ургийн модоо эхлүүлээрэй</h2>
            <p>Танд одоогоор хандах эрхтэй гэр бүл алга байна.</p>
            <Link className="button" href="/onboarding">Гэр бүл үүсгэх</Link>
          </div>
        ) : (
          <>
            {selectedFamily && (
              <div className="card" style={{ marginTop: 20 }} aria-live="polite">
                <span className="tag">{selectedFamily.role}</span>
                <h2>{selectedFamily.name}</h2>
                {selectedFamily.description && <p>{selectedFamily.description}</p>}
                <div className="row">
                  <Link className="button" href={`/tree?family=${encodeURIComponent(selectedFamily.id)}`}>Ургийн мод нээх →</Link>
                  {selectedFamily.role === 'owner' && (
                    <Link className="button" href={`/invite?family=${encodeURIComponent(selectedFamily.id)}`}>Гишүүн урих</Link>
                  )}
                </div>
              </div>
            )}

            <div className="cards" style={{ marginTop: 20 }}>
              {families.map((family) => {
                const isSelected = selectedFamilyId === family.id;
                return (
                  <article key={family.id} className="card" aria-current={isSelected ? 'true' : undefined}>
                    <span className="tag">{family.role}</span>
                    <h2>{family.name}</h2>
                    {family.description && <p>{family.description}</p>}
                    <div className="row">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => selectFamily(family.id)}
                      >
                        {isSelected ? 'Одоогийн гэр бүл' : 'Сонгох'}
                      </button>
                      <Link className="button" href={`/tree?family=${encodeURIComponent(family.id)}`}>Ургийн мод →</Link>
                      {family.role === 'owner' && (
                        <Link className="button" href={`/invite?family=${encodeURIComponent(family.id)}`}>Гишүүн урих</Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function FamiliesPage() {
  return (
    <Suspense fallback={<main className="mvp"><section className="mvpbox"><p role="status">Гэр бүлүүдийг ачаалж байна…</p></section></main>}>
      <FamiliesContent />
    </Suspense>
  );
}
