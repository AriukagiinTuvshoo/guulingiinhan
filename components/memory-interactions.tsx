'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

export type MemoryInteractionSummary = { liked: boolean; like_count: number; comment_count: number };
type Comment = { id: string; body: string; author_name: string; created_at: string; can_edit: boolean; can_delete: boolean };
type Comments = { items: Comment[]; page: number; total: number; has_next: boolean };
function message(error: unknown) {
  if (error instanceof ApiError && error.status === 429) return 'Түр хүлээгээд дахин оролдоно уу.';
  if (error instanceof ApiError && [403, 404].includes(error.status)) return 'Энэ дурсамжид хандах эрх өөрчлөгдсөн байна.';
  return 'Хадгалж чадсангүй. Дахин оролдоно уу.';
}

export default function MemoryInteractions({ memoryId, initial }: { memoryId: string; initial?: MemoryInteractionSummary }) {
  const [summary, setSummary] = useState<MemoryInteractionSummary | null>(initial ?? null);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comments | null>(null);
  const [text, setText] = useState('');
  const [editId, setEditId] = useState('');
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const requestKey = useRef<string | null>(null);
  const base = `/memories/${encodeURIComponent(memoryId)}`;
  const initialLiked = initial?.liked;
  const initialLikes = initial?.like_count;
  const initialComments = initial?.comment_count;
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    if (initialLiked === undefined || retry) void api<MemoryInteractionSummary>(base + '/interactions', { signal: controller.signal })
      .then((item) => { if (alive.current) { setSummary(item); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted && alive.current) setError(message(cause)); });
    else setSummary({ liked: initialLiked, like_count: initialLikes ?? 0, comment_count: initialComments ?? 0 });
    return () => { alive.current = false; controller.abort(); };
  }, [base, initialLiked, initialLikes, initialComments, retry]);
  async function loadComments(page = 1) {
    setReading(true);
    try {
      const result = await api<Comments>(`${base}/comments?page=${page}&page_size=20`);
      if (!alive.current) return;
      setComments(result); setSummary((s) => s ? { ...s, comment_count: result.total } : s);
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setReading(false); }
  }
  async function mutate(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!text.trim()) return;
    requestKey.current ??= crypto.randomUUID();
    void mutate(async () => {
      await api(base + '/comments', { method: 'POST', body: JSON.stringify({ body: text.trim(), request_key: requestKey.current }) });
      if (!alive.current) return;
      setText(''); requestKey.current = null; await loadComments(1);
    });
  }
  return <section className="memory-social" aria-label="Дурсамжийн харилцаа">
    <div className="memory-social-bar">
      <button type="button" aria-pressed={summary?.liked ?? false} disabled={busy || !summary} onClick={() => void mutate(async () => {
        const next = await api<MemoryInteractionSummary>(base + '/like', { method: 'PUT', body: JSON.stringify({ liked: !summary?.liked }) });
        if (alive.current) setSummary(next);
      })}><span aria-hidden="true">{summary?.liked ? '♥' : '♡'}</span> {summary?.liked ? 'Таалагдлаа' : 'Таалагдах'} · {summary?.like_count ?? '—'}</button>
      <button type="button" aria-expanded={open} aria-controls={`comments-${memoryId}`} disabled={reading} onClick={() => { setOpen(!open); if (!open) void loadComments(1); }}>💬 Сэтгэгдэл · {summary?.comment_count ?? '—'}</button>
    </div>
    {error && <p role="alert" className="memory-social-error">{error} <button type="button" onClick={() => { setRetry((n) => n + 1); if (open) void loadComments(1); }}>Дахин оролдох</button></p>}
    {open && <div id={`comments-${memoryId}`} className="memory-comments" aria-busy={reading}>
      {reading ? <p role="status">Сэтгэгдлийг ачаалж байна…</p> : comments?.items.length ? <ol>{comments.items.map((comment) => <li key={comment.id}>
        <div className="memory-comment-heading"><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleDateString('mn-MN')}</time></div>
        {editId === comment.id ? <form onSubmit={(event) => { event.preventDefault(); void mutate(async () => {
          await api(`${base}/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ body: editText }) });
          if (!alive.current) return; setEditId(''); await loadComments(comments.page);
        }); }}><label>Сэтгэгдлээ засах<textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={2000} required /></label><button type="submit" disabled={busy || !editText.trim()}>Хадгалах</button><button type="button" disabled={busy} onClick={() => setEditId('')}>Болих</button></form> : <p className="memory-comment-text">{comment.body}</p>}
        <div className="memory-comment-actions">
          {comment.can_edit && editId !== comment.id && <button type="button" disabled={busy} onClick={() => { setEditId(comment.id); setEditText(comment.body); }}>Засах</button>}
          {comment.can_delete && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Энэ сэтгэгдлийг устгах уу?')) void mutate(async () => { await api(`${base}/comments/${comment.id}`, { method: 'DELETE' }); if (alive.current) await loadComments(1); }); }}>Устгах</button>}
        </div>
      </li>)}</ol> : comments && <p className="memory-comment-empty">💬 Одоогоор сэтгэгдэл алга. Анхны сэтгэгдлээ үлдээгээрэй.</p>}
      {comments && (comments.page > 1 || comments.has_next) && <nav aria-label="Сэтгэгдлийн хуудас"><button type="button" disabled={reading || comments.page <= 1} onClick={() => void loadComments(comments.page - 1)}>Өмнөх</button><span>{comments.page}</span><button type="button" disabled={reading || !comments.has_next} onClick={() => void loadComments(comments.page + 1)}>Дараах</button></nav>}
      <form className="memory-comment-compose" onSubmit={submit}>
        <label htmlFor={`comment-text-${memoryId}`}>Сэтгэгдэл үлдээх</label>
        <textarea id={`comment-text-${memoryId}`} value={text} disabled={busy} onChange={(e) => { setText(e.target.value); requestKey.current = null; }} maxLength={2000} rows={3} placeholder="Энэ мөчийн тухай дурсамжаа хуваалцаарай…" required />
        <button type="submit" disabled={busy || !text.trim()}>{busy ? 'Хадгалж байна…' : 'Сэтгэгдэл илгээх'}</button>
      </form>
    </div>}
  </section>;
}
