'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_BASE, api } from '../lib/api';

export default function AccountPhoto({ endpoint = '/auth/me/photo', hasPhoto, onChanged }: {
  endpoint?: string; hasPhoto: boolean; onChanged: () => void;
}) {
  const [url, setUrl] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fieldId = `account-photo-${endpoint.replace(/[^a-zA-Z0-9]/g, '-')}`;

  useEffect(() => {
    const controller = new AbortController();
    let blobUrl = '';
    setUrl('');
    if (hasPhoto) {
      fetch(API_BASE + endpoint, { credentials: 'include', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Photo unavailable');
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          blobUrl = URL.createObjectURL(blob); setUrl(blobUrl);
        }).catch(() => { if (!controller.signal.aborted) setError('Зургийг ачаалж чадсангүй.'); });
    }
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [endpoint, hasPhoto, revision]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('photo');
    if (!(file instanceof File) || !file.size || busy) return;
    if (file.size > 10 * 1024 * 1024) { setError('Зураг 10 МБ-аас хэтрэхгүй байна.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ cleanup_pending: boolean }>(endpoint, { method: 'POST', body: file,
        headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } });
      form.reset(); setRevision((value) => value + 1); onChanged();
      setNotice(result.cleanup_pending ? 'Зураг хадгалагдлаа. Өмнөх зургийн цэвэрлэгээ хүлээгдэж байна.' : 'Зураг хадгалагдлаа.');
    } catch { setError('Зургийг хадгалж чадсангүй. JPG, PNG эсвэл WebP зураг сонгоно уу.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await api(endpoint, { method: 'DELETE' }); setUrl(''); onChanged(); setNotice('Профайл зураг хасагдлаа.'); }
    catch { setError('Зургийг хасаж чадсангүй.'); }
    finally { setBusy(false); }
  }

  return <div className="account-photo-editor">
    {url && <img src={url} width={96} height={96} alt="Аккаунтын профайл зураг" style={{ objectFit: 'cover', borderRadius: '50%' }} />}
    {error && <p id={`${fieldId}-error`} role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <form className="settings-inline-form" onSubmit={upload} aria-describedby={error ? `${fieldId}-error` : undefined}>
      <label htmlFor={fieldId}>Аккаунтын зураг</label>
      <input id={fieldId} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} />
      <p className="settings-help">Зураг хувийн орчинд хадгалагдана. JPG, PNG, WebP · 10 МБ хүртэл.</p>
      <button className="settings-button settings-button--dark" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Зураг хадгалах'}</button>
    </form>
    {hasPhoto && <button className="settings-button settings-button--text" type="button" disabled={busy} onClick={() => void remove()}>Аккаунтын зураг хасах</button>}
  </div>;
}
