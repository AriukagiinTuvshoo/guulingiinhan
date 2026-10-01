'use client';

import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/api';

type ProfilePhotoProps = {
  url: string | null | undefined;
  name: string;
  fallback: string;
  className: string;
};

export default function ProfilePhoto({ url, name, fallback, className }: ProfilePhotoProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setObjectUrl(null);
    if (!url) return;

    const isApiPath = url.startsWith('/');
    const target = isApiPath ? `${API_BASE}${url}` : url;
    if (!target) return;

    fetch(target, {
      credentials: isApiPath ? 'include' : 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return;
        const image = await response.blob();
        if (!active) return;
        createdUrl = URL.createObjectURL(image);
        setObjectUrl(createdUrl);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  if (objectUrl) return <img className={className} src={objectUrl} alt={`${name}-ийн зураг`} />;
  return <span className={`${className} profile-photo-fallback`} aria-label={`${name}-ийн зураг`}>{fallback}</span>;
}
