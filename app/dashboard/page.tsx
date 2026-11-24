'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function DashboardRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyId = searchParams.get('family') ?? '';

  useEffect(() => {
    const target = familyId ? `/tree?family=${encodeURIComponent(familyId)}` : '/tree';
    router.replace(target);
  }, [familyId, router]);

  return (
    <main className="heritage-dashboard" style={{ padding: 32, textAlign: 'center' }}>
      <p style={{ color: 'var(--gt)' }}>Удмын мод руу шилжиж байна…</p>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<main style={{ padding: 32, textAlign: 'center' }}>Удмын мод руу шилжиж байна…</main>}>
      <DashboardRedirectInner />
    </Suspense>
  );
}
