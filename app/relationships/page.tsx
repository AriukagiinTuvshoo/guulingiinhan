'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, RelationshipResult } from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';
import ContextualPersonSearch from '../../components/contextual-person-search';
import DiscoveryState from '../../components/discovery-state';
const stepLabels = { parent: 'Эцэг / эх рүү', child: 'Хүүхэд рүү', spouse: 'Ханийн холбоо' };
function RelationshipContent() {
  const { familyId, contextLoading, contextError, user } = useAppShellContext(); const params = useSearchParams();
  const [first, setFirst] = useState<{ id: string; name: string } | null>(null); const [second, setSecond] = useState<{ id: string; name: string } | null>(null);
  const [former, setFormer] = useState(false); const [submitted, setSubmitted] = useState<{ first: string; second: string; former: boolean } | null>(null);
  const [data, setData] = useState<RelationshipResult | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const requestedPerson = params.get('person');
  useEffect(() => { setFirst(user?.person_id ? { id: user.person_id, name: 'Миний хүн' } : null); setSecond(requestedPerson ? { id: requestedPerson, name: 'Сонгосон хүн' } : null); setSubmitted(null); setData(null); setError(''); }, [familyId, requestedPerson, user?.person_id]);
  useEffect(() => {
    setData(null); setError(''); setBusy(false); if (!familyId || contextError || !submitted) return;
    const controller = new AbortController(); setBusy(true);
    const query = new URLSearchParams({ first: submitted.first, second: submitted.second, include_former: String(submitted.former) });
    void api<RelationshipResult>(`/families/${familyId}/relationship-path?${query}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Хамаарлыг тооцож чадсангүй.'); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [familyId, contextError, submitted]);
  return <main className="discovery-page"><header className="discovery-heading"><p className="eyebrow">ГУУЛИНГИЙНХАН · ХОЛБОО ХАМААРАЛ</p><h1>Би энэ хүнтэй ямар хамаатай вэ?</h1><p>Гэр бүлийн бүртгэсэн эцэг эх, хүүхэд, ханийн холбоогоор хамаарлын замыг харуулна.</p></header>
    {contextLoading ? <DiscoveryState loading /> : contextError || !familyId ? <DiscoveryState error={contextError || 'Гэр бүлээ сонгоно уу.'} /> : <>
      <form className="relationship-form" onSubmit={event => { event.preventDefault(); if (first && second) setSubmitted({ first: first.id, second: second.id, former }); }}>
        {[{ title: 'Эхний хүн', value: first, set: setFirst }, { title: 'Харьцуулах хүн', value: second, set: setSecond }].map((selection, index) => <fieldset key={index}><legend>{selection.title}</legend>{selection.value && <div className="discovery-selected"><strong>{selection.value.name}</strong><button type="button" onClick={() => { selection.set(null); setSubmitted(null); }}>Солих</button></div>}<ContextualPersonSearch key={`${familyId}-${index}`} familyId={familyId} onSelect={(id, name) => { selection.set({ id, name }); setSubmitted(null); }} /></fieldset>)}
        <label className="discovery-check"><input type="checkbox" checked={former} onChange={e => { setFormer(e.target.checked); setSubmitted(null); }} />Өмнөх гэрлэлтийн холбоог хамруулах</label><button className="primary" type="submit" disabled={!first || !second || busy}>{busy ? 'Тооцож байна…' : 'Хамаарлыг харах'}</button>
      </form>{busy && <DiscoveryState loading />}{error && <DiscoveryState error={error} retry={() => submitted && setSubmitted({ ...submitted })} />}
      {data && <section className="relationship-result" aria-live="polite"><h2>{data.status === 'same' ? 'Нэг хүн сонгосон байна' : data.status === 'found' ? 'Бүртгэлтэй холбооны зам' : data.status === 'limited' ? 'Энэ хүрээнд хамаарлыг бүрэн тооцох боломжгүй' : 'Холбооны зам олдсонгүй'}</h2>{data.truncated && <p className="discovery-help">Модны хэмжээний хязгаарт хүрсэн тул үр дүн бүрэн биш байж болно.</p>}{!data.paths.length && <p>Зөвхөн танд харагдах холбоосуудыг тооцсон. Мэдээлэл дутуу эсвэл тусдаа салаа байж болно.</p>}{data.paths.map((path, i) => <article key={i}><h3>{i + 1} дэх зам · {path.distance} холбоо</h3><p>Замын дагуух үеийн зөрүү: {path.generation_distance} <small>(эцэг эх −1, хүүхэд +1, хань 0)</small></p><ol className="relationship-path">{path.people.map((person, n) => <li key={`${person.id}-${n}`}>{n > 0 && <small>{stepLabels[path.steps[n - 1].kind]}{path.steps[n - 1].status === 'divorced' ? ' · Өмнөх гэрлэлт' : ''}{path.steps[n - 1].relationship_type && path.steps[n - 1].relationship_type !== 'biological' ? ' · Бүртгэсэн холбоо' : ''}</small>}<Link href={`/profile?family=${encodeURIComponent(familyId)}&person=${person.id}`}>{person.name}</Link></li>)}</ol></article>)}{data.paths_limited && <p>Хамгийн богино замуудаас эхний гурвыг харууллаа.</p>}{data.common_ancestors.length > 0 && <div><h3>Ойрын нийтлэг өвөг</h3>{data.common_ancestors.map(p => <p key={p.id}>{p.name} · эхний хүнээс {p.first_distance}, хоёр дахь хүнээс {p.second_distance} үе</p>)}</div>}<Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Удмын мод руу →</Link></section>}
    </>}</main>;
}
export default function RelationshipPage() { return <Suspense fallback={<DiscoveryState loading />}><RelationshipContent /></Suspense>; }
