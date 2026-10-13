'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { API_BASE, api } from '../lib/api';
import { announcePhotoChange, IMAGE_ACCEPT, prepareImageUpload } from '../lib/image-upload';
import './account-photo.css';

export default function AccountPhoto({ endpoint = '/auth/me/photo', hasPhoto, onChanged }: {
  endpoint?: string; hasPhoto: boolean; onChanged: () => void;
}) {
  const [url, setUrl] = useState('');
  const [revision, setRevision] = useState(0);
  const [confirmedPhoto, setConfirmedPhoto] = useState(hasPhoto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fieldId = `account-photo-${endpoint.replace(/[^a-zA-Z0-9]/g, '-')}`;

  useEffect(() => { setConfirmedPhoto(hasPhoto); }, [endpoint, hasPhoto]);

  useEffect(() => {
    const controller = new AbortController();
    let blobUrl = '';
    setUrl('');
    if (confirmedPhoto) {
      fetch(API_BASE + endpoint, { credentials: 'include', cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Photo unavailable');
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          blobUrl = URL.createObjectURL(blob); setUrl(blobUrl);
        }).catch(() => { if (!controller.signal.aborted) setError('Зургийг ачаалж чадсангүй.'); });
    }
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [endpoint, confirmedPhoto, revision]);

  useEffect(() => {
    if (!selected) { setPreview(''); return; }
    const objectUrl = URL.createObjectURL(selected);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selected]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = selected;
    if (!(file instanceof File) || !file.size || busy) return;
    if (file.size > 10 * 1024 * 1024) { setError('Зураг 10 МБ-аас хэтрэхгүй байна.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const prepared = await prepareImageUpload(file);
      const result = await api<{ cleanup_pending: boolean }>(endpoint, { method: 'POST', body: prepared,
        headers: { 'Content-Type': prepared.type, 'X-File-Name': encodeURIComponent(prepared.name) } });
      form.reset(); setSelected(null); setConfirmedPhoto(true); setRevision((value) => value + 1); onChanged();
      announcePhotoChange({ endpoint, hasPhoto: true, url: endpoint });
      setNotice(result.cleanup_pending ? 'Зураг хадгалагдлаа. Өмнөх зургийн цэвэрлэгээ хүлээгдэж байна.' : 'Зураг хадгалагдлаа.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Зургийг хадгалж чадсангүй. Дахин оролдоно уу.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await api(endpoint, { method: 'DELETE' }); setConfirmedPhoto(false); setUrl(''); setSelected(null); if (input.current) input.current.value = ''; onChanged(); announcePhotoChange({ endpoint, hasPhoto: false, url: null }); setNotice('Профайл зураг хасагдлаа.'); }
    catch { setError('Зургийг хасаж чадсангүй.'); }
    finally { setBusy(false); }
  }

  return <div className="account-photo-editor" aria-busy={busy}>
    <div className="account-photo-editor__portrait">
      {(preview || url) ? <img src={preview || url} width={96} height={96} alt={selected ? 'Сонгосон зургийн урьдчилан харах' : 'Аккаунтын профайл зураг'} onError={() => { if (preview) setPreview(''); else setUrl(''); }} /> : <Camera size={32} aria-hidden="true" />}
    </div>
    {error && <p id={`${fieldId}-error`} role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <form className="settings-inline-form" onSubmit={upload} aria-describedby={error ? `${fieldId}-error` : undefined}>
      <label htmlFor={fieldId}>Аккаунтын зураг</label>
      <input ref={input} className="account-photo-editor__file" id={fieldId} name="photo" type="file" accept={IMAGE_ACCEPT} required disabled={busy} onChange={event => { setSelected(event.target.files?.[0] ?? null); setError(''); setNotice(''); }} />
      <button type="button" className="account-photo-editor__pick" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={18} aria-hidden="true" />{selected ? 'Өөр зураг сонгох' : 'Зураг сонгох'}</button>
      {selected && <p className="account-photo-editor__filename" role="status">{selected.name} · {(selected.size / 1024 / 1024).toFixed(1)} МБ</p>}
      <p className="settings-help">Өөрийн удмын профайл зурагтай бол дээд аватарт тэр зураг харагдана. Энэ аккаунтын зураг нь профайл зураггүй үед харагдана. JPG, PNG, WebP · 10 МБ хүртэл. HEIC хөрвүүлэлт browser-ийн дэмжлэгээс хамаарна.</p>
      <button className="settings-button settings-button--dark" disabled={busy || !selected}>{busy ? 'Хадгалж байна…' : 'Зураг хадгалах'}</button>
    </form>
    {confirmedPhoto && <button className="settings-button settings-button--text" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />Аккаунтын зураг хасах</button>}
  </div>;
}
