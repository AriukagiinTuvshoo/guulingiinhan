'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useFocusTrap } from '../lib/use-focus-trap';

export type ClanReviewRelative = {
  relation: string;
  first_name: string;
  last_name?: string;
  gender?: string;
  birth_date?: string | null;
  email?: string | null;
};

export type ClanReviewRequest = {
  id: string;
  family_id: string;
  request_kind?: 'onboarding' | 'relatives';
  user_id: string;
  user_email?: string | null;
  user_display_name?: string | null;
  first_name: string;
  last_name: string;
  gender: string;
  claimed_generation?: number | null;
  branch_name?: string | null;
  anchor_name?: string | null;
  relatives: ClanReviewRelative[];
  user_note?: string;
  created_at: string;
};

const RELATION_LABEL: Record<string, string> = {
  parent: 'Эцэг/Эх',
  spouse: 'Хань',
  child: 'Хүүхэд',
  sibling: 'Ах/эгч/дүү',
};

export interface ClanReviewerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onApproved?: (message: string) => void | Promise<void>;
  onCountChange?: (count: number) => void;
}

export function ClanReviewerDrawer({
  isOpen,
  onClose,
  onApproved,
  onCountChange,
}: ClanReviewerDrawerProps) {
  const [requests, setRequests] = useState<ClanReviewRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const drawerRef = useRef<HTMLElement>(null);

  useFocusTrap(isOpen, drawerRef, { onEscape: onClose, disabled: Boolean(busyId) });

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await api<ClanReviewRequest[]>('/admin/clan/onboarding/requests');
      setRequests(rows);
      onCountChange?.(rows.length);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.validationMessage || cause.message
          : 'Хүсэлтүүдийг ачаалж чадсангүй.',
      );
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    if (!isOpen) return;
    setNotice('');
    void loadRequests();
  }, [isOpen, loadRequests]);

  if (!isOpen) return null;

  async function handleApprove(req: ClanReviewRequest) {
    if (busyId) return;
    setBusyId(req.id);
    setError('');
    setNotice('');
    try {
      const res = await api<{ created_accounts?: string[]; created_relatives?: number }>(
        `/admin/clan/onboarding/requests/${encodeURIComponent(req.id)}/approve`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const nextList = requests.filter((r) => r.id !== req.id);
      setRequests(nextList);
      onCountChange?.(nextList.length);
      const accs = Array.isArray(res.created_accounts) ? res.created_accounts : [];
      const msg =
        accs.length > 0
          ? `Батлагдлаа! Автомат аккаунт үүссэн: ${accs.join(', ')}`
          : 'Хүсэлт амжилттай батлагдаж удмын модонд холбогдлоо.';
      setNotice(msg);
      await onApproved?.(msg);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.validationMessage || cause.message
          : 'Батлахад алдаа гарлаа.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(req: ClanReviewRequest, banUser: boolean) {
    if (busyId) return;
    if (
      banUser &&
      typeof window !== 'undefined' &&
      !window.confirm('Энэ аккаунтыг ХААЖ (Ban) дахин нэвтрэх боломжгүй болгох уу?')
    ) {
      return;
    }
    setBusyId(req.id);
    setError('');
    setNotice('');
    try {
      await api(`/admin/clan/onboarding/requests/${encodeURIComponent(req.id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          ban_user: banUser,
          review_note: banUser
            ? 'Хуурамч эсвэл гадны аккаунт тул хаагдлаа.'
            : 'Мэдээллээ нягтлаад дахин илгээнэ үү.',
        }),
      });
      const nextList = requests.filter((r) => r.id !== req.id);
      setRequests(nextList);
      onCountChange?.(nextList.length);
      setNotice(banUser ? 'Хүсэлт цуцлагдаж, аккаунт ХААГДЛАА (Ban).' : 'Хүсэлтээс татгалзлаа.');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.validationMessage || cause.message
          : 'Үйлдэл амжилтгүй боллоо.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="tree-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clan-reviewer-drawer-title"
      style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busyId) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className="tree-modal"
        style={{
          width: 'min(520px, 100vw)',
          maxWidth: '100vw',
          height: '100dvh',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="tree-modal-head" style={{ borderBottom: '1px solid var(--border, rgba(128,128,128,0.2))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={18} style={{ color: 'var(--gold, #c9962b)' }} />
            <div>
              <h2 id="clan-reviewer-drawer-title" style={{ margin: 0, fontSize: 17 }}>
                Хүсэлт хянах ({requests.length})
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ui-text-muted, var(--muted))' }}>
                Админ болон Засагчийн 1 товшилтоор батлах самбар
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="ui-btn"
              onClick={() => void loadRequests()}
              disabled={loading || Boolean(busyId)}
              aria-label="Шинэчлэх"
              style={{ padding: '6px 8px' }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="tree-modal-close"
              onClick={onClose}
              disabled={Boolean(busyId)}
              aria-label="Хаах"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gap: 12, alignContent: 'start' }}>
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

          {notice && (
            <div
              role="status"
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(22,163,74,0.12)',
                border: '1px solid rgba(22,163,74,0.35)',
                fontSize: 13,
              }}
            >
              {notice}
            </div>
          )}

          {loading ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Хүсэлтүүдийг ачаалж байна…</p>
          ) : requests.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Одоогоор хүлээгдэж буй хүсэлт алга байна.</p>
          ) : (
            requests.map((req) => {
              const isBusy = busyId === req.id;
              const isRelatives = req.request_kind === 'relatives';
              return (
                <div
                  key={req.id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: '1px solid var(--border, rgba(128,128,128,0.25))',
                    background: 'var(--bg, rgba(0,0,0,0.03))',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14.5 }}>
                          {req.last_name ? `${req.last_name} ` : ''}
                          {req.first_name}
                        </strong>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: isRelatives ? 'rgba(59,130,246,0.15)' : 'rgba(201,150,43,0.18)',
                            color: isRelatives ? '#3b82f6' : 'var(--gold, #b45309)',
                          }}
                        >
                          {isRelatives
                            ? 'Төрөл нэмэх хүсэлт'
                            : req.claimed_generation
                              ? `Шинэ гишүүн · ${req.claimed_generation}-р үе`
                              : 'Шинэ гишүүн'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Аккаунт: <strong>{req.user_email || req.user_display_name || '—'}</strong>
                        {req.branch_name && <> · Салбар: <strong>{req.branch_name}</strong></>}
                        {req.anchor_name && (
                          <>
                            {' · '}
                            {isRelatives ? 'Холбох хүн:' : 'Тулгуур:'} <strong>{req.anchor_name}</strong>
                          </>
                        )}
                      </div>
                      {req.user_note && (
                        <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted)', marginTop: 4 }}>
                          “{req.user_note}”
                        </div>
                      )}
                    </div>
                  </div>

                  {req.relatives && req.relatives.length > 0 && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--card, rgba(255,255,255,0.04))',
                        border: '1px solid var(--border, rgba(128,128,128,0.2))',
                        fontSize: 12,
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <strong>Хамт нэмэх төрлүүд ({req.relatives.length}):</strong>
                      {req.relatives.map((r, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 6,
                              background: 'rgba(128,128,128,0.14)',
                            }}
                          >
                            {RELATION_LABEL[r.relation] || r.relation}
                          </span>
                          <strong>
                            {r.last_name ? `${r.last_name} ` : ''}
                            {r.first_name}
                          </strong>
                          {r.email && (
                            <span style={{ color: 'var(--gold, #b45309)' }}>
                              ✉️ {r.email} (Автомат аккаунт үүснэ)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="ui-btn ui-btn--primary"
                      disabled={Boolean(busyId)}
                      onClick={() => void handleApprove(req)}
                    >
                      <Check size={14} /> {isBusy ? 'Шалгаж байна…' : 'Батлах & Холбох'}
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      disabled={Boolean(busyId)}
                      onClick={() => void handleReject(req, false)}
                    >
                      Татгалзах
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      style={{ color: '#e11d48', borderColor: 'rgba(225,29,72,0.4)' }}
                      disabled={Boolean(busyId)}
                      onClick={() => void handleReject(req, true)}
                    >
                      <Ban size={13} /> Хаах (Ban)
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
