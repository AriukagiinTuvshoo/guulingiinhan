'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Plus, Trash2, Users, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';
import SmartDateInput, { normalizeFlexibleDate } from './smart-date-input';

type RelativeRelation = 'parent' | 'spouse' | 'child' | 'sibling';

type RelativeDraft = {
  key: string;
  relation: RelativeRelation;
  last_name: string;
  first_name: string;
  gender: 'male' | 'female' | 'unknown';
  birth_date: string;
  is_alive: boolean;
  email: string;
};

type MyRequestSummary = {
  id: string;
  request_kind: 'onboarding' | 'relatives';
  status: 'pending' | 'approved' | 'rejected';
  relatives_count: number;
  review_note: string | null;
  created_at: string;
};

const RELATION_LABELS: Record<RelativeRelation, string> = {
  parent: 'Эцэг / Эх',
  spouse: 'Хань (Эхнэр / Нөхөр)',
  child: 'Хүүхэд (Хүү / Охин)',
  sibling: 'Ах, эгч, дүү',
};

function createDraft(relation: RelativeRelation = 'parent'): RelativeDraft {
  return {
    key: crypto.randomUUID(),
    relation,
    last_name: '',
    first_name: '',
    gender: 'unknown',
    birth_date: '',
    is_alive: true,
    email: '',
  };
}

export interface ClanRelativesRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: (message: string) => void;
}

export function ClanRelativesRequestModal({
  isOpen,
  onClose,
  onSubmitted,
}: ClanRelativesRequestModalProps) {
  const [relatives, setRelatives] = useState<RelativeDraft[]>(() => [createDraft('parent')]);
  const [note, setNote] = useState('');
  const [myRequests, setMyRequests] = useState<MyRequestSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const dialogRef = useRef<HTMLElement>(null);

  useFocusTrap(isOpen, dialogRef, { onEscape: onClose, disabled: busy });

  const loadMyRequests = useCallback(async () => {
    try {
      const rows = await api<MyRequestSummary[]>('/clan/onboarding/my-requests');
      setMyRequests(rows);
    } catch {
      // ignore if endpoint unavailable
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSuccessMsg('');
    void loadMyRequests();
  }, [isOpen, loadMyRequests]);

  if (!isOpen) return null;

  const hasPending = myRequests.some((r) => r.status === 'pending');

  function addRow(relation: RelativeRelation) {
    if (relatives.length >= 15) {
      setError('Нэг хүсэлтэд хамгийн ихдээ 15 төрөл садан илгээх боломжтой.');
      return;
    }
    setRelatives((prev) => [...prev, createDraft(relation)]);
  }

  function updateRow(key: string, patch: Partial<RelativeDraft>) {
    setRelatives((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRelatives((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setSuccessMsg('');

    const payloadRelatives = [];
    for (let i = 0; i < relatives.length; i += 1) {
      const r = relatives[i];
      if (!r.first_name.trim()) {
        setError(`#${i + 1} мөрийн нэрийг заавал оруулна уу.`);
        return;
      }
      const parsedDate = normalizeFlexibleDate(r.birth_date);
      if (parsedDate.error) {
        setError(`#${i + 1} төрсөн огноо: ${parsedDate.error}`);
        return;
      }
      payloadRelatives.push({
        relation: r.relation,
        first_name: r.first_name.trim(),
        last_name: r.last_name.trim(),
        gender: r.gender,
        birth_date: parsedDate.iso,
        is_alive: r.is_alive,
        email: r.email.trim() || null,
      });
    }

    setBusy(true);
    try {
      await api('/clan/onboarding/relatives-request', {
        method: 'POST',
        body: JSON.stringify({
          relatives: payloadRelatives,
          note: note.trim() || null,
        }),
      });
      const msg = `${payloadRelatives.length} хүний мэдээллийг Админ/Засагчийн баталгаажуулалтад илгээлээ.`;
      setSuccessMsg(msg);
      setRelatives([createDraft('parent')]);
      setNote('');
      await loadMyRequests();
      onSubmitted?.(msg);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.validationMessage || cause.message
          : 'Хүсэлт илгээхэд алдаа гарлаа.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="tree-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clan-relatives-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="tree-modal"
        style={{ maxWidth: 680, width: '100%', maxHeight: '90dvh', overflowY: 'auto' }}
      >
        <div className="tree-modal-head">
          <div>
            <h2 id="clan-relatives-modal-title" style={{ margin: 0 }}>
              Ойрын төрөл нэмэх хүсэлт илгээх
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ui-text-muted, var(--muted))' }}>
              Эцэг эх, хань, хүүхэд, ах эгч дүү нараа 1 дор бүртгүүлж админаар батлуулна уу.
            </p>
          </div>
          <button
            type="button"
            className="tree-modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Хаах"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '0 20px 20px', display: 'grid', gap: 14 }}>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(201,150,43,0.10)',
              border: '1px solid rgba(201,150,43,0.35)',
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            Хүсэлт илгээхдээ тухайн хүний <strong>имэйл хаягийг</strong> оруулбал админ баталмагц тэр имэйлээр <strong>аккаунт автоматаар үүснэ</strong>.
            Тухайн хүн нэвтрэхдээ «Нууц үгээ мартсан уу?» хэсгээр нууц үгээ шинээр зохиож ороод өөрийн мэдээллээ чөлөөтэй засна.
          </div>

          {hasPending && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(201,150,43,0.14)',
                border: '1px solid var(--gold, #c9962b)',
                fontSize: 12.5,
              }}
            >
              <Clock size={16} style={{ flexShrink: 0 }} />
              <span>Таны өмнөх хүсэлт одоогоор Админ/Засагчийн хяналтад хүлээгдэж байна.</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(180,35,24,0.12)',
                border: '1px solid rgba(180,35,24,0.35)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(22,163,74,0.12)',
                border: '1px solid rgba(22,163,74,0.35)',
                fontSize: 13,
              }}
            >
              <CheckCircle2 size={16} />
              <span>{successMsg}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="ui-btn" onClick={() => addRow('parent')} disabled={busy}>
              <Plus size={14} /> Эцэг / Эх
            </button>
            <button type="button" className="ui-btn" onClick={() => addRow('spouse')} disabled={busy}>
              <Plus size={14} /> Хань
            </button>
            <button type="button" className="ui-btn" onClick={() => addRow('child')} disabled={busy}>
              <Plus size={14} /> Хүүхэд
            </button>
            <button type="button" className="ui-btn" onClick={() => addRow('sibling')} disabled={busy}>
              <Plus size={14} /> Ах / Эгч / Дүү
            </button>
          </div>

          <form onSubmit={handleSubmit} className="tree-modal-form" style={{ display: 'grid', gap: 12 }}>
            {relatives.map((rel, idx) => (
              <div
                key={rel.key}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid var(--border, rgba(128,128,128,0.25))',
                  background: 'var(--bg, rgba(0,0,0,0.03))',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>
                    <Users size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
                    #{idx + 1} · {RELATION_LABELS[rel.relation]}
                  </strong>
                  {relatives.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(rel.key)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#e11d48',
                        cursor: 'pointer',
                        fontSize: 12,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Trash2 size={14} /> Хасах
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Хамаарал
                    <select
                      value={rel.relation}
                      onChange={(e) => updateRow(rel.key, { relation: e.target.value as RelativeRelation })}
                      className="input"
                    >
                      <option value="parent">Эцэг / Эх</option>
                      <option value="spouse">Хань</option>
                      <option value="child">Хүүхэд</option>
                      <option value="sibling">Ах, эгч, дүү</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Овог
                    <input
                      value={rel.last_name}
                      onChange={(e) => updateRow(rel.key, { last_name: e.target.value })}
                      placeholder="Овог"
                      className="input"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Нэр *
                    <input
                      value={rel.first_name}
                      onChange={(e) => updateRow(rel.key, { first_name: e.target.value })}
                      required
                      placeholder="Нэр"
                      className="input"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Хүйс
                    <select
                      value={rel.gender}
                      onChange={(e) => updateRow(rel.key, { gender: e.target.value as RelativeDraft['gender'] })}
                      className="input"
                    >
                      <option value="unknown">Тодорхойгүй</option>
                      <option value="male">Эрэгтэй</option>
                      <option value="female">Эмэгтэй</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, alignItems: 'end' }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Төрсөн огноо (заавал биш)
                    <SmartDateInput
                      value={rel.birth_date}
                      onChange={(val: string) => updateRow(rel.key, { birth_date: val })}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Имэйл (заавал биш — аккаунт нээнэ)
                    <input
                      type="email"
                      value={rel.email}
                      onChange={(e) => updateRow(rel.key, { email: e.target.value })}
                      placeholder="ner@example.com"
                      className="input"
                    />
                  </label>
                </div>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={rel.is_alive}
                    onChange={(e) => updateRow(rel.key, { is_alive: e.target.checked })}
                  />
                  Амьд сэрүүн
                </label>
              </div>
            ))}

            <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              Тайлбар (заавал биш)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Жишээ: Миний ээж ба дүүгийн мэдээллийг нэмүүлэх хүсэлт"
                className="input"
              />
            </label>

            <div className="tree-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="tree-button tree-button--secondary" onClick={onClose} disabled={busy}>
                Хаах
              </button>
              <button type="submit" className="tree-button tree-button--primary" disabled={busy || hasPending}>
                {busy ? 'Илгээж байна…' : `Хүсэлт илгээх (${relatives.length})`}
              </button>
            </div>
          </form>

          {myRequests.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border, rgba(128,128,128,0.2))', paddingTop: 10 }}>
              <strong style={{ fontSize: 12.5, display: 'block', marginBottom: 6 }}>Миний илгээсэн хүсэлтүүд</strong>
              <div style={{ display: 'grid', gap: 6 }}>
                {myRequests.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'var(--bg, rgba(0,0,0,0.03))',
                    }}
                  >
                    <span>
                      {item.request_kind === 'relatives' ? 'Ойрын төрөл нэмэх' : 'Элсэлтийн асуумж'} · {item.relatives_count} хүн
                      {item.review_note ? ` — ${item.review_note}` : ''}
                    </span>
                    <strong
                      style={{
                        color:
                          item.status === 'approved'
                            ? '#16a34a'
                            : item.status === 'rejected'
                              ? '#e11d48'
                              : '#d97706',
                      }}
                    >
                      {item.status === 'approved' ? 'Батлагдсан' : item.status === 'rejected' ? 'Татгалзсан' : 'Хүлээгдэж буй'}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
