'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, api, Family } from '../../../lib/api';
import { sharedAncestryPaths } from '../../../lib/shared-ancestry';
import styles from './root-connection.module.css';

type Person = { id: string; first_name: string; last_name: string };
type SharedPerson = Person & { birth_date: string | null };
type SharedTree = {
  root_person_id: string | null;
  root_partner_person_id: string | null;
  my_person_id: string | null;
  persons: SharedPerson[];
  relationships: { parent_id: string; child_id: string }[];
  spouses: { person_1_id: string; person_2_id: string }[];
};
type Connection = {
  family_id: string;
  status: 'not_connected' | 'pending' | 'approved' | 'rejected' | 'disconnected';
  person_id: string | null;
  person_name: string | null;
  target_person_id: string | null;
  target_name: string | null;
  relationship_type: string | null;
  can_request: boolean;
};

function personName(person: Person) { return `${person.last_name} ${person.first_name}`.trim(); }

function RootConnectionContent() {
  const search = useSearchParams();
  const requestedFamily = search.get('family')?.trim() || '';
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [tree, setTree] = useState<SharedTree | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [ownPerson, setOwnPerson] = useState<Person | null>(null);
  const [targetId, setTargetId] = useState('');
  const [relationshipType, setRelationshipType] = useState('biological');
  const [step, setStep] = useState(1);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [familyLoadFailed, setFamilyLoadFailed] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      const [familyResult, treeResult] = await Promise.allSettled([
        api<Family[]>('/families'), api<SharedTree>('/shared-lineage'),
      ]);
      if (!active) return;
      if (familyResult.status === 'fulfilled') {
        setFamilies(familyResult.value);
        setFamilyId(requestedFamily || familyResult.value[0]?.id || '');
      } else {
        setFamilyLoadFailed(true);
        setError(familyResult.reason instanceof ApiError ? familyResult.reason.message : 'Гэр бүлүүдийг ачаалж чадсангүй.');
      }
      if (treeResult.status === 'fulfilled') setTree(treeResult.value);
      else setError(treeResult.reason instanceof ApiError ? treeResult.reason.message : 'Үндэс модыг ачаалж чадсангүй.');
      setBusy(false);
    }
    void load();
    return () => { active = false; };
  }, [requestedFamily]);

  useEffect(() => {
    let active = true;
    setOwnPerson(null);
    if (!familyId || !tree?.my_person_id || !families.some((family) => family.id === familyId)) return;
    void api<Person>(`/families/${encodeURIComponent(familyId)}/persons/${encodeURIComponent(tree.my_person_id)}`)
      .then((person) => { if (active) setOwnPerson(person); })
      .catch(() => { /* The connection status explains an absent family Person. */ });
    return () => { active = false; };
  }, [familyId, tree?.my_person_id, families]);

  useEffect(() => {
    let active = true;
    setConnection(null);
    setConnectionError(false);
    if (!familyId || !families.some((family) => family.id === familyId)) return;
    void api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`)
      .then((value) => { if (active) setConnection(value); })
      .catch((cause) => { if (active) { setConnectionError(true); setError(cause instanceof ApiError ? cause.message : 'Холболтын төлөвийг ачаалж чадсангүй.'); } });
    return () => { active = false; };
  }, [familyId, families]);

  const family = families.find((item) => item.id === familyId);
  const invalidFamily = !busy && !familyLoadFailed && Boolean(requestedFamily) && !families.some((item) => item.id === requestedFamily);
  const people = useMemo(() => new Map((tree?.persons || []).map((person) => [person.id, person])), [tree]);
  const targets = useMemo(() => {
    const paths = sharedAncestryPaths(tree);
    return tree?.persons.filter((person) => paths.has(person.id) && person.id !== tree.my_person_id) || [];
  }, [tree]);
  const target = people.get(targetId);

  async function submit() {
    if (!familyId || !tree?.my_person_id || !targetId || !consent || saving) return;
    setSaving(true); setError('');
    try {
      const value = await api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`, {
        method: 'POST',
        body: JSON.stringify({
          person_id: tree.my_person_id, target_person_id: targetId,
          relationship_type: relationshipType, share_consent: true,
        }),
      });
      setConnection(value);
      setStep(1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Холболтын хүсэлтийг илгээж чадсангүй.');
    } finally { setSaving(false); }
  }

  async function disconnect() {
    if (!familyId || saving || !window.confirm('Үндэс модны холболтыг салгах уу? Хүмүүс болон бодит гэр бүлийн холбоос хэвээр үлдэнэ.')) return;
    setSaving(true); setError('');
    try {
      setConnection(await api<Connection>(`/families/${encodeURIComponent(familyId)}/root-connection`, { method: 'DELETE' }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Холболтыг салгаж чадсангүй.');
    } finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.hero}><span>ГУУЛИНГИЙНХАН · УДАМ УГСАА</span><h1>Үндэс модтой холбох</h1><p>Танай гэр бүлийн мод өөрийн хүрээнд хэвээр үлдэнэ. Та өөрийн баталгаажсан хүнийг нийтлэг модны бодит салбарт холбох хүсэлт гаргана.</p></header>
    <div className={styles.layout}>
      <aside className={styles.aside}><h2>Холболтын зам</h2><ol><li>Миний хүн</li><li>Үндэс модны хүн</li><li>Бодит холбоо</li><li>Шалгаж илгээх</li></ol><Link href={familyId ? `/tree?family=${encodeURIComponent(familyId)}` : '/tree'}>← Гэр бүлийн мод</Link><Link href="/ancestry">Нийтлэг модыг харах →</Link></aside>
      <section className={styles.panel} aria-busy={busy || saving}>
        {busy ? <p role="status">Ачаалж байна…</p> : familyLoadFailed ? <div role="alert"><h2>Гэр бүлийн мэдээлэл ачаалагдсангүй</h2><p>{error}</p></div> : invalidFamily ? <div role="alert"><h2>Гэр бүл олдсонгүй</h2><p>Энэ гэр бүлд хандах эрх алга.</p></div> : !family ? <p>Эхлээд гэр бүл үүсгэх эсвэл урилгаар нэгдэнэ үү. <Link href="/families">Гэр бүлүүд →</Link></p> : <>
          {families.length > 1 && <label>Миний гэр бүл<select value={familyId} onChange={(event) => { setFamilyId(event.target.value); setTargetId(''); setConsent(false); setStep(1); }}><option value="">Сонгох</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {connection?.status === 'pending' ? <div role="status"><span className={styles.kicker}>ХҮЛЭЭГДЭЖ БАЙНА</span><h2>Холболтын хүсэлтийг шалгаж байна</h2><p>{connection.person_name} хүнийг {connection.target_name} хүний салбарт холбох хүсэлтийг эрх бүхий админ шалгана.</p></div> :
          connection?.status === 'approved' ? <div><span className={styles.kicker}>ХОЛБОГДСОН</span><h2>{family.name} · үндэс модны салбар</h2><p>Холбогдсон хүн: <strong>{connection.person_name}</strong></p><p>Салбарын эх: <strong>{connection.target_name}</strong></p><div className={styles.actions}><Link className={styles.primary} href={`/ancestry?focus=${encodeURIComponent(connection.person_id || '')}&family=${encodeURIComponent(familyId)}`}>Салбараа харах →</Link><Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Гэр бүлийн мод →</Link><button type="button" disabled={saving} onClick={() => void disconnect()}>Холболтыг салгах</button></div></div> :
          !tree ? <div><h2>Үндэс мод ачаалагдсангүй</h2><p>Түр хүлээгээд хуудсыг дахин ачаална уу.</p></div> :
          connectionError ? <div><h2>Холболтын төлөв ачаалагдсангүй</h2><p>Түр хүлээгээд хуудсыг дахин ачаална уу.</p></div> :
          !tree.root_person_id ? <div><h2>Үндэс модны эхийг тохируулж байна</h2><p>Админ бодит эх хүнийг баталсны дараа салбар сонгож болно.</p></div> :
          !tree.my_person_id || !connection?.can_request ? <div><span className={styles.kicker}>ЗӨВШӨӨРӨЛ ШААРДЛАГАТАЙ</span><h2>Эхлээд өөрийн хүнтэй холбогдоно уу</h2><p>Гэр бүлийн модонд өөрийн хүнийг сонгож “Энэ бол би” хүсэлт илгээнэ. Гэр бүлийн эзэн баталсны дараа эндээс үргэлжлүүлнэ.</p><Link href={`/tree?family=${encodeURIComponent(familyId)}`}>Өөрийн хүнээ холбох →</Link></div> :
          <div>
            {connection?.status === 'rejected' && <p className={styles.error}>Өмнөх хүсэлт зөвшөөрөгдөөгүй. Зөв салбар сонгоод дахин илгээж болно.</p>}
            {connection?.status === 'disconnected' && <p className={styles.note}>Өмнөх холболт салсан. Гэр бүлийн мод болон бодит холбоо хадгалагдсан.</p>}
            <span className={styles.kicker}>АЛХАМ {step} / 4</span>
            {step === 1 && <><h2>Та хэнийг холбож байна?</h2><p>Зөвхөн таны аккаунттай баталгаажсан бодит хүн.</p><div className={styles.selection}>{ownPerson ? personName(ownPerson) : 'Миний баталгаажсан хүн'}</div></>}
            {step === 2 && <><h2>Та хэний хүүхэд вэ?</h2><p>Үндсэн модонд бүртгэлтэй өөрийн бодит эцэг эсвэл эхийг сонгоно. Өвөг дээдэстэй шууд хүүхдийн холбоо үүсгэхгүй; завсрын хүмүүсийн холбоог эхлээд бүртгүүлнэ.</p><label>Миний эцэг эсвэл эх<select value={targetId} onChange={(event) => { setTargetId(event.target.value); setConsent(false); }}><option value="">Өөрөө сонгоно уу</option>{targets.map((person) => <option key={person.id} value={person.id}>{personName(person)}{person.birth_date ? ` · ${person.birth_date.slice(0, 4)}` : ''}</option>)}</select></label>{target && <div className={styles.selection}>{personName(target)} → {ownPerson ? personName(ownPerson) : 'Миний хүн'}</div>}</>}
            {step === 3 && <><h2>Ямар хүүхдийн холбоо вэ?</h2><p>Та <strong>{target ? personName(target) : 'сонгосон хүн'}</strong> хүний хүүхэд гэж хүсэлт гаргана. Энэ холбоог админ шалгаж батална.</p><label>Хүүхдийн холбоо<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="biological">Төрсөн хүүхэд</option><option value="adoptive">Үрчилсэн хүүхэд</option><option value="step">Дагавар хүүхэд</option></select></label></>}
            {step === 4 && <><h2>Хүсэлтээ шалгана уу</h2><div className={styles.path}><span>{target ? personName(target) : 'Миний эцэг эсвэл эх'}</span><span>{ownPerson ? personName(ownPerson) : 'Миний хүн'} · {relationshipType === 'biological' ? 'Төрсөн хүүхэд' : relationshipType === 'adoptive' ? 'Үрчилсэн хүүхэд' : 'Дагавар хүүхэд'}</span></div><p>{family.name} гэр бүлийн таны бүртгэл дээр үндэслэн админд хүсэлт очно. Батлагдахаас өмнө таны байрлал модонд нэмэгдэхгүй. Гэр бүлийн хувийн түүх, зураг, архив нээгдэхгүй.</p><label className={styles.check}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Миний нэр болон энэ удмын холбоог бусад нэвтэрсэн гишүүдэд харуулахыг зөвшөөрч байна.</label></>}
            <div className={styles.actions}>{step > 1 && <button type="button" onClick={() => setStep(step - 1)}>Өмнөх</button>}{step < 4 ? <button className={styles.primary} type="button" disabled={step === 2 && !targetId} onClick={() => setStep(step + 1)}>Дараах →</button> : <button className={styles.primary} type="button" disabled={!consent || saving} onClick={() => void submit()}>{saving ? 'Илгээж байна…' : 'Хүсэлт илгээх'}</button>}</div>
          </div>}
        </>}
      </section>
    </div>
  </main>;
}

export default function RootConnectionPage() {
  return <Suspense fallback={<main className={styles.page}>Ачаалж байна…</main>}><RootConnectionContent /></Suspense>;
}
