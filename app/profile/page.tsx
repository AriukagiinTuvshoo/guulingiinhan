'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, Marriage, personName, Person } from '../../lib/api';

type EventItem = { id: string; event_type: string; title: string; event_date: string | null; description: string | null };

export default function ProfilePage() {
  const router = useRouter();
  const [family, setFamily] = useState(''); const [id, setId] = useState('');
  const [person, setPerson] = useState<Person | null>(null); const [biography, setBiography] = useState('');
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [editing, setEditing] = useState(false);
  async function load(fid: string, pid: string) {
    const [p, b, e, m] = await Promise.all([
      api<Person>(`/families/${fid}/persons/${pid}`),
      api<{ content: string }>(`/families/${fid}/persons/${pid}/biography`),
      api<EventItem[]>(`/families/${fid}/persons/${pid}/events`),
      api<Marriage[]>(`/families/${fid}/persons/${pid}/marriages`),
    ]);
    setPerson(p); setBiography(b.content); setEvents(e); setMarriages(m);
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); const fid = params.get('family') ?? ''; const pid = params.get('person') ?? '';
    setFamily(fid); setId(pid);
    if (!fid || !pid) { router.replace('/families'); return; }
    load(fid, pid).catch((cause) => { if (cause instanceof ApiError && cause.status === 401) router.replace('/login'); else setError(cause instanceof Error ? cause.message : 'Профайлыг ачаалж чадсангүй.'); });
  }, [router]);
  async function saveBiography(event: FormEvent) {
    event.preventDefault(); setError('');
    try { await api(`/families/${family}/persons/${id}/biography`, { method: 'PUT', body: JSON.stringify({ content: biography }) }); setNotice('Намтар хадгалагдлаа.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Намтрыг хадгалж чадсангүй.'); }
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); const values = new FormData(event.currentTarget);
    try {
      await api(`/families/${family}/persons/${id}`, { method: 'PATCH', body: JSON.stringify({ first_name: values.get('first_name'), last_name: values.get('last_name'), gender: values.get('gender'), birth_date: values.get('birth_date') || null, birth_place: values.get('birth_place') || null, is_alive: values.get('is_alive') === 'true', death_date: values.get('death_date') || null, death_place: values.get('death_place') || null, visibility: values.get('visibility') }) });
      await load(family, id); setEditing(false); setNotice('Profile хадгалагдлаа.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Profile хадгалж чадсангүй.'); }
  }
  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { await api(`/families/${family}/persons/${id}/events`, { method: 'POST', body: JSON.stringify({ event_type: form.get('event_type'), title: form.get('title'), event_date: form.get('event_date') || null, description: form.get('description') || null }) }); await load(family, id); formElement.reset(); setNotice('Үйл явдал нэмэгдлээ.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Үйл явдал нэмэж чадсангүй.'); }
  }
  if (!person) return <main className="mvp"><section className="mvpbox">{error ? <div className="error">{error}</div> : 'Ачаалж байна…'}</section></main>;
  return <main className="mvp"><section className="mvpbox" style={{ maxWidth: 900 }}><div className="row space"><Link href={`/tree?family=${family}`}>← Ургийн мод</Link><button onClick={() => setEditing((v) => !v)}>{editing ? 'Болих' : 'Profile засах'}</button></div><h1 style={{ marginTop: 22 }}>{personName(person)}</h1><p>{person.birth_date ?? 'Төрсөн огноо тодорхойгүй'} · {person.birth_place ?? 'төрсөн газар тодорхойгүй'}</p>{!person.is_alive && <p>Нас барсан: {person.death_date ?? 'огноо тодорхойгүй'} · {person.death_place ?? ''}</p>}{error && <div className="error" role="alert">{error}</div>}{notice && <div className="success">{notice}</div>}
    {editing && <section className="card"><h2>Хувийн мэдээлэл</h2><form onSubmit={saveProfile}><div className="row"><label style={{ flex: 1 }}>Нэр<input name="first_name" defaultValue={person.first_name} required maxLength={120} /></label><label style={{ flex: 1 }}>Овог<input name="last_name" defaultValue={person.last_name} maxLength={120} /></label></div><label>Хүйс<select name="gender" defaultValue={person.gender}><option value="unknown">Тодорхойгүй</option><option value="female">Эмэгтэй</option><option value="male">Эрэгтэй</option><option value="other">Бусад</option></select></label><label>Төрсөн огноо<input name="birth_date" type="date" defaultValue={person.birth_date ?? ''} /></label><label>Төрсөн газар<input name="birth_place" defaultValue={person.birth_place ?? ''} maxLength={240} /></label><label>Амьд эсэх<select name="is_alive" defaultValue={String(person.is_alive)}><option value="true">Амьд</option><option value="false">Нас барсан</option></select></label><label>Нас барсан огноо<input name="death_date" type="date" defaultValue={person.death_date ?? ''} /></label><label>Нас барсан газар<input name="death_place" defaultValue={person.death_place ?? ''} maxLength={240} /></label><label>Нууцлал<select name="visibility" defaultValue={person.visibility}><option value="private">Зөвхөн би</option><option value="family">Гэр бүлийнхэн</option><option value="public">Нийтийн</option></select></label><button className="primary">Profile хадгалах</button></form></section>}
    <div className="cards"><section className="card" style={{ gridColumn: '1 / -1' }}><h2>Намтар</h2><form onSubmit={saveBiography}><label>Намтар<textarea value={biography} onChange={(e) => setBiography(e.target.value)} maxLength={50000} placeholder="Амьдралын түүхээ бичнэ үү…" /></label><button className="primary">Хадгалах</button></form></section>
    <section className="card"><h2>Амьдралын үйл явдал</h2>{events.length === 0 ? <p>Үйл явдал бүртгээгүй байна.</p> : events.map((item) => <div key={item.id} style={{ borderBottom: '1px solid #285847', padding: '10px 0' }}><strong>{item.event_date ?? 'Он тодорхойгүй'} · {item.title}</strong>{item.description && <p>{item.description}</p>}</div>)}</section>
    <section className="card"><h2>Гэрлэлтийн түүх</h2>{marriages.length === 0 ? <p>Гэрлэлтийн мэдээлэл бүртгээгүй байна.</p> : marriages.map((marriage) => <div key={marriage.id} style={{ borderBottom: '1px solid #285847', padding: '10px 0' }}><strong>{marriage.other_person ? personName(marriage.other_person) : 'Хань'} · {marriage.status === 'married' ? 'Одоо хамт' : marriage.status === 'divorced' ? 'Салсан' : 'Бэлэвсэн'}</strong><p>{marriage.start_date ?? 'Эхэлсэн огноо тодорхойгүй'} – {marriage.end_date ?? (marriage.status === 'married' ? 'Одоо' : 'Дууссан огноо тодорхойгүй')}</p>{marriage.location && <p>{marriage.location}</p>}{marriage.description && <p>{marriage.description}</p>}</div>)}</section>
    <section className="card"><h2>Үйл явдал нэмэх</h2><form onSubmit={addEvent}><label>Төрөл<select name="event_type"><option value="school">Сургууль</option><option value="work">Ажил</option><option value="move">Нүүх</option><option value="marriage">Гэрлэлт</option><option value="divorce">Салалт</option><option value="child_birth">Хүүхэд төрсөн</option><option value="other">Бусад</option></select></label><label>Гарчиг<input name="title" required maxLength={180} /></label><label>Огноо<input name="event_date" type="date" /></label><label>Тайлбар<textarea name="description" maxLength={10000} /></label><button className="primary">Үйл явдал нэмэх</button></form></section></div>
  </section></main>;
}
