/**
 * Traditional Mongolian Kinship Calculation System (Монгол Ургийн Хамаарлын Тооцоолуур)
 *
 * Implements traditional Mongolian genealogical degrees:
 * - 9 үеийн зарчим (Nine generations paternal/maternal tracing)
 * - Авга (paternal) vs Нагац (maternal) distinction
 * - Үеэл, Хаяал, Садангууд
 * - Хадам, бэр, хүргэн, баз
 */

export interface KinshipPerson {
  id: string;
  first_name: string;
  last_name: string;
  gender?: string | null;
  birth_date?: string | null;
}

export interface KinshipEdge {
  parent_id: string;
  child_id: string;
  relationship_type?: string;
}

export interface KinshipMarriage {
  person_1_id: string;
  person_2_id: string;
  status?: string;
}

export interface KinshipResult {
  relationshipName: string;
  generationDifference: number; // e.g., 0 = same generation, +1 = older generation, -1 = younger
  lineageType: 'self' | 'direct_ancestor' | 'direct_descendant' | 'sibling' | 'paternal_collateral' | 'maternal_collateral' | 'in_law' | 'spouse' | 'unrelated';
  pathDescription: string;
  nineGenerationsRuleViolated: boolean;
  degreeOfConsanguinity: number; // 1 = parent/child, 2 = siblings/grandparent, 3 = uncle/aunt/nephew, 4 = first cousins, etc.
  culturalAdvice: string;
}

/**
 * Calculates the traditional Mongolian kinship term between Person A (subject) and Person B (target).
 * "Person B нь Person A-ийн хэн болох вэ?"
 */
export function calculateMongolianKinship(
  personAId: string,
  personBId: string,
  people: KinshipPerson[],
  relationships: KinshipEdge[],
  marriages: KinshipMarriage[] = []
): KinshipResult {
  if (personAId === personBId) {
    return {
      relationshipName: 'Өөрөө (Би)',
      generationDifference: 0,
      lineageType: 'self',
      pathDescription: 'Нэг хүн',
      nineGenerationsRuleViolated: false,
      degreeOfConsanguinity: 0,
      culturalAdvice: 'Өөрийн хувийн мэдээлэл.',
    };
  }

  const peopleMap = new Map<string, KinshipPerson>(people.map((p) => [p.id, p]));
  const personA = peopleMap.get(personAId);
  const personB = peopleMap.get(personBId);

  if (!personA || !personB) {
    return {
      relationshipName: 'Мэдээлэл дутуу',
      generationDifference: 0,
      lineageType: 'unrelated',
      pathDescription: 'Хүмүүсийн мэдээлэл олдсонгүй.',
      nineGenerationsRuleViolated: false,
      degreeOfConsanguinity: 99,
      culturalAdvice: 'Модон дахь хүний мэдээлэл бүрэн бус байна.',
    };
  }

  const isBMan = personB.gender?.toLowerCase() === 'male';

  // 1. Direct Marriage check
  const isSpouse = marriages.some(
    (m) =>
      (m.person_1_id === personAId && m.person_2_id === personBId) ||
      (m.person_2_id === personAId && m.person_1_id === personBId)
  );

  if (isSpouse) {
    return {
      relationshipName: isBMan ? 'Нөхөр' : 'Гэргий (Эхнэр)',
      generationDifference: 0,
      lineageType: 'spouse',
      pathDescription: 'Гэр бүлийн хос',
      nineGenerationsRuleViolated: false,
      degreeOfConsanguinity: 0,
      culturalAdvice: 'Хууль ёсны болон уламжлалт гэр бүлийн хос.',
    };
  }

  // Build graph for parent-child navigation
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();

  for (const p of people) {
    parentsOf.set(p.id, []);
    childrenOf.set(p.id, []);
  }

  for (const rel of relationships) {
    parentsOf.get(rel.child_id)?.push(rel.parent_id);
    childrenOf.get(rel.parent_id)?.push(rel.child_id);
  }

  // 2. Direct Ancestor check (B is ancestor of A)
  const ancestorDistance = findAncestorDistance(personAId, personBId, parentsOf);
  if (ancestorDistance !== null) {
    const term = getDirectAncestorTerm(ancestorDistance, isBMan);
    return {
      relationshipName: term,
      generationDifference: ancestorDistance,
      lineageType: 'direct_ancestor',
      pathDescription: `${ancestorDistance} үе дээших шууд өвөг дээдэс`,
      nineGenerationsRuleViolated: ancestorDistance <= 9,
      degreeOfConsanguinity: ancestorDistance,
      culturalAdvice:
        ancestorDistance <= 9
          ? 'Монгол ёсоор есөн үе доторх язгуур цусан төрлийн шууд өвөг дээдэс мөн.'
          : 'Есөн үеэс алсарсан язгуур дээдэс.',
    };
  }

  // 3. Direct Descendant check (B is descendant of A)
  const descendantDistance = findAncestorDistance(personBId, personAId, parentsOf);
  if (descendantDistance !== null) {
    // Check if intermediate child from A was son or daughter
    const isPaternalDescendant = checkIfPaternalLine(personAId, personBId, parentsOf, peopleMap);
    const term = getDirectDescendantTerm(descendantDistance, isBMan, isPaternalDescendant);
    return {
      relationshipName: term,
      generationDifference: -descendantDistance,
      lineageType: 'direct_descendant',
      pathDescription: `${descendantDistance} үе дооших шууд үр хойч`,
      nineGenerationsRuleViolated: descendantDistance <= 9,
      degreeOfConsanguinity: descendantDistance,
      culturalAdvice:
        descendantDistance <= 9
          ? 'Монгол ёсоор есөн үе доторх шууд үр хойч, өв залгамжлагч мөн.'
          : 'Есөн үеэс алсарсан үр удам.',
    };
  }

  // 4. Collateral Relatives (Find Lowest Common Ancestor)
  const lcaResult = findLowestCommonAncestor(personAId, personBId, parentsOf, peopleMap);
  if (lcaResult) {
    const { distA, distB, lcaId, throughMotherOfA } = lcaResult;
    const lca = peopleMap.get(lcaId);
    const genDiff = distA - distB;
    const totalDegree = distA + distB;

    // A and B share parents (distA == 1, distB == 1) -> Siblings
    if (distA === 1 && distB === 1) {
      const isOlder = isPersonOlder(personB, personA);
      let name = '';
      if (isOlder) {
        name = isBMan ? 'Төрсөн ах' : 'Төрсөн эгч';
      } else {
        name = isBMan ? 'Төрсөн эрэгтэй дүү' : 'Төрсөн эмэгтэй дүү';
      }
      return {
        relationshipName: name,
        generationDifference: 0,
        lineageType: 'sibling',
        pathDescription: 'Нэг эцэг эхээс төрсөн төрсөн ах/эгч/дүү',
        nineGenerationsRuleViolated: true,
        degreeOfConsanguinity: 2,
        culturalAdvice: 'Цусан төрлийн хамгийн ойр төрсөн мах цусны хамаатан.',
      };
    }

    // Uncle / Aunt / Nephew / Niece:
    // distA == 1, distB == 2: B is sibling's child (A's nephew/niece)
    if (distA === 1 && distB === 2) {
      const isSisterChild = throughMotherOfA;
      let name = '';
      if (isSisterChild) {
        name = isBMan ? 'Зээ хүү' : 'Зээ охин';
      } else {
        name = isBMan ? 'Ач хүү (Дүүгийн хүү)' : 'Ач охин (Дүүгийн охин)';
      }
      return {
        relationshipName: name,
        generationDifference: -1,
        lineageType: isSisterChild ? 'maternal_collateral' : 'paternal_collateral',
        pathDescription: `${lca?.first_name || 'Дээдсээр'}-ээр холбогдсон ач/зээ дүү`,
        nineGenerationsRuleViolated: true,
        degreeOfConsanguinity: 3,
        culturalAdvice: 'Ойрын цусан төрлийн үр хүүхэд.',
      };
    }

    // distA == 2, distB == 1: B is A's parent's sibling (A's Uncle / Aunt)
    if (distA === 2 && distB === 1) {
      let name = '';
      if (throughMotherOfA) {
        name = isBMan ? 'Нагац ах' : 'Нагац эгч';
      } else {
        name = isBMan ? 'Авга ах' : 'Авга эгч';
      }
      return {
        relationshipName: name,
        generationDifference: 1,
        lineageType: throughMotherOfA ? 'maternal_collateral' : 'paternal_collateral',
        pathDescription: throughMotherOfA ? 'Эхийн талын нагац төрөл' : 'Эцгийн талын авга төрөл',
        nineGenerationsRuleViolated: true,
        degreeOfConsanguinity: 3,
        culturalAdvice: throughMotherOfA
          ? '“Нагац нь нар, хадам нь сар” хэмээн дээдэлдэг нагац төрөл.'
          : 'Эцгийн язгуур овгийн авга төрөл.',
      };
    }

    // First Cousins (distA == 2, distB == 2) -> Үеэл
    if (distA === 2 && distB === 2) {
      const isOlder = isPersonOlder(personB, personA);
      const prefix = throughMotherOfA ? 'Нагац үеэл' : 'Авга үеэл';
      const suffix = isOlder ? (isBMan ? 'ах' : 'эгч') : (isBMan ? 'дүү' : 'дүү охин');
      return {
        relationshipName: `${prefix} (${suffix})`,
        generationDifference: 0,
        lineageType: throughMotherOfA ? 'maternal_collateral' : 'paternal_collateral',
        pathDescription: 'Өвөө, эмээ нэгтэй 2 дахь үеийн төрөл (Үеэл)',
        nineGenerationsRuleViolated: true,
        degreeOfConsanguinity: 4,
        culturalAdvice: 'Монгол ёсонд үеэл хооронд ураг холбохыг хатуу цээрлэдэг.',
      };
    }

    // Second Cousins (distA == 3, distB == 3) -> Хаяал
    if (distA === 3 && distB === 3) {
      const isOlder = isPersonOlder(personB, personA);
      const suffix = isOlder ? (isBMan ? 'ах' : 'эгч') : 'дүү';
      return {
        relationshipName: `Хаяал (${suffix})`,
        generationDifference: 0,
        lineageType: 'paternal_collateral',
        pathDescription: 'Элэнц өвөө нэгтэй 3 дахь үеийн төрөл (Хаяал)',
        nineGenerationsRuleViolated: true,
        degreeOfConsanguinity: 6,
        culturalAdvice: '3 дахь үеийн хаяал төрөл. Есөн үеийн доторх цусан төрөл.',
      };
    }

    // Distant generational cousin (distA >= 4, distB >= 4)
    const genIndex = Math.max(distA, distB);
    const genName = getGenerationCousinName(genIndex);
    return {
      relationshipName: `${genName} садан (${distA} ба ${distB} үе)`,
      generationDifference: genDiff,
      lineageType: throughMotherOfA ? 'maternal_collateral' : 'paternal_collateral',
      pathDescription: `${lca?.first_name || 'Өвөг'}-ээс салбарласан ${totalDegree}-р зэргийн төрөл садан`,
      nineGenerationsRuleViolated: Math.max(distA, distB) <= 9,
      degreeOfConsanguinity: totalDegree,
      culturalAdvice:
        Math.max(distA, distB) <= 9
          ? 'Монгол уламжлалын 9 үе дотор багтах садан төрөл тул цус холихыг цээрлэнэ.'
          : '9 үеэс хэтэрсэн, холбоо алсарсан төрөл.',
    };
  }

  // 5. In-law check (Хадам, хүргэн, бэр)
  const inLawResult = checkInLawRelationship(personAId, personBId, parentsOf, marriages, peopleMap);
  if (inLawResult) {
    return inLawResult;
  }

  return {
    relationshipName: 'Ургийн шууд холбоо тогтоогдоогүй',
    generationDifference: 0,
    lineageType: 'unrelated',
    pathDescription: 'Модон дээр шууд холбоосын зам олдсонгүй.',
    nineGenerationsRuleViolated: false,
    degreeOfConsanguinity: 99,
    culturalAdvice: 'Бүртгэгдсэн модон дээр шууд цусан болон худ ураг холбогдоогүй байна.',
  };
}

// Helpers

function findAncestorDistance(
  startId: string,
  targetAncestorId: string,
  parentsOf: Map<string, string[]>
): number | null {
  const queue: Array<{ id: string; dist: number }> = [{ id: startId, dist: 0 }];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.id === targetAncestorId && item.dist > 0) {
      return item.dist;
    }

    const parents = parentsOf.get(item.id) || [];
    for (const p of parents) {
      if (!visited.has(p)) {
        visited.add(p);
        queue.push({ id: p, dist: item.dist + 1 });
      }
    }
  }

  return null;
}

function getDirectAncestorTerm(distance: number, isMan: boolean): string {
  switch (distance) {
    case 1:
      return isMan ? 'Эцэг (Аав)' : 'Эх (Ээж)';
    case 2:
      return isMan ? 'Өвөг эцэг (Өвөө)' : 'Эмэг эх (Эмээ)';
    case 3:
      return isMan ? 'Элэнц өвөг' : 'Элэнц эмэг';
    case 4:
      return isMan ? 'Хуланц өвөг' : 'Хуланц эмэг';
    case 5:
      return isMan ? 'Элэнц хуланц өвөг' : 'Элэнц хуланц эмэг';
    case 6:
      return isMan ? 'Зөөлөг өвөг' : 'Зөөлөг эмэг';
    case 7:
      return isMan ? 'Дулаг өвөг' : 'Дулаг эмэг';
    case 8:
      return isMan ? 'Өвөг дээд өвөг' : 'Өвөг дээд эмэг';
    case 9:
      return isMan ? 'Язгуур өвөг' : 'Язгуур эмэг';
    default:
      return `${distance} дахь үеийн өвөг дээдэс`;
  }
}

function checkIfPaternalLine(
  ancestorId: string,
  descendantId: string,
  parentsOf: Map<string, string[]>,
  peopleMap: Map<string, KinshipPerson>
): boolean {
  // Walk up from descendantId until we find a direct child of ancestorId
  const queue: string[] = [descendantId];
  const visited = new Set<string>([descendantId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const parents = parentsOf.get(currentId) || [];
    for (const p of parents) {
      if (p === ancestorId) {
        const intermediateChild = peopleMap.get(currentId);
        return intermediateChild?.gender?.toLowerCase() === 'male';
      }
      if (!visited.has(p)) {
        visited.add(p);
        queue.push(p);
      }
    }
  }
  return true;
}

function getDirectDescendantTerm(distance: number, isMan: boolean, isPaternal: boolean): string {
  switch (distance) {
    case 1:
      return isMan ? 'Хүү' : 'Охин';
    case 2:
      if (isPaternal) {
        return isMan ? 'Ач хүү' : 'Ач охин';
      }
      return isMan ? 'Зээ хүү' : 'Зээ охин';
    case 3:
      return isMan ? 'Гуч хүү' : 'Гуч охин';
    case 4:
      return isMan ? 'Дөч хүү' : 'Дөч охин';
    case 5:
      return isMan ? 'Жич хүү' : 'Жич охин';
    case 6:
      return 'Хул ач';
    case 7:
      return 'Хулцар';
    case 8:
      return 'Тасархай';
    case 9:
      return 'Өвөр';
    default:
      return `${distance} дахь үеийн үр хойч`;
  }
}

function findLowestCommonAncestor(
  personAId: string,
  personBId: string,
  parentsOf: Map<string, string[]>,
  peopleMap: Map<string, KinshipPerson>
): { distA: number; distB: number; lcaId: string; throughMotherOfA: boolean } | null {
  // Map all ancestors of A with shortest distance
  const ancestorsA = new Map<string, number>();
  const firstStepParentOfA = new Map<string, string>(); // ancestorId -> which immediate parent of A led there

  const queueA: Array<{ id: string; dist: number; rootParent: string }> = [];
  const parentsA = parentsOf.get(personAId) || [];
  for (const p of parentsA) {
    queueA.push({ id: p, dist: 1, rootParent: p });
    ancestorsA.set(p, 1);
    firstStepParentOfA.set(p, p);
  }

  while (queueA.length > 0) {
    const item = queueA.shift()!;
    const nextParents = parentsOf.get(item.id) || [];
    for (const np of nextParents) {
      if (!ancestorsA.has(np)) {
        ancestorsA.set(np, item.dist + 1);
        firstStepParentOfA.set(np, item.rootParent);
        queueA.push({ id: np, dist: item.dist + 1, rootParent: item.rootParent });
      }
    }
  }

  // BFS from B to find first intersection in ancestorsA
  const queueB: Array<{ id: string; dist: number }> = [];
  const visitedB = new Set<string>();

  const parentsB = parentsOf.get(personBId) || [];
  for (const p of parentsB) {
    queueB.push({ id: p, dist: 1 });
    visitedB.add(p);
  }

  let bestLca: { distA: number; distB: number; lcaId: string; throughMotherOfA: boolean } | null = null;

  while (queueB.length > 0) {
    const item = queueB.shift()!;
    if (ancestorsA.has(item.id)) {
      const distA = ancestorsA.get(item.id)!;
      const rootP = firstStepParentOfA.get(item.id);
      const rootPerson = rootP ? peopleMap.get(rootP) : null;
      const throughMotherOfA = rootPerson?.gender?.toLowerCase() === 'female';

      if (!bestLca || distA + item.dist < bestLca.distA + bestLca.distB) {
        bestLca = {
          distA,
          distB: item.dist,
          lcaId: item.id,
          throughMotherOfA,
        };
      }
    }

    const nextParents = parentsOf.get(item.id) || [];
    for (const np of nextParents) {
      if (!visitedB.has(np)) {
        visitedB.add(np);
        queueB.push({ id: np, dist: item.dist + 1 });
      }
    }
  }

  return bestLca;
}

function checkInLawRelationship(
  personAId: string,
  personBId: string,
  parentsOf: Map<string, string[]>,
  marriages: KinshipMarriage[],
  peopleMap: Map<string, KinshipPerson>
): KinshipResult | null {
  const isBMan = peopleMap.get(personBId)?.gender?.toLowerCase() === 'male';

  // Find A's spouse
  const spouseEdge = marriages.find(
    (m) => m.person_1_id === personAId || m.person_2_id === personAId
  );
  const aSpouseId = spouseEdge
    ? spouseEdge.person_1_id === personAId
      ? spouseEdge.person_2_id
      : spouseEdge.person_1_id
    : null;

  if (aSpouseId) {
    // B is parent of A's spouse -> Хадам
    const spouseParents = parentsOf.get(aSpouseId) || [];
    if (spouseParents.includes(personBId)) {
      return {
        relationshipName: isBMan ? 'Хадам эцэг (Хадам аав)' : 'Хадам эх (Хадам ээж)',
        generationDifference: 1,
        lineageType: 'in_law',
        pathDescription: 'Гэргийн/Нөхрийн эцэг эх',
        nineGenerationsRuleViolated: false,
        degreeOfConsanguinity: 0,
        culturalAdvice: 'Хүндэтгэлт хадам төрөл.',
      };
    }
  }

  // A is parent of B's spouse -> Хүргэн / Бэр
  const bSpouseEdge = marriages.find(
    (m) => m.person_1_id === personBId || m.person_2_id === personBId
  );
  const bSpouseId = bSpouseEdge
    ? bSpouseEdge.person_1_id === personBId
      ? bSpouseEdge.person_2_id
      : bSpouseEdge.person_1_id
    : null;

  if (bSpouseId) {
    const aChildren = Array.from(parentsOf.entries())
      .filter(([_, pIds]) => pIds.includes(personAId))
      .map(([childId]) => childId);

    if (aChildren.includes(bSpouseId)) {
      return {
        relationshipName: isBMan ? 'Хүргэн' : 'Бэр',
        generationDifference: -1,
        lineageType: 'in_law',
        pathDescription: isBMan ? 'Охины нөхөр (Хүргэн)' : 'Хүүгийн гэргий (Бэр)',
        nineGenerationsRuleViolated: false,
        degreeOfConsanguinity: 0,
        culturalAdvice: isBMan ? 'Гал голомт холбосон хүргэн.' : 'Удмын галыг бадраах бэр.',
      };
    }
  }

  return null;
}

function isPersonOlder(p1: KinshipPerson, p2: KinshipPerson): boolean {
  if (p1.birth_date && p2.birth_date) {
    return new Date(p1.birth_date).getTime() < new Date(p2.birth_date).getTime();
  }
  return false;
}

function getGenerationCousinName(gen: number): string {
  switch (gen) {
    case 4:
      return 'Хаяалын хүүхэд (4-р үе)';
    case 5:
      return 'Үеэлэнцэр (5-р үе)';
    case 6:
      return 'Садан (6-р үе)';
    case 7:
      return 'Төрөл садан (7-р үе)';
    case 8:
      return 'Алс төрөл (8-р үе)';
    case 9:
      return 'Есөн үеийн зааг төрөл (9-р үе)';
    default:
      return `${gen} дахь үеийн алсын төрөл`;
  }
}
