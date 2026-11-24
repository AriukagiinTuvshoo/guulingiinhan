'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LegacyAncestryConnectRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/onboarding');
  }, [router]);
  return (
    <main style={{ minHeight: '60dvh', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
      <p>Шинэ удмаа баталгаажуулах асуумж руу шилжиж байна…</p>
    </main>
  );
}
