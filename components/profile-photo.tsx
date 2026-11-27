'use client';

import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/api';
import { PHOTO_CHANGED_EVENT, type PhotoChange } from '../lib/image-upload';

type ProfilePhotoProps = {
  url: string | null | undefined;
  endpoint?: string;
  name: string;
  fallback: string;
  loadingFallback?: string;
  className: string;
};

export default function ProfilePhoto({ url, endpoint, name, fallback, loadingFallback, className }: ProfilePhotoProps) {
  const [overrideUrl, setOverrideUrl] = useState<string | null | undefined>(undefined);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const effectiveUrl = overrideUrl !== undefined ? overrideUrl : url;
  const [loading, setLoading] = useState(Boolean(effectiveUrl));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setOverrideUrl(undefined);
  }, [url, endpoint]);

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<PhotoChange>).detail;
      if (!detail?.endpoint) return;
      const base = effectiveUrl ? effectiveUrl.split('?')[0] : null;
      const matches = (endpoint && endpoint === detail.endpoint) || (base && base === detail.endpoint);
      if (!matches) return;
      if (detail.hasPhoto) {
        setOverrideUrl(detail.url || `${detail.endpoint}?v=${Date.now()}`);
        setRevision(value => value + 1);
      } else {
        setOverrideUrl(null);
      }
    };
    window.addEventListener(PHOTO_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PHOTO_CHANGED_EVENT, changed);
  }, [effectiveUrl, endpoint]);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const controller = new AbortController();
    setObjectUrl(null);
    setLoading(Boolean(effectiveUrl));
    if (!effectiveUrl) return;

    const isApiPath = effectiveUrl.startsWith('/');
    const target = isApiPath ? `${API_BASE}${effectiveUrl}` : effectiveUrl;
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
  }, [effectiveUrl, revision]);

  if (objectUrl) return <img className={className} src={objectUrl} alt={`${name}-ийн зураг`} onError={() => setObjectUrl(null)} />;
  return <span className={`${className} profile-photo-fallback`} aria-label={`${name}-ийн зураг`}
    aria-busy={loading && !!loadingFallback} role={loading && loadingFallback ? 'status' : undefined}>
    {loading && loadingFallback ? loadingFallback : fallback}
  </span>;
}
