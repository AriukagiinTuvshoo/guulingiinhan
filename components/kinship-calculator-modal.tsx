'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GitCommit,
  GitCompare,
  Info,
  Search,
  Users,
  X,
} from 'lucide-react';
import { calculateMongolianKinship, KinshipEdge, KinshipMarriage, KinshipPerson } from '../lib/kinship';
import { useFocusTrap } from '../lib/use-focus-trap';

export interface KinshipCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  people: KinshipPerson[];
  relationships: KinshipEdge[];
  marriages?: KinshipMarriage[];
  initialPersonAId?: string;
}

export function KinshipCalculatorModal({
  isOpen,
  onClose,
  people,
  relationships,
  marriages = [],
  initialPersonAId,
}: KinshipCalculatorModalProps) {
  const [personAId, setPersonAId] = useState<string>(initialPersonAId || (people[0]?.id ?? ''));
  const [personBId, setPersonBId] = useState<string>(people[1]?.id ?? people[0]?.id ?? '');
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, dialogRef, { onEscape: onClose });

  useEffect(() => {
    if (!isOpen) return;
    setSearchA('');
    setSearchB('');
    const nextA = initialPersonAId || people[0]?.id || '';
    setPersonAId(nextA);
    setPersonBId((prev) => {
      if (prev && prev !== nextA && people.some((p) => p.id === prev)) return prev;
      const other = people.find((p) => p.id !== nextA);
      return other?.id ?? nextA;
    });
  }, [isOpen, initialPersonAId, people]);

  const handleSwap = () => {
    setPersonAId(personBId);
    setPersonBId(personAId);
  };

  const personA = useMemo(() => people.find((p) => p.id === personAId), [people, personAId]);
  const personB = useMemo(() => people.find((p) => p.id === personBId), [people, personBId]);

  const kinshipResult = useMemo(() => {
    if (!personAId || !personBId) return null;
    return calculateMongolianKinship(personAId, personBId, people, relationships, marriages);
  }, [personAId, personBId, people, relationships, marriages]);

  const filteredPeopleA = useMemo(() => {
    if (!searchA.trim()) return people;
    const q = searchA.toLowerCase();
    return people.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q)
    );
  }, [people, searchA]);

  const filteredPeopleB = useMemo(() => {
    if (!searchB.trim()) return people;
    const q = searchB.toLowerCase();
    return people.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q)
    );
  }, [people, searchB]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kinship-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--ui-backdrop)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          background: 'var(--ui-surface)',
          color: 'var(--ui-text)',
          borderRadius: '20px',
          maxWidth: '780px',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: 'var(--ui-shadow-modal)',
          border: '1px solid var(--ui-border)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--ui-border)',
            background: 'var(--ui-primary)',
            color: 'var(--ui-primary-contrast)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'var(--brand-primary-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GitCompare size={20} color="var(--ui-primary-contrast)" />
            </div>
            <div>
              <h3 id="kinship-modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 700, letterSpacing: '-0.2px' }}>
                Монгол Ургийн Хамаарлын Тооцоолуур
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', opacity: 0.85 }}>
                Уламжлалт 9 үеийн ёс, авга, нагац, үеэл, хаяалын тооцоолол
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {people.length >= 2 && (
              <button
                type="button"
                onClick={handleSwap}
                style={{
                  background: 'var(--brand-primary-soft)',
                  border: '1px solid var(--gold-border)',
                  borderRadius: '8px',
                  padding: '5px 10px',
                  color: 'var(--ui-primary-contrast)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
                title="Хүмүүсийн байрыг солих (А ↔ Б)"
              >
                ⇄ Солих
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Хаах"
              style={{
                background: 'var(--brand-primary-soft)',
                border: 'none',
                borderRadius: '8px',
                padding: '6px',
                color: 'var(--ui-primary-contrast)',
                cursor: 'pointer',
                display: 'flex',
              }}
              title="Хаах"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {people.length < 2 && (
            <div className="ui-callout ui-callout--warning">
              Ураг төрлийн хамаарал тооцоолохын тулд ургийн модонд дор хаяж 2 хүн бүртгэлтэй байх шаардлагатай.
            </div>
          )}
          {/* Person Selection Controls */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
              padding: '16px',
              background: 'var(--ui-surface-subtle)',
              borderRadius: '14px',
              border: '1px solid var(--ui-border)',
            }}
          >
            {/* Person A (Subject) */}
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: 'var(--ui-text)', marginBottom: '6px' }}>
                1. Үндсэн хүн (Би):
              </label>
              <select
                value={personAId}
                onChange={(e) => setPersonAId(e.target.value)}
                className="ui-select"
                style={{ fontSize: '13.5px', fontWeight: 600 }}
              >
                {filteredPeopleA.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name ? p.last_name + ' ' : ''}{p.first_name} ({p.gender === 'male' ? 'Эр' : 'Эм'})
                  </option>
                ))}
              </select>
            </div>

            {/* Person B (Target) */}
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: 'var(--ui-text)', marginBottom: '6px' }}>
                2. Харьцуулах хүн (Хамаатан):
              </label>
              <select
                value={personBId}
                onChange={(e) => setPersonBId(e.target.value)}
                className="ui-select"
                style={{ fontSize: '13.5px', fontWeight: 600 }}
              >
                {filteredPeopleB.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name ? p.last_name + ' ' : ''}{p.first_name} ({p.gender === 'male' ? 'Эр' : 'Эм'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Calculation Result Showcase Card */}
          {kinshipResult && personA && personB && (
            <div
              style={{
                borderRadius: '16px',
                border: '1.5px solid var(--ui-border)',
                background: 'var(--ui-surface-subtle)',
                overflow: 'hidden',
                boxShadow: 'var(--ui-shadow-sm)',
              }}
            >
              {/* Highlight Result Header */}
              <div
                style={{
                  padding: '24px',
                  background: 'var(--ui-accent-soft)',
                  borderBottom: '1px solid var(--ui-border)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--ui-text-secondary)', marginBottom: '6px' }}>
                  {personA.first_name}-ийн хувьд <strong>{personB.first_name}</strong> нь:
                </div>

                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    color: 'var(--ui-text)',
                    letterSpacing: '-0.3px',
                    margin: '6px 0',
                  }}
                >
                  {kinshipResult.relationshipName}
                </div>

                <div style={{ fontSize: '13.5px', color: 'var(--ui-accent-text)', fontWeight: 600, marginTop: '4px' }}>
                  {kinshipResult.pathDescription}
                </div>
              </div>

              {/* Details and Traditional Rule Checks */}
              <div style={{ padding: '20px 24px', display: 'grid', gap: '16px' }}>
                {/* 9 Generations Status */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    background: kinshipResult.nineGenerationsRuleViolated ? 'var(--ui-warning-bg)' : 'var(--ui-success-bg)',
                    border: kinshipResult.nineGenerationsRuleViolated ? '1px solid var(--ui-warning-border)' : '1px solid var(--ui-success-border)',
                  }}
                >
                  {kinshipResult.nineGenerationsRuleViolated ? (
                    <AlertTriangle size={20} style={{ color: 'var(--ui-warning-text)', flexShrink: 0, marginTop: '2px' }} />
                  ) : (
                    <CheckCircle2 size={20} style={{ color: 'var(--ui-success-text)', flexShrink: 0, marginTop: '2px' }} />
                  )}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: kinshipResult.nineGenerationsRuleViolated ? 'var(--ui-warning-text)' : 'var(--ui-success-text)' }}>
                      {kinshipResult.nineGenerationsRuleViolated
                        ? 'Есөн үе доторх язгуур төрөл (Цус холихыг цээрлэнэ)'
                        : 'Есөн үеэс алсарсан буюу шууд цусан холбоогүй'}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--ui-text-secondary)', marginTop: '3px', lineHeight: 1.5 }}>
                      {kinshipResult.culturalAdvice}
                    </div>
                  </div>
                </div>

                {/* Cultural Explanation Note */}
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    fontSize: '12.5px',
                    color: 'var(--ui-text-muted)',
                    background: 'var(--ui-surface)',
                    border: '1px solid var(--ui-border)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    lineHeight: 1.5,
                  }}
                >
                  <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    Монгол уламжлалд <strong>үеэл</strong> гэдэг нь нэг өвөө, эмээгээс салбарласан 2 дахь үе, <strong>хаяал</strong> нь элэнц өвөөгөөс салбарласан 3 дахь үеийн ах, эгч, дүүг нэрлэдэг.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--ui-border)',
            background: 'var(--ui-surface-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              background: 'var(--ui-primary)',
              color: 'var(--ui-primary-contrast)',
              border: 'none',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Болсон
          </button>
        </div>
      </div>
    </div>
  );
}
