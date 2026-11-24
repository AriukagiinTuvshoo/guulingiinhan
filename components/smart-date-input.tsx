'use client';

import { useEffect, useState } from 'react';

const MONTHS = [
  { value: '01', label: '1 сар' },
  { value: '02', label: '2 сар' },
  { value: '03', label: '3 сар' },
  { value: '04', label: '4 сар' },
  { value: '05', label: '5 сар' },
  { value: '06', label: '6 сар' },
  { value: '07', label: '7 сар' },
  { value: '08', label: '8 сар' },
  { value: '09', label: '9 сар' },
  { value: '10', label: '10 сар' },
  { value: '11', label: '11 сар' },
  { value: '12', label: '12 сар' },
];

function daysInMonth(year: number, month: number): number {
  if (!month || month < 1 || month > 12) return 31;
  const safeYear = year >= 1000 && year <= 2100 ? year : 2000;
  return new Date(safeYear, month, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Accepts flexible Mongolian/ISO user inputs:
 * - "1979" -> "1979-01-01"
 * - "19790323" -> "1979-03-23"
 * - "1979.03.23" / "1979/3/23" / "1979-3-23" / "1979 3 23" -> "1979-03-23"
 * - "1979-03" / "1979.3" -> "1979-03-01"
 */
export function normalizeFlexibleDate(raw: string): { iso: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { iso: null, error: null };

  let y = 0;
  let m = 1;
  let d = 1;

  if (/^\d{4}$/.test(trimmed)) {
    y = Number(trimmed);
  } else if (/^\d{8}$/.test(trimmed)) {
    y = Number(trimmed.slice(0, 4));
    m = Number(trimmed.slice(4, 6));
    d = Number(trimmed.slice(6, 8));
  } else {
    const parts = trimmed.split(/[-./\s]+/).filter(Boolean);
    if (parts.length === 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      y = Number(parts[0]);
      m = Number(parts[1]);
    } else if (
      parts.length === 3 &&
      /^\d{4}$/.test(parts[0]) &&
      /^\d{1,2}$/.test(parts[1]) &&
      /^\d{1,2}$/.test(parts[2])
    ) {
      y = Number(parts[0]);
      m = Number(parts[1]);
      d = Number(parts[2]);
    } else {
      return { iso: null, error: 'Огноог Он (ж: 1979) эсвэл Он-Сар-Өдөр (ж: 1979-03-23) хэлбэрээр оруулна уу.' };
    }
  }

  if (y < 1000 || y > 2100) {
    return { iso: null, error: `Он (${y}) 1000–2100 хооронд байх ёстой.` };
  }
  if (m < 1 || m > 12) {
    return { iso: null, error: `Сар (${m}) 1–12 хооронд байх ёстой.` };
  }
  const maxDay = daysInMonth(y, m);
  if (d < 1 || d > maxDay) {
    return { iso: null, error: `${y} оны ${m}-р сард ${d} өдөр байхгүй (1–${maxDay}).` };
  }

  return { iso: `${y}-${pad2(m)}-${pad2(d)}`, error: null };
}

function parseIsoParts(value: string): { year: string; month: string; day: string } {
  const norm = normalizeFlexibleDate(value);
  if (!norm.iso) {
    const digits = value.replace(/\D/g, '');
    return { year: digits.slice(0, 4), month: '', day: '' };
  }
  const [year, month, day] = norm.iso.split('-');
  return { year, month, day };
}

export default function SmartDateInput({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: string;
  onChange: (isoOrPartial: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const initial = parseIsoParts(value);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  useEffect(() => {
    if (!value) {
      setYear('');
      setMonth('');
      setDay('');
      return;
    }
    const parsed = parseIsoParts(value);
    if (parsed.year && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setYear(parsed.year);
      setMonth(parsed.month);
      setDay(parsed.day);
    }
  }, [value]);

  function emit(nextY: string, nextM: string, nextD: string) {
    const cleanY = nextY.replace(/\D/g, '');
    if (!cleanY) {
      onChange('');
      return;
    }
    if (cleanY.length < 4) {
      onChange(cleanY);
      return;
    }
    const yNum = Number(cleanY.slice(0, 4));
    const mNum = nextM ? Number(nextM) : 1;
    const maxD = daysInMonth(yNum, mNum);
    const dNum = nextD ? Math.min(Number(nextD), maxD) : 1;
    onChange(`${cleanY.slice(0, 4)}-${pad2(mNum)}-${pad2(dNum)}`);
  }

  function handleYearInput(raw: string) {
    // Allow pasting or typing full dates like "19790323" or "1979.03.23" directly into the Year box!
    const norm = normalizeFlexibleDate(raw);
    if (norm.iso && raw.trim().length >= 6) {
      const [y, m, d] = norm.iso.split('-');
      setYear(y);
      setMonth(m);
      setDay(d);
      onChange(norm.iso);
      return;
    }
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    if (digits.length === 8) {
      const compact = normalizeFlexibleDate(digits);
      if (compact.iso) {
        const [y, m, d] = compact.iso.split('-');
        setYear(y);
        setMonth(m);
        setDay(d);
        onChange(compact.iso);
        return;
      }
    }
    const y4 = digits.slice(0, 4);
    setYear(y4);
    emit(y4, month, day);
  }

  const maxDay = daysInMonth(Number(year) || 2000, Number(month) || 1);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(86px, 1.2fr) minmax(80px, 1fr) minmax(72px, 0.9fr)',
        gap: 6,
        alignItems: 'center',
      }}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={year}
        disabled={disabled}
        onChange={(e) => handleYearInput(e.target.value)}
        placeholder="Он (1979)"
        aria-label="Он"
        style={{ width: '100%', minWidth: 0 }}
      />
      <select
        value={month}
        disabled={disabled}
        onChange={(e) => {
          const nextM = e.target.value;
          setMonth(nextM);
          emit(year, nextM, day);
        }}
        aria-label="Сар"
        style={{ width: '100%', minWidth: 0 }}
      >
        <option value="">Сар</option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        value={day}
        disabled={disabled}
        onChange={(e) => {
          const nextD = e.target.value;
          setDay(nextD);
          emit(year, month, nextD);
        }}
        aria-label="Өдөр"
        style={{ width: '100%', minWidth: 0 }}
      >
        <option value="">Өдөр</option>
        {Array.from({ length: maxDay }, (_, i) => pad2(i + 1)).map((d) => (
          <option key={d} value={d}>
            {Number(d)}
          </option>
        ))}
      </select>
    </div>
  );
}
