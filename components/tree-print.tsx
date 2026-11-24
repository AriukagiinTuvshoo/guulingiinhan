import { useMemo } from 'react';
import { personName, TreeData } from '../lib/api';
export default function TreePrint({ tree, familyName }: { tree: TreeData; familyName: string }) {
  const rows = useMemo(() => {
    const people = new Map(tree.persons.map(person => [person.id, person]));
    const parents = new Map<string, string[]>(); const spouses = new Map<string, string[]>();
    for (const edge of tree.parent_child_relationships) { const parent = people.get(edge.parent_id); if (parent) parents.set(edge.child_id, [...(parents.get(edge.child_id) || []), personName(parent)]); }
    for (const marriage of tree.marriages) {
      const first = people.get(marriage.person_1_id); const second = people.get(marriage.person_2_id); const suffix = marriage.status === 'divorced' ? ' (өмнөх гэрлэлт)' : '';
      if (first && second) { spouses.set(first.id, [...(spouses.get(first.id) || []), personName(second) + suffix]); spouses.set(second.id, [...(spouses.get(second.id) || []), personName(first) + suffix]); }
    }
    return tree.persons.map(person => ({ id: person.id, name: personName(person), parents: parents.get(person.id)?.join(', ') || 'Бүртгээгүй / энэ хүрээнд харагдахгүй', spouses: spouses.get(person.id)?.join(', ') || '—' }));
  }, [tree]);
  return <section className="tree-print"><h1>{familyName} · Удмын холбооны лавлах</h1><p>Одоогийн зөвшөөрөгдсөн хүрээ · {rows.length} хүн. Эцэг эхийн нэрээр салааг дагаж уншина.</p>{tree.meta?.truncated && <p>Мод хэмжээний хязгаартай тул лавлах бүрэн биш.</p>}<table><thead><tr><th>Хүн</th><th>Эцэг / эх</th><th>Ханийн холбоо</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.parents}</td><td>{row.spouses}</td></tr>)}</tbody></table></section>;
}
