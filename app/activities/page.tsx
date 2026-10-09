'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { useAppShellContext } from '../../components/app-shell';

type Fund = { id: string; family_id: string; title: string; purpose: string; currency: string; payment_instruction: string; visibility: 'family' | 'public'; is_active: boolean };
type PublicFund = Fund & { family_name: string };
type Donation = { id: string; fund_id: string; amount_minor: number; currency: string; status: string; donor_name: string | null; private_donor: boolean };
type FamilyEvent = { id: string; title: string; description: string; starts_at: string; location: string; registration_deadline: string | null; capacity: number | null; adult_fee_minor: number; child_fee_minor: number; currency: string; payment_instruction: string };
type Registration = { id: string; event_id: string; user_id: string; adult_count: number; child_count: number; status: string; payment_status: string };
const root = (id: string) => `/families/${encodeURIComponent(id)}`;
const money = (amount: number, currency: string) => `${new Intl.NumberFormat('mn-MN').format(amount / 100)} ${currency}`;
const localDate = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 16);

function PublicFundsSection({ rows, loading, error, onRetry }: { rows: PublicFund[]; loading: boolean; error: string; onRetry: () => void }) {
  return <section className="activities-section" aria-labelledby="public-funds-heading">
    <div className="activities-section-title"><div><span>ГУУЛИНГИЙНХНЫ ӨВИЙН САН</span><h2 id="public-funds-heading">Нийтийн сан</h2></div><p>Зөвхөн нийтэд ил тод хуваалцахаар сонгосон идэвхтэй сангууд.</p></div>
    {error && <div className="activities-alert" role="alert">{error}<button type="button" onClick={onRetry}>Дахин оролдох</button></div>}
    {loading ? <p className="activities-empty" role="status">Нийтийн санг ачаалж байна…</p> : !rows.length ? <p className="activities-empty">Одоогоор нийтэд хуваалцсан сан алга.</p> : <div className="activities-grid">{rows.map((fund) => <article className="activities-card" key={fund.id}>
      <div className="activities-card-top"><span className="activities-kicker">НИЙТЭД НЭЭЛТТЭЙ</span><span className="activities-kicker">{fund.family_name}</span></div>
      <h3>{fund.title}</h3><p>{fund.purpose}</p><div className="activities-instructions"><small>ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ</small><p>{fund.payment_instruction}</p></div>
    </article>)}</div>}
  </section>;
}

function ActivitiesContent() {
  const { familyId, currentFamily: family, contextLoading } = useAppShellContext();
  const [section, setSection] = useState<'fund' | 'events'>('fund');
  const [funds, setFunds] = useState<Fund[]>([]);
  const [donations, setDonations] = useState<Record<string, Donation[]>>({}); const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, Registration[]>>({}); const [mine, setMine] = useState<Record<string, Registration | null>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [fundVisibility, setFundVisibility] = useState<'family' | 'public'>('family');
  const [publicFunds, setPublicFunds] = useState<PublicFund[]>([]);
  const [publicFundsLoading, setPublicFundsLoading] = useState(true);
  const [publicFundsError, setPublicFundsError] = useState('');
  const manage = family?.role === 'owner' || family?.role === 'editor'; const owner = family?.role === 'owner';

  const reloadPublicFunds = useCallback(async () => {
    setPublicFundsError(''); setPublicFundsLoading(true);
    try { setPublicFunds(await api<PublicFund[]>('/public/funds')); }
    catch (cause) { setPublicFundsError(cause instanceof Error ? cause.message : 'Нийтийн санг ачаалж чадсангүй.'); }
    finally { setPublicFundsLoading(false); }
  }, []);
  useEffect(() => { void reloadPublicFunds(); }, [reloadPublicFunds]);

  const reload = useCallback(async () => {
    if (!familyId) return; setError('');
    try {
      const [fundRows, eventRows] = await Promise.all([api<Fund[]>(`${root(familyId)}/funds`), api<FamilyEvent[]>(`${root(familyId)}/events`)]);
      setFunds(fundRows); setEvents(eventRows);
      const ds = await Promise.all(fundRows.map(async (f) => [f.id, await api<Donation[]>(`${root(familyId)}/funds/${f.id}/donations`)] as const)); setDonations(Object.fromEntries(ds));
      const rs = await Promise.all(eventRows.map(async (e) => [e.id, family?.role === 'owner' || family?.role === 'editor' ? await api<Registration[]>(`${root(familyId)}/events/${e.id}/registrations`) : []] as const)); setRegistrations(Object.fromEntries(rs));
      const own = await Promise.all(eventRows.map(async (e) => { try { return [e.id, await api<Registration>(`${root(familyId)}/events/${e.id}/registrations/me`)] as const; } catch { return [e.id, null] as const; } })); setMine(Object.fromEntries(own));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Мэдээлэл ачаалж чадсангүй.'); }
  }, [family, familyId]);
  useEffect(() => { void reload(); }, [reload]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await Promise.all([reload(), reloadPublicFunds()]); setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Үйлдэл амжилтгүй боллоо.'); }
    finally { setBusy(false); }
  }
  async function newFund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const d = new FormData(form);
    const visibility = d.get('visibility') === 'public' ? 'public' : 'family';
    await run(() => api(`${root(familyId)}/funds`, { method: 'POST', body: JSON.stringify({ title: d.get('title'), purpose: d.get('purpose'), currency: 'MNT', payment_instruction: d.get('instruction'), visibility }) }), visibility === 'public' ? 'Санг нийтэд хуваалцлаа.' : 'Гэр бүлийн сан үүслээ.'); form.reset(); setFundVisibility('family');
  }
  async function newEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const d = new FormData(form);
    await run(() => api(`${root(familyId)}/events`, { method: 'POST', body: JSON.stringify({ title: d.get('title'), description: d.get('description'), location: d.get('location'), starts_at: new Date(String(d.get('starts_at'))).toISOString(), registration_deadline: d.get('deadline') ? new Date(String(d.get('deadline'))).toISOString() : null, capacity: d.get('capacity') ? Number(d.get('capacity')) : null, adult_fee_minor: Number(d.get('adult_fee')) * 100, child_fee_minor: Number(d.get('child_fee')) * 100, currency: 'MNT', payment_instruction: d.get('instruction') }) }), 'Арга хэмжээ үүслээ.'); form.reset();
  }
  if (contextLoading) return <main className="activities-page"><p role="status" className="activities-empty">Гэр бүлийн орчныг ачаалж байна…</p></main>;
  if (!familyId) return (
    <main className="activities-page">
      <header className="activities-heading">
        <div>
          <span>ГЭР БҮЛИЙН ХАМТЫН АМЬДРАЛ</span>
          <h1>Сан ба уулзалт</h1>
          <p>Нийтэд хуваалцсан гэр бүлийн санг эндээс харах боломжтой.</p>
        </div>
        <button type="button" onClick={() => void reloadPublicFunds()} disabled={publicFundsLoading}>Шинэчлэх</button>
      </header>
      <PublicFundsSection rows={publicFunds} loading={publicFundsLoading} error={publicFundsError} onRetry={() => void reloadPublicFunds()} />
      <p className="activities-empty" role="status">
        Өөрийн гэр бүлийн сан, уулзалтыг харахын тулд гэр бүлийн орчноо сонгоно уу. <Link href="/families">Гэр бүлүүдийг үзэх →</Link>
      </p>
    </main>
  );
  return <main className="activities-page">
    <header className="activities-heading"><div><span>ГЭР БҮЛИЙН ХАМТЫН АМЬДРАЛ</span><h1>Сан ба уулзалт</h1><p>{family?.name ?? 'Гэр бүлийн орчин'} · гэр бүлийн болон нийтэд хуваалцсан мэдээлэл</p></div><button onClick={() => { void reload(); void reloadPublicFunds(); }} disabled={busy || publicFundsLoading}>Шинэчлэх</button></header>
    <nav className="activities-tabs" aria-label="Сан ба уулзалтын хэсэг">
      <button type="button" className={section === 'fund' ? 'is-active' : ''} aria-pressed={section === 'fund'} onClick={() => setSection('fund')}>Гэр бүлийн сан <span>{funds.length}</span></button>
      <button type="button" className={section === 'events' ? 'is-active' : ''} aria-pressed={section === 'events'} onClick={() => setSection('events')}>Уулзалт, арга хэмжээ <span>{events.length}</span></button>
    </nav>
    {error && <div className="activities-alert" role="alert">{error}<button onClick={() => void reload()}>Дахин оролдох</button></div>}{notice && <p role="status" className="activities-notice">{notice}</p>}
    {section === 'fund' && <section className="activities-section"><div className="activities-section-title"><div><span>ХАМТЫН САН</span><h2>Гэр бүлийн сан</h2></div><p>Шилжүүлгийг зохион байгуулагч гар аргаар баталгаажуулна.</p></div>
      {owner && <form className="activities-form" onSubmit={(e) => void newFund(e)}><h3>Шинэ сан үүсгэх</h3><label>Сангийн нэр<input name="title" required maxLength={180} /></label><label>Зориулалт<textarea name="purpose" required maxLength={4000} /></label><label>Данс эсвэл QR заавар<textarea name="instruction" required maxLength={4000} /></label><label>Харагдах хүрээ<select name="visibility" value={fundVisibility} onChange={(event) => setFundVisibility(event.target.value === 'public' ? 'public' : 'family')}><option value="family">Зөвхөн энэ гэр бүлд</option><option value="public">Бүх нэвтэрсэн хэрэглэгчид</option></select></label>{fundVisibility === 'public' && <p className="activities-hint" role="note">Нийтийн болгосноор сангийн нэр, зориулалт, шилжүүлгийн заавар болон гэр бүлийн нэр бусад нэвтэрсэн хэрэглэгчдэд харагдана.</p>}<button disabled={busy}>Сан үүсгэх</button></form>}
      {!funds.length ? <p className="activities-empty">Одоогоор сан бүртгээгүй байна.</p> : <div className="activities-grid">{funds.map((f) => <article className="activities-card" key={f.id}><div className="activities-card-top"><span className="activities-kicker">{f.visibility === 'public' ? 'НИЙТЭД НЭЭЛТТЭЙ' : 'ГЭР БҮЛИЙН ХҮРЭЭНД'} · {f.is_active ? 'ИДЭВХТЭЙ' : 'ТҮР ЗОГССОН'}</span>{owner && <button className="activities-quiet" disabled={busy} onClick={() => void run(() => api(`${root(familyId)}/funds/${f.id}/status?is_active=${!f.is_active}`, { method: 'PATCH' }), 'Сангийн төлөв шинэчлэгдлээ.')}>{f.is_active ? 'Түр зогсоох' : 'Идэвхжүүлэх'}</button>}</div><h3>{f.title}</h3><p>{f.purpose}</p><div className="activities-instructions"><small>ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ</small><p>{f.payment_instruction}</p></div>{f.is_active && <form className="activities-inline-form" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const d = new FormData(form); void run(() => api(`${root(familyId)}/funds/${f.id}/donations`, { method: 'POST', body: JSON.stringify({ amount_minor: Number(d.get('amount')) * 100, private_donor: d.get('private') === 'on' }) }), 'Хандивын мэдэгдэл бүртгэгдлээ.'); form.reset(); }}><label>Хандивын дүн (₮)<input name="amount" type="number" min="1" required /></label><label className="activities-check"><input name="private" type="checkbox" /> Нэрээ нууцлах</label><button disabled={busy}>Шилжүүлсэн гэж мэдэгдэх</button></form>}<div className="activities-ledger"><h4>Хандивын бүртгэл {owner ? '· гэр бүлийн тайлан' : '· зөвхөн таны бүртгэл'}</h4>{(donations[f.id] ?? []).map((d) => <div className="activities-row" key={d.id}><span>{d.private_donor ? 'Нууц хандивлагч' : d.donor_name ?? 'Гишүүн'} · {money(d.amount_minor, d.currency)} · {d.status}</span>{owner && d.status === 'reported' && <button disabled={busy} onClick={() => void run(() => api(`${root(familyId)}/funds/${f.id}/donations/${d.id}/confirm`, { method: 'POST' }), 'Хандив баталгаажлаа.')}>Батлах</button>}{!owner && d.status === 'pledged' && <button disabled={busy} onClick={() => void run(() => api(`${root(familyId)}/funds/${f.id}/donations/${d.id}/report`, { method: 'POST' }), 'Шилжүүлгийг мэдээллээ.')}>Төлбөр мэдэгдэх</button>}</div>)}</div></article>)}</div>}
      <PublicFundsSection rows={publicFunds.filter((fund) => fund.family_id !== familyId)} loading={publicFundsLoading} error={publicFundsError} onRetry={() => void reloadPublicFunds()} />
    </section>}
    {section === 'events' && <section className="activities-section"><div className="activities-section-title"><div><span>УДМЫН УУЛЗАЛТ</span><h2>Арга хэмжээ</h2></div><p>Гэр бүлийнхэнтэйгээ уулзах дараагийн мөч</p></div>
      {manage && <form className="activities-form" onSubmit={(e) => void newEvent(e)}><h3>Арга хэмжээ нэмэх</h3><div className="activities-form-grid"><label>Нэр<input name="title" required maxLength={180} /></label><label>Байршил<input name="location" required maxLength={300} /></label><label>Эхлэх цаг<input name="starts_at" type="datetime-local" required defaultValue={localDate(30)} /></label></div><label>Тайлбар<textarea name="description" maxLength={12000} /></label><details className="heritage-event-options"><summary>Бүртгэл, багтаамж болон төлбөрийн нэмэлт тохиргоо</summary><div className="activities-form-grid"><label>Бүртгэл хаах<input name="deadline" type="datetime-local" defaultValue={localDate(20)} /></label><label>Суудлын тоо<input name="capacity" type="number" min="1" /></label><label>Том хүний төлбөр ₮<input name="adult_fee" type="number" min="0" defaultValue="0" /></label><label>Хүүхдийн төлбөр ₮<input name="child_fee" type="number" min="0" defaultValue="0" /></label></div><label>Төлбөрийн заавар<textarea name="instruction" maxLength={4000} /></label></details><button disabled={busy}>Арга хэмжээ үүсгэх</button></form>}
      {!events.length ? <p className="activities-empty">Одоогоор уулзалт зарлаагүй байна.</p> : <div className="activities-grid">{events.map((event) => { const own = mine[event.id]; const total = (own?.adult_count ?? 0) * event.adult_fee_minor + (own?.child_count ?? 0) * event.child_fee_minor; return <article className="activities-card" key={event.id}><span className="activities-kicker">{new Date(event.starts_at).toLocaleString('mn-MN')}</span><h3>{event.title}</h3><p>{event.description}</p><p><strong>Байршил:</strong> {event.location}{event.capacity ? ` · ${event.capacity} суудал` : ''}</p>{(event.adult_fee_minor || event.child_fee_minor) > 0 && <p><strong>Төлбөр:</strong> том хүн {money(event.adult_fee_minor, event.currency)}, хүүхэд {money(event.child_fee_minor, event.currency)}</p>}{event.payment_instruction && <div className="activities-instructions"><small>ШИЛЖҮҮЛГИЙН МЭДЭЭЛЭЛ</small><p>{event.payment_instruction}</p></div>}{(!own || own.status === 'cancelled') && <form className="activities-inline-form" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void run(() => api(`${root(familyId)}/events/${event.id}/registrations`, { method: 'POST', body: JSON.stringify({ adult_count: Number(d.get('adults')), child_count: Number(d.get('children')) }) }), 'Арга хэмжээнд бүртгүүллээ.'); }}><label>Том хүн<input name="adults" type="number" min="0" defaultValue="1" /></label><label>Хүүхэд<input name="children" type="number" min="0" defaultValue="0" /></label><button disabled={busy}>Бүртгүүлэх</button></form>}{own && own.status === 'registered' && <div className="activities-instructions"><strong>Таны бүртгэл:</strong> {own.adult_count} том хүн, {own.child_count} хүүхэд · {own.status}<p>Төлбөр {money(total, event.currency)} · {own.payment_status}</p>{own.payment_status === 'unpaid' && <button disabled={busy} onClick={() => void run(() => api(`${root(familyId)}/events/${event.id}/registrations/me/report-payment`, { method: 'POST' }), 'Төлбөр мэдэгдлээ.')}>Төлбөр шилжүүлсэн</button>}<button className="activities-quiet" disabled={busy} onClick={() => void run(() => api(`${root(familyId)}/events/${event.id}/registrations/me/cancel`, { method: 'POST' }), 'Бүртгэл цуцлагдлаа.')}>Бүртгэл цуцлах</button></div>}{manage && <div className="activities-ledger"><h4>Оролцогчдын төлбөр</h4>{(registrations[event.id] ?? []).map((r) => <div className="activities-row" key={r.id}><span>{r.adult_count} том хүн · {r.child_count} хүүхэд · {r.payment_status}</span>{r.payment_status === 'reported' && <button disabled={busy} onClick={() => void run(() => api(`${root(familyId)}/events/${event.id}/registrations/${r.id}/confirm-payment`, { method: 'POST' }), 'Төлбөр баталгаажлаа.')}>Батлах</button>}</div>)}</div>}</article>; })}</div>}
    </section>}
  </main>;
}

export default function ActivitiesPage() {
  return <Suspense fallback={<main className="activities-page"><header className="activities-heading"><div><span>ГЭР БҮЛИЙН ХАМТЫН АМЬДРАЛ</span><h1>Сан ба уулзалт</h1><p role="status">Гэр бүлийн үйл ажиллагааг ачаалж байна…</p></div></header></main>}><ActivitiesContent /></Suspense>;
}
