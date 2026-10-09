'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SharedAncestryPage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'shared');
    router.replace(`/tree?${params.toString()}`);
  }, [router]);

  return <main className="tree-page"><p role="status">Үндсэн удмын модыг нээж байна…</p></main>;
}
