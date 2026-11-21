'use client';

import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/api';

type ProfilePhotoProps = {
  url: string | null | undefined;
  name: string;
  fallback: string;
  loadingFallback?: string;
  className: string;
};

export default function ProfilePhoto({ url, name, fallback, loadingFallback, className }: ProfilePhotoProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const controller = new AbortController();
    setObjectUrl(null);
    setLoading(Boolean(url));
    if (!url) return;

    const isApiPath = url.startsWith('/');
    const target = isApiPath ? `${API_BASE}${url}` : url;
    if (!target) return;

    fetch(target, {
      credentials: isApiPath ? 'include' : 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return;
        const image = await response.blob();
        if (!active) return;
        createdUrl = URL.createObjectURL(image);
        setObjectUrl(createdUrl);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  if (objectUrl) return <img className={className} src={objectUrl} alt={`${name}-ийн зураг`} onError={() => setObjectUrl(null)} />;
  return <span className={`${className} profile-photo-fallback`} aria-label={`${name}-ийн зураг`}
    aria-busy={loading && !!loadingFallback} role={loading && loadingFallback ? 'status' : undefined}>
    {loading && loadingFallback ? loadingFallback : fallback}
  </span>;
}
