/**
 * Duplicate Person Detection & Family Event Reminders (Birthdays & Memorial Days)
 */

function normalizeMongolianText(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/ө/g, 'о')
    .replace(/ү/g, 'у')
    .replace(/\s+/g, ' ');
}

export interface MinimalPersonForAnalysis {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  death_date?: string | null;
  is_alive?: boolean;
}

export interface DuplicateCandidatePair {
  personA: MinimalPersonForAnalysis;
  personB: MinimalPersonForAnalysis;
  similarityScore: number; // 0..100
  reasons: string[];
}

/**
 * Simple Levenshtein distance for string similarity.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  const normA = normalizeMongolianText(a);
  const normB = normalizeMongolianText(b);
  if (!normA && !normB) return 1;
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshteinDistance(normA, normB);
  return Math.max(0, (maxLen - dist) / maxLen);
}

/**
 * Finds potential duplicate people inside a family list.
 */
export function findDuplicatePeople(people: MinimalPersonForAnalysis[]): DuplicateCandidatePair[] {
  const pairs: DuplicateCandidatePair[] = [];

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const pA = people[i];
      const pB = people[j];

      if (pA.gender && pB.gender && pA.gender !== pB.gender) {
        continue;
      }

      const firstSim = stringSimilarity(pA.first_name || '', pB.first_name || '');
      if (firstSim < 0.8) continue;

      const lastSim =
        pA.last_name && pB.last_name
          ? stringSimilarity(pA.last_name, pB.last_name)
          : 0.85;

      const reasons: string[] = [];
      let score = firstSim * 65 + lastSim * 25;

      if (firstSim === 1 && lastSim === 1) {
        reasons.push('Овог, нэр яг ижил');
      } else if (firstSim >= 0.85) {
        reasons.push('Нэрийн бичлэг маш төстэй');
      }

      const yearA = pA.birth_date ? parseInt(pA.birth_date.slice(0, 4), 10) : null;
      const yearB = pB.birth_date ? parseInt(pB.birth_date.slice(0, 4), 10) : null;

      if (yearA && yearB && !Number.isNaN(yearA) && !Number.isNaN(yearB)) {
        const diff = Math.abs(yearA - yearB);
        if (diff === 0) {
          score += 10;
          reasons.push(`Төрсөн он ижил (${yearA})`);
        } else if (diff <= 2) {
          score += 5;
          reasons.push(`Төрсөн он ойролцоо (${yearA} / ${yearB})`);
        } else {
          // Different birth years > 2 years apart: less likely to be the exact same person unless typo
          score -= 20;
        }
      }

      const roundedScore = Math.min(100, Math.round(score));
      if (roundedScore >= 82 && reasons.length > 0) {
        pairs.push({
          personA: pA,
          personB: pB,
          similarityScore: roundedScore,
          reasons,
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarityScore - a.similarityScore);
}

export interface UpcomingFamilyReminder {
  personId: string;
  personName: string;
  kind: 'birthday' | 'memorial';
  dateStr: string; // MM-DD
  daysUntil: number;
  yearsCount: number | null;
}

/**
 * Computes upcoming birthdays (for living members) and memorial days (for deceased ancestors)
 * within the next `windowDays` (default 60 days).
 */
export function getUpcomingFamilyReminders(
  people: MinimalPersonForAnalysis[],
  today: Date = new Date(),
  windowDays = 60,
): UpcomingFamilyReminder[] {
  const reminders: UpcomingFamilyReminder[] = [];
  const currentYear = today.getFullYear();
  const startOfToday = new Date(currentYear, today.getMonth(), today.getDate());

  const computeDaysUntil = (month: number, day: number): number => {
    let nextDate = new Date(currentYear, month - 1, day);
    if (nextDate < startOfToday) {
      nextDate = new Date(currentYear + 1, month - 1, day);
    }
    const diffMs = nextDate.getTime() - startOfToday.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  };

  for (const p of people) {
    const displayName = [p.last_name, p.first_name].filter(Boolean).join(' ').trim() || 'Нэргүй хүн';

    // 1. Birthday check (only if month & day exist, i.e., YYYY-MM-DD and not Jan 1 placeholder if year-only)
    if (p.birth_date && p.is_alive !== false) {
      const parts = p.birth_date.split('T')[0].split('-');
      if (parts.length === 3) {
        const bYear = parseInt(parts[0], 10);
        const bMonth = parseInt(parts[1], 10);
        const bDay = parseInt(parts[2], 10);
        if (bMonth >= 1 && bMonth <= 12 && bDay >= 1 && bDay <= 31) {
          const daysUntil = computeDaysUntil(bMonth, bDay);
          if (daysUntil <= windowDays) {
            const turningAge = !Number.isNaN(bYear) ? currentYear - bYear + (daysUntil > 0 && new Date(currentYear, bMonth - 1, bDay) < startOfToday ? 1 : 0) : null;
            reminders.push({
              personId: p.id,
              personName: displayName,
              kind: 'birthday',
              dateStr: `${bMonth}-р сарын ${bDay}`,
              daysUntil,
              yearsCount: turningAge && turningAge > 0 ? turningAge : null,
            });
          }
        }
      }
    }

    // 2. Memorial day check for deceased relatives
    if (p.is_alive === false && p.death_date) {
      const parts = p.death_date.split('T')[0].split('-');
      if (parts.length === 3) {
        const dYear = parseInt(parts[0], 10);
        const dMonth = parseInt(parts[1], 10);
        const dDay = parseInt(parts[2], 10);
        if (dMonth >= 1 && dMonth <= 12 && dDay >= 1 && dDay <= 31) {
          const daysUntil = computeDaysUntil(dMonth, dDay);
          if (daysUntil <= windowDays) {
            const yearsPassed = !Number.isNaN(dYear) ? currentYear - dYear : null;
            reminders.push({
              personId: p.id,
              personName: displayName,
              kind: 'memorial',
              dateStr: `${dMonth}-р сарын ${dDay}`,
              daysUntil,
              yearsCount: yearsPassed && yearsPassed > 0 ? yearsPassed : null,
            });
          }
        }
      }
    }
  }

  return reminders.sort((a, b) => a.daysUntil - b.daysUntil);
}
