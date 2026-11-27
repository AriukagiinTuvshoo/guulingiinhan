'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Edit3, GitBranch, Send, ShieldCheck, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';

type QuizRequestSummary = {
  id: string;
  request_kind: string;
  status: string;
  claimed_generation: number | null;
  branch_person_id: string | null;
  branch_name: string | null;
  anchor_person_id: string | null;
  anchor_name: string | null;
  first_name: string;
  last_name: string;
  user_note: string;
  review_note: string | null;
  created_at: string;
};

type MyQuizResponse = {
  approved: boolean;
  can_direct_edit: boolean;
  linked_person_id: string | null;
  pending_request: QuizRequestSummary | null;
  latest_onboarding: QuizRequestSummary | null;
};

type BranchOption = { id: string; name: string; generation: number };
type AncestorNode = {
  id: string;
  name: string;
  generation: number;
  branch_root_id: string;
  parent_ids: string[];
};
type OnboardingOptions = {
  clan_family_id: string | null;
  root_label: string;
  branches: BranchOption[];
  nodes: AncestorNode[];
};

const GENERATIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function OnboardingQuizCard({
  onNotice,
}: {
  onNotice?: (notice: { kind: 'success' | 'error'; text: string }) => void;
}) {
  const [quiz, setQuiz] = useState<MyQuizResponse | null>(null);
  const [options, setOptions] = useState<OnboardingOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');

  const [branchId, setBranchId] = useState('');
  const [generation, setGeneration] = useState<number>(5);
  const [anchorId, setAnchorId] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLocalError('');
    try {
      const [quizRes, optsRes] = await Promise.all([
        api<MyQuizResponse>('/clan/onboarding/my-quiz'),
        api<OnboardingOptions>('/clan/onboarding/options'),
      ]);
      setQuiz(quizRes);
      setOptions(optsRes);
      setUnavailable(false);

      const active = quizRes.pending_request ?? quizRes.latest_onboarding;
      if (active) {
        setBranchId(active.branch_person_id ?? optsRes.branches[0]?.id ?? '');
        setGeneration(active.claimed_generation ?? 5);
        setAnchorId(active.anchor_person_id ?? active.branch_person_id ?? optsRes.branches[0]?.id ?? '');
        setReason(active.user_note ?? '');
      } else if (optsRes.branches[0]) {
        setBranchId(optsRes.branches[0].id);
        setAnchorId(optsRes.branches[0].id);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setUnavailable(true);
      } else {
        setLocalError('Удмын асуумжийн мэдээллийг ачаалж чадсангүй.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anchorCandidates = useMemo(() => {
    if (!options || !branchId) return [];
    return options.nodes
      .filter((n) => n.branch_root_id === branchId && n.generation < generation)
      .sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name, 'mn'));
  }, [options, branchId, generation]);

  useEffect(() => {
    if (!editing || !branchId) return;
    if (anchorCandidates.length > 0 && !anchorCandidates.some((n) => n.id === anchorId)) {
      setAnchorId(anchorCandidates[0].id);
    }
  }, [anchorCandidates, anchorId, branchId, editing]);

  if (unavailable) return null;

  const active = quiz?.pending_request ?? quiz?.latest_onboarding ?? null;
  const isPending = Boolean(quiz?.pending_request);
  const canDirectEdit = Boolean(quiz?.can_direct_edit && quiz?.pending_request);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !branchId || !anchorId) return;
    setSaving(true);
    setLocalError('');
    try {
      if (canDirectEdit && quiz?.pending_request) {
        await api(`/clan/onboarding/requests/${encodeURIComponent(quiz.pending_request.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            branch_person_id: branchId,
            claimed_generation: generation,
            anchor_person_id: anchorId,
            reason: reason.trim() || null,
          }),
        });
        onNotice?.({ kind: 'success', text: 'Асуумжийн мэдээлэл амжилттай шинэчлэгдлээ.' });
      } else {
        await api('/clan/onboarding/correction-request', {
          method: 'POST',
          body: JSON.stringify({
            branch_person_id: branchId,
            claimed_generation: generation,
            anchor_person_id: anchorId,
            reason: reason.trim() || null,
          }),
        });
        onNotice?.({
          kind: 'success',
          text: 'Засварлах хүсэлт админд илгээгдлээ. Шалгаж баталсны дараа таны үе болон холбоос шинэчлэгдэнэ.',
        });
      }
      setEditing(false);
      await load();
    } catch (cause) {
      const msg =
        cause instanceof ApiError
          ? cause.validationMessage || cause.message
          : 'Хадгалах үед алдаа гарлаа. Дахин оролдоно уу.';
      setLocalError(msg);
      onNotice?.({ kind: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="settings-v2-card" aria-label="Удмын анхны асуумж">
      <div className="settings-v2-row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="settings-v2-icon-title">
          <GitBranch size={18} />
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Удмын бүртгэлийн асуумж</h2>
            <small>
              Анх нэвтрэхдээ сонгосон салбар, үе болон өвөг дээдсийн холболт.
            </small>
          </div>
        </div>

        {!loading && (
          <span className={`settings-v2-badge ${isPending ? '' : quiz?.approved ? 'is-ok' : ''}`}>
            {isPending ? (
              <>
                <Clock size={13} /> Админ шалгаж байна
              </>
            ) : quiz?.approved ? (
              <>
                <Check size={13} /> Баталгаажсан
              </>
            ) : (
              'Бүртгэгдээгүй'
            )}
          </span>
        )}
      </div>

      {localError && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            marginBottom: 14,
            background: 'rgba(158, 42, 34, 0.08)',
            border: '1px solid rgba(158, 42, 34, 0.25)',
            color: 'var(--red, #9e2a22)',
            fontSize: 13,
          }}
        >
          {localError}
        </div>
      )}

      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ui-text-muted)' }}>Асуумжийн мэдээллийг ачаалж байна…</p>
      ) : !editing ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              padding: 14,
              borderRadius: 14,
              background: 'var(--ui-bg, #f7f0e3)',
              border: '1px solid var(--ui-border, #ebd59a)',
              marginBottom: 14,
            }}
          >
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 4 }}>
                Удмын салбар
              </span>
              <strong style={{ fontSize: 14.5 }}>{active?.branch_name || 'Сонгогдоогүй'}</strong>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 4 }}>
                Бүртгүүлсэн үе
              </span>
              <strong style={{ fontSize: 14.5 }}>
                {active?.claimed_generation ? `${active.claimed_generation}-р үе` : 'Тодорхойгүй'}
              </strong>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 4 }}>
                Холбогдох өвөг / эцэг эх
              </span>
              <strong style={{ fontSize: 14.5 }}>{active?.anchor_name || 'Тодорхойгүй'}</strong>
            </div>
          </div>

          {isPending && (
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ui-text-muted)', lineHeight: 1.5 }}>
              Таны хүсэлт админы баталгаажуулалт хүлээж байна. Андуурч бөглөсөн зүйл байвал одоо шууд засаж хадгалж болно.
            </p>
          )}

          {!isPending && quiz?.approved && (
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ui-text-muted)', lineHeight: 1.5 }}>
              <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
              Та аль хэдийн удмын модонд баталгаажсан тул үе эсвэл салбараа андуурч оруулсан бол засварлах хүсэлт илгээж админаар аюулгүй шинэчлүүлнэ үү.
            </p>
          )}

          {options && options.branches.length > 0 && (
            <button
              type="button"
              className="hush-chip-btn"
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 7 }}
              onClick={() => setEditing(true)}
            >
              <Edit3 size={15} />
              {canDirectEdit ? 'Асуумжаа шууд засах' : 'Үе / салбар засварлах хүсэлт илгээх'}
            </button>
          )}
        </>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Удмын салбар</span>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                style={{ minHeight: 44 }}
              >
                {options?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.generation}-р үе)
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Таны үе</span>
              <select
                value={generation}
                onChange={(e) => setGeneration(Number(e.target.value))}
                required
                style={{ minHeight: 44 }}
              >
                {GENERATIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}-р үе
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Хамгийн ойрын бүртгэлтэй өвөг / эцэг эх</span>
            <select
              value={anchorId}
              onChange={(e) => setAnchorId(e.target.value)}
              required
              style={{ minHeight: 44 }}
            >
              {anchorCandidates.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.generation}-р үе)
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>
              {canDirectEdit ? 'Тайлбар (заавал биш)' : 'Өөрчлөх шалтгаан / тайлбар'}
            </span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Жишээ нь: 4-р үе гэж андуурч бөглөсөн, 5-р үе болгож засуулах хүсэлтэй байна."
              maxLength={600}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid var(--ui-border-strong, #b88a2e)',
                background: 'var(--ui-bg, #f7f0e3)',
                color: 'var(--ui-text, #3b2415)',
                fontSize: 13.5,
                resize: 'vertical',
              }}
            />
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="dash-tree-showcase__open"
              disabled={saving || !branchId || !anchorId}
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
            >
              {canDirectEdit ? <Check size={15} /> : <Send size={15} />}
              {saving ? 'Хадгалж байна…' : canDirectEdit ? 'Өөрчлөлтийг хадгалах' : 'Засварлах хүсэлт илгээх'}
            </button>
            <button
              type="button"
              className="hush-chip-btn"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setLocalError('');
              }}
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <X size={15} /> Болих
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
