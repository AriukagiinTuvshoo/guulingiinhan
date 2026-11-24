/**
 * GEDCOM 5.5.1 Standard Exporter and Parser for Guulingiinhan
 *
 * Provides interoperability with international genealogical tools:
 * - FamilySearch, Ancestry, MyHeritage, Gramps
 * - Full support for UTF-8 Mongolian Cyrillic & traditional lineage
 */

export interface GedcomPerson {
  id: string;
  first_name: string;
  last_name: string;
  gender?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  is_alive?: boolean;
  death_date?: string | null;
  death_place?: string | null;
}

export interface GedcomParentChild {
  parent_id: string;
  child_id: string;
}

export interface GedcomMarriage {
  person_1_id: string;
  person_2_id: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
}

/**
 * Formats ISO date (YYYY-MM-DD) to GEDCOM standard date (DD MON YYYY).
 */
function formatGedcomDate(isoDate?: string | null): string | null {
  if (!isoDate) return null;
  const parts = isoDate.split('T')[0].split('-');
  if (parts.length < 3) return isoDate;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const monStr = months[monthIdx] || 'JAN';
  return `${day} ${monStr} ${year}`;
}

/**
 * Exports family pedigree tree data to standard GEDCOM 5.5.1 format string.
 */
export function exportToGedcom(
  familyName: string,
  people: GedcomPerson[],
  relationships: GedcomParentChild[],
  marriages: GedcomMarriage[] = []
): string {
  const lines: string[] = [];

  // 1. Header
  lines.push('0 HEAD');
  lines.push('1 SOUR GUULINGIINHAN');
  lines.push('2 VERS 2.0');
  lines.push('2 NAME Guulingiinhan Mongolian Family Heritage System');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');
  lines.push(`1 NOTE Lineage export for Mongolian family: ${familyName}`);

  // Person ID to GEDCOM xref map (e.g. @I1@)
  const personXrefMap = new Map<string, string>();
  people.forEach((p, idx) => {
    personXrefMap.set(p.id, `@I${idx + 1}@`);
  });

  // Group family units (Parents -> Children)
  // Each union of parents creates a FAM record
  interface FamUnit {
    id: string;
    husbId?: string;
    wifeId?: string;
    childrenIds: string[];
    marrDate?: string | null;
  }

  const famUnits: FamUnit[] = [];
  let famCounter = 1;

  // Track parent pairs
  const childToParentsMap = new Map<string, string[]>();
  for (const rel of relationships) {
    if (!childToParentsMap.has(rel.child_id)) {
      childToParentsMap.set(rel.child_id, []);
    }
    childToParentsMap.get(rel.child_id)!.push(rel.parent_id);
  }

  // Create families from marriages
  for (const m of marriages) {
    const p1 = people.find((p) => p.id === m.person_1_id);
    const p2 = people.find((p) => p.id === m.person_2_id);
    const isP1Male = p1?.gender?.toLowerCase() === 'male';

    famUnits.push({
      id: `@F${famCounter++}@`,
      husbId: isP1Male ? m.person_1_id : m.person_2_id,
      wifeId: isP1Male ? m.person_2_id : m.person_1_id,
      childrenIds: [],
      marrDate: m.start_date,
    });
  }

  // Assign children to corresponding marriage FAM or single-parent FAM
  for (const [childId, parentIds] of childToParentsMap.entries()) {
    let assigned = false;
    for (const fam of famUnits) {
      if (
        (fam.husbId && parentIds.includes(fam.husbId) && fam.wifeId && parentIds.includes(fam.wifeId)) ||
        (parentIds.length === 1 && (fam.husbId === parentIds[0] || fam.wifeId === parentIds[0]))
      ) {
        if (!fam.childrenIds.includes(childId)) {
          fam.childrenIds.push(childId);
        }
        assigned = true;
        break;
      }
    }

    if (!assigned && parentIds.length > 0) {
      // Create new fam unit for parents
      const p1 = people.find((p) => p.id === parentIds[0]);
      const p2 = parentIds.length > 1 ? people.find((p) => p.id === parentIds[1]) : null;
      const isP1Male = p1?.gender?.toLowerCase() === 'male';

      const newFam: FamUnit = {
        id: `@F${famCounter++}@`,
        husbId: isP1Male ? p1?.id : p2?.id,
        wifeId: isP1Male ? p2?.id : p1?.id,
        childrenIds: [childId],
      };
      famUnits.push(newFam);
    }
  }

  // Map person to their FAMC (family where child) and FAMS (family where spouse)
  const personFamc = new Map<string, string[]>();
  const personFams = new Map<string, string[]>();

  for (const fam of famUnits) {
    if (fam.husbId) {
      if (!personFams.has(fam.husbId)) personFams.set(fam.husbId, []);
      personFams.get(fam.husbId)!.push(fam.id);
    }
    if (fam.wifeId) {
      if (!personFams.has(fam.wifeId)) personFams.set(fam.wifeId, []);
      personFams.get(fam.wifeId)!.push(fam.id);
    }
    for (const chId of fam.childrenIds) {
      if (!personFamc.has(chId)) personFamc.set(chId, []);
      personFamc.get(chId)!.push(fam.id);
    }
  }

  // 2. Individuals
  for (const person of people) {
    const xref = personXrefMap.get(person.id);
    if (!xref) continue;

    lines.push(`0 ${xref} INDI`);
    const lastName = person.last_name ? `/${person.last_name}/` : '';
    lines.push(`1 NAME ${person.first_name} ${lastName}`.trim());
    lines.push(`2 GIVN ${person.first_name}`);
    if (person.last_name) {
      lines.push(`2 SURN ${person.last_name}`);
    }

    const sex = person.gender?.toLowerCase() === 'female' ? 'F' : person.gender?.toLowerCase() === 'male' ? 'M' : 'U';
    lines.push(`1 SEX ${sex}`);

    if (person.birth_date || person.birth_place) {
      lines.push('1 BIRT');
      const bDate = formatGedcomDate(person.birth_date);
      if (bDate) lines.push(`2 DATE ${bDate}`);
      if (person.birth_place) lines.push(`2 PLAC ${person.birth_place}`);
    }

    if (person.is_alive === false || person.death_date || person.death_place) {
      lines.push('1 DEAT Y');
      const dDate = formatGedcomDate(person.death_date);
      if (dDate) lines.push(`2 DATE ${dDate}`);
      if (person.death_place) lines.push(`2 PLAC ${person.death_place}`);
    }

    // Link FAMS
    const fams = personFams.get(person.id) || [];
    for (const fId of fams) {
      lines.push(`1 FAMS ${fId}`);
    }

    // Link FAMC
    const famc = personFamc.get(person.id) || [];
    for (const fId of famc) {
      lines.push(`1 FAMC ${fId}`);
    }
  }

  // 3. Families
  for (const fam of famUnits) {
    lines.push(`0 ${fam.id} FAM`);
    if (fam.husbId && personXrefMap.has(fam.husbId)) {
      lines.push(`1 HUSB ${personXrefMap.get(fam.husbId)}`);
    }
    if (fam.wifeId && personXrefMap.has(fam.wifeId)) {
      lines.push(`1 WIFE ${personXrefMap.get(fam.wifeId)}`);
    }
    if (fam.marrDate) {
      lines.push('1 MARR');
      const mDate = formatGedcomDate(fam.marrDate);
      if (mDate) lines.push(`2 DATE ${mDate}`);
    }
    for (const chId of fam.childrenIds) {
      if (personXrefMap.has(chId)) {
        lines.push(`1 CHIL ${personXrefMap.get(chId)}`);
      }
    }
  }

  // 4. Trailer
  lines.push('0 TRLR');

  return lines.join('\n');
}

/**
 * Parses GEDCOM standard string into entities for importing.
 */
export function parseGedcom(gedcomContent: string): {
  people: Array<{
    id: string;
    first_name: string;
    last_name: string;
    gender: string;
    birth_date?: string | null;
    birth_place?: string | null;
    is_alive: boolean;
    death_date?: string | null;
  }>;
  parent_child_relationships: Array<{
    parent_id: string;
    child_id: string;
    relationship_type: string;
  }>;
  marriages: Array<{
    person_1_id: string;
    person_2_id: string;
    status: string;
  }>;
} {
  const lines = gedcomContent.split(/\r?\n/);
  type ParsedGedcomPerson = {
    id: string;
    first_name: string;
    last_name: string;
    gender: string;
    is_alive: boolean;
    birth_date: string | null;
    birth_place: string | null;
    death_date: string | null;
  };
  type ParsedGedcomFamily = {
    id: string;
    husb?: string;
    wife?: string;
    children: string[];
  };
  const peopleMap = new Map<string, ParsedGedcomPerson>();
  const famMap = new Map<string, ParsedGedcomFamily>();

  let currentIndi: ParsedGedcomPerson | null = null;
  let currentFam: ParsedGedcomFamily | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const matchLevel = line.match(/^(\d+)\s+(.+)$/);
    if (!matchLevel) continue;

    const level = parseInt(matchLevel[1], 10);
    const rest = matchLevel[2];

    if (level === 0) {
      const entityMatch = rest.match(/^(@\w+@)\s+(INDI|FAM|HEAD|TRLR)$/);
      if (entityMatch) {
        const xref = entityMatch[1];
        const type = entityMatch[2];
        if (type === 'INDI') {
          currentIndi = {
            id: xref,
            first_name: '',
            last_name: '',
            gender: 'male',
            is_alive: true,
            birth_date: null,
            birth_place: null,
            death_date: null,
          };
          currentFam = null;
          peopleMap.set(xref, currentIndi);
        } else if (type === 'FAM') {
          currentFam = {
            id: xref,
            children: [],
          };
          currentIndi = null;
          famMap.set(xref, currentFam);
        } else {
          currentIndi = null;
          currentFam = null;
        }
      } else {
        currentIndi = null;
        currentFam = null;
      }
      continue;
    }

    if (currentIndi) {
      if (level === 1 && rest.startsWith('NAME ')) {
        const rawName = rest.substring(5).trim();
        const parts = rawName.split('/');
        currentIndi.first_name = (parts[0] || '').trim();
        currentIndi.last_name = (parts[1] || '').trim();
        if (!currentIndi.first_name && currentIndi.last_name) {
          currentIndi.first_name = currentIndi.last_name;
          currentIndi.last_name = '';
        }
      } else if (level === 1 && rest.startsWith('SEX ')) {
        const s = rest.substring(4).trim().toUpperCase();
        currentIndi.gender = s === 'F' ? 'female' : 'male';
      } else if (level === 1 && rest.startsWith('DEAT')) {
        currentIndi.is_alive = false;
      }
    } else if (currentFam) {
      if (level === 1 && rest.startsWith('HUSB ')) {
        currentFam.husb = rest.substring(5).trim();
      } else if (level === 1 && rest.startsWith('WIFE ')) {
        currentFam.wife = rest.substring(5).trim();
      } else if (level === 1 && rest.startsWith('CHIL ')) {
        currentFam.children.push(rest.substring(5).trim());
      }
    }
  }

  // Build relationships and marriages from families
  const parent_child_relationships: Array<{ parent_id: string; child_id: string; relationship_type: string }> = [];
  const marriages: Array<{ person_1_id: string; person_2_id: string; status: string }> = [];

  for (const fam of famMap.values()) {
    if (fam.husb && fam.wife && peopleMap.has(fam.husb) && peopleMap.has(fam.wife)) {
      marriages.push({
        person_1_id: fam.husb,
        person_2_id: fam.wife,
        status: 'married',
      });
    }

    for (const ch of fam.children) {
      if (fam.husb && peopleMap.has(fam.husb) && peopleMap.has(ch)) {
        parent_child_relationships.push({
          parent_id: fam.husb,
          child_id: ch,
          relationship_type: 'biological',
        });
      }
      if (fam.wife && peopleMap.has(fam.wife) && peopleMap.has(ch)) {
        parent_child_relationships.push({
          parent_id: fam.wife,
          child_id: ch,
          relationship_type: 'biological',
        });
      }
    }
  }

  return {
    people: Array.from(peopleMap.values()),
    parent_child_relationships,
    marriages,
  };
}
