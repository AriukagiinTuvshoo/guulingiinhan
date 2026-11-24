'use client';
import { useEffect, useState } from 'react';
import { api, BranchSummary, LineageSummary } from '../lib/api';
export default function HeritageBranchFilter({ familyId, value, onChange }: { familyId: string; value: string; onChange: (id: string) => void }) {
  const [lineages, setLineages] = useState<LineageSummary[]>([]);
  const [lineage, setLineage] = useState('');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<LineageSummary[]>(`/families/${familyId}/lineages`, { signal: controller.signal })
      .then(setLineages).catch(() => { if (!controller.signal.aborted) setError('Салааны сонголт ачаалсангүй.'); });
    return () => controller.abort();
  }, [familyId]);
  useEffect(() => {
    if (!lineage) { setBranches([]); return; }
    const controller = new AbortController(); setError('');
    api<BranchSummary[]>(`/lineages/${lineage}/branches`, { signal: controller.signal })
      .then(setBranches).catch(() => { if (!controller.signal.aborted) setError('Салааны сонголт ачаалсангүй.'); });
    return () => controller.abort();
  }, [lineage]);
  return <>
    {lineages.length > 0 && <label>Удам<select value={lineage} onChange={(event) => { setLineage(event.target.value); setBranches([]); onChange(''); }}><option value="">Бүх удам</option>{lineages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {lineage && <label>Салаа<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Бүх салаа</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {error && <span role="status">{error}</span>}
  </>;
}
