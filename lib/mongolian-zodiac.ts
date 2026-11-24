/**
 * Mongolian Traditional Genealogy & Cultural Calculation Engine
 * - 60-year Sexagenary Cycle (Жаран) & 12-Animal Zodiac (Билгийн тоолол)
 * - 8-Trigram Elemental Seat (Суудал / Хөлөл): Male clockwise from Гал, Female counter-clockwise from Ус
 * - Automatic «Эхийн алдар I & II» Medal calculation
 * - Genitive Case (Харъяалахын тийн ялгал) inflection
 * - Cyrillic -> Traditional Vertical Mongolian Script (Unicode U+1800–U+18AF) transliteration
 */

export type SuudalName =
  | 'Гал'
  | 'Шороо'
  | 'Төмөр'
  | 'Огторгуй'
  | 'Ус'
  | 'Уул'
  | 'Мод'
  | 'Хий';

export const SUUDAL_WHEEL: readonly SuudalName[] = [
  'Гал',
  'Шороо',
  'Төмөр',
  'Огторгуй',
  'Ус',
  'Уул',
  'Мод',
  'Хий',
] as const;

export const SUUDAL_MEANINGS: Record<SuudalName, { element: string; direction: string; note: string }> = {
  Гал: { element: 'Гал махбод', direction: 'Урд зүг', note: 'Илч дулаан, цог хийморийн суудал' },
  Шороо: { element: 'Шороо махбод', direction: 'Баруун урд', note: 'Түвшин тогтуун, бат суурийн суудал' },
  Төмөр: { element: 'Төмөр махбод', direction: 'Баруун зүг', note: 'Бат бэх, шийдэмгий зоригийн суудал' },
  Огторгуй: { element: 'Огторгуй', direction: 'Баруун хойд', note: 'Уужуу тэлүүн, өндөр мэлмийн суудал' },
  Ус: { element: 'Ус махбод', direction: 'Хойд зүг', note: 'Уян хатан, элбэг баяны суудал' },
  Уул: { element: 'Шороо/Уул', direction: 'Зүүн хойд', note: 'Нөмөр нөөлөг, түшиг тулгуурын суудал' },
  Мод: { element: 'Мод махбод', direction: 'Зүүн зүг', note: 'Өсөлт хөгжил, сэргэн мандлын суудал' },
  Хий: { element: 'Хий махбод', direction: 'Зүүн урд', note: 'Хөдөлгөөн, сэргэг ухааны суудал' },
};

const ANIMALS = [
  { name: 'хулгана', label: 'Хулгана', symbol: '🐭' },
  { name: 'үхэр', label: 'Үхэр', symbol: '🐮' },
  { name: 'бар', label: 'Бар', symbol: '🐯' },
  { name: 'туулай', label: 'Туулай', symbol: '🐰' },
  { name: 'луу', label: 'Луу', symbol: '🐲' },
  { name: 'могой', label: 'Могой', symbol: '🐍' },
  { name: 'морин', label: 'Морь', symbol: '🐴' },
  { name: 'хонин', label: 'Хонь', symbol: '🐏' },
  { name: 'бичин', label: 'Бич', symbol: '🐵' },
  { name: 'тахиа', label: 'Тахиа', symbol: '🐓' },
  { name: 'нохой', label: 'Нохой', symbol: '🐕' },
  { name: 'гахай', label: 'Гахай', symbol: '🐗' },
] as const;

// 10 Heavenly Stems mapped to traditional Mongolian color/polarity adjectives (year % 10):
// 4: Хөх (Wood+), 5: Хөхөгчин (Wood-), 6: Улаан (Fire+), 7: Улаагчин (Fire-),
// 8: Шар (Earth+), 9: Шарагчин (Earth-), 0: Цагаан (Metal+), 1: Цагаагчин (Metal-),
// 2: Хар (Water+), 3: Харагчин (Water-)
const STEM_COLORS: Record<number, { color: string; element: string }> = {
  0: { color: 'Цагаан', element: 'Төмөр' },
  1: { color: 'Цагаагчин', element: 'Төмөр' },
  2: { color: 'Хар', element: 'Ус' },
  3: { color: 'Харагчин', element: 'Ус' },
  4: { color: 'Хөх', element: 'Мод' },
  5: { color: 'Хөхөгчин', element: 'Мод' },
  6: { color: 'Улаан', element: 'Гал' },
  7: { color: 'Улаагчин', element: 'Гал' },
  8: { color: 'Шар', element: 'Шороо' },
  9: { color: 'Шарагчин', element: 'Шороо' },
};

export interface MongolianZodiacInfo {
  birthYear: number;
  lunarAge: number;
  zodiacFull: string;       // e.g. "Хөхөгчин үхэр жил"
  animalLabel: string;      // e.g. "Үхэр"
  element: string;          // e.g. "Мод"
  currentYearZodiac: string; // e.g. "Улаан морин жил"
  suudal: SuudalName;
  nextSuudal: SuudalName;
  suudalExplanation: string;
}

export function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const match = String(dateStr).match(/(\d{4})/);
  if (!match) return null;
  const yr = Number(match[1]);
  return yr >= 1000 && yr <= 2200 ? yr : null;
}

export function getYearZodiac(year: number): {
  zodiacFull: string;
  animalLabel: string;
  element: string;
} {
  // Reference: 1984 = Хөх хулгана (1984 % 10 = 4 -> Хөх, (1984 - 4) % 12 = 0 -> хулгана)
  // 1985 = Хөхөгчин үхэр (1985 % 10 = 5 -> Хөхөгчин, (1985 - 4) % 12 = 1 -> үхэр)
  // 2026 = Улаан морин (2026 % 10 = 6 -> Улаан, (2026 - 4) % 12 = 6 -> морин)
  const stemIdx = ((year % 10) + 10) % 10;
  const animalIdx = (((year - 4) % 12) + 12) % 12;
  const stem = STEM_COLORS[stemIdx];
  const animal = ANIMALS[animalIdx];
  return {
    zodiacFull: `${stem.color} ${animal.name} жил`,
    animalLabel: animal.label,
    element: stem.element,
  };
}

/**
 * Computes Mongolian Lunar Zodiac, Lunar Age, and 8-Trigram Suudal (Суудал).
 * Male: starts at Гал (index 0) at lunar age 1, moves clockwise (+1/yr).
 * Female: starts at Ус (index 4) at lunar age 1, moves counter-clockwise (-1/yr).
 */
export function computeMongolianZodiac(
  birthDate: string | null | undefined,
  gender: string | null | undefined,
  referenceYear = new Date().getFullYear(),
): MongolianZodiacInfo | null {
  const birthYear = extractYear(birthDate);
  if (!birthYear || birthYear > referenceYear) return null;

  const lunarAge = Math.max(1, referenceYear - birthYear + 1);
  const birthZodiac = getYearZodiac(birthYear);
  const currentZodiac = getYearZodiac(referenceYear);

  const isFemale = gender === 'female';
  const suudalIndex = (age: number) => {
    const offset = (age - 1) % 8;
    if (isFemale) {
      return (4 - offset + 8) % 8; // Start at Ус (4), counter-clockwise
    }
    return offset % 8; // Start at Гал (0), clockwise
  };

  const suudal = SUUDAL_WHEEL[suudalIndex(lunarAge)];
  const nextSuudal = SUUDAL_WHEEL[suudalIndex(lunarAge + 1)];
  const suudalExplanation = isFemale
    ? `${referenceYear} оны билгийн жилд ${lunarAge} настай — эмэгтэй хүн Уснаас нар буруу тоолно.`
    : `${referenceYear} оны билгийн жилд ${lunarAge} настай — эрэгтэй хүн Галаас нар зөв тоолно.`;

  return {
    birthYear,
    lunarAge,
    zodiacFull: birthZodiac.zodiacFull,
    animalLabel: birthZodiac.animalLabel,
    element: birthZodiac.element,
    currentYearZodiac: currentZodiac.zodiacFull,
    suudal,
    nextSuudal,
    suudalExplanation,
  };
}

export type MotherGloryMedal = {
  degree: 1 | 2;
  title: string;
  subtitle: string;
};

/**
 * Automatic «Эхийн алдар» I & II degree medal calculation for mothers.
 * II degree: 4–5 children, I degree: 6+ children.
 */
export function getMotherGloryMedal(
  gender: string | null | undefined,
  childrenCount: number,
): MotherGloryMedal | null {
  if (gender !== 'female' || childrenCount < 4) return null;
  if (childrenCount >= 6) {
    return {
      degree: 1,
      title: 'Эхийн алдар I зэрэг',
      subtitle: `${childrenCount} хүүхэд төрүүлж өсгөсөн алдарт эх`,
    };
  }
  return {
    degree: 2,
    title: 'Эхийн алдар II зэрэг',
    subtitle: `${childrenCount} хүүхэд төрүүлж өсгөсөн алдарт эх`,
  };
}

/**
 * Mongolian Genitive Case (Харъяалахын тийн ялгал) helper.
 * Examples: Дамдин -> Дамдины, Ядамсүрэн -> Ядамсүрэнгийн, Баавай -> Баавайн, Гүнд -> Гүндийн
 */
export function toMongolianGenitive(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  const isFront = /[эөүе]/.test(lower) && !/[аоуяёю]/.test(lower);

  if (/[айойуйэйүйяйёйюй]$/.test(lower) || lower.endsWith('й')) {
    return `${clean}н`;
  }
  if (lower.endsWith('н')) {
    // Words ending in -н with front/back harmony: Дамдин -> Дамдины, Ядамсүрэн -> Ядамсүрэнгийн
    return isFront ? `${clean}гийн` : `${clean}ы`;
  }
  if (/[аэоөуүяёюеи]$/.test(lower)) {
    return `${clean}гийн`;
  }
  if (/[жчшгк]$/.test(lower)) {
    return `${clean}ийн`;
  }
  return isFront ? `${clean}ийн` : `${clean}ын`;
}

/**
 * Practical Cyrillic -> Traditional Vertical Mongolian Script (Unicode U+1820–U+1842)
 * transliterator for displaying names vertically in Traditional Mongolian Script.
 */
const CYR_TO_MONGOLIAN: Record<string, string> = {
  а: '\u1820',
  э: '\u1821',
  и: '\u1822',
  й: '\u1822',
  ы: '\u1822',
  о: '\u1823',
  у: '\u1824',
  ө: '\u1825',
  ү: '\u1826',
  н: '\u1828',
  б: '\u182A',
  п: '\u182B',
  х: '\u182C',
  г: '\u182D',
  м: '\u182E',
  л: '\u182F',
  с: '\u1830',
  ш: '\u1831',
  т: '\u1832',
  д: '\u1833',
  ч: '\u1834',
  ж: '\u1835',
  з: '\u1835',
  ц: '\u1834',
  я: '\u1836\u1820',
  е: '\u1836\u1821',
  ё: '\u1836\u1823',
  ю: '\u1836\u1824',
  р: '\u1837',
  в: '\u1838',
  ф: '\u1839',
  к: '\u183A',
  ъ: '',
  ь: '\u1822',
};

export function toTraditionalMongolianScript(cyrillic: string | null | undefined): string {
  const clean = (cyrillic ?? '').trim();
  if (!clean) return '';
  let out = '';
  for (const ch of clean.toLowerCase()) {
    if (ch in CYR_TO_MONGOLIAN) {
      out += CYR_TO_MONGOLIAN[ch];
    } else if (ch === ' ' || ch === '-') {
      out += ' ';
    }
  }
  return out.trim();
}
