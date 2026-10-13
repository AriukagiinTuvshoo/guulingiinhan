'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../lib/api';
import { InstallAppButton } from './install-app';
import styles from '../app/admin/admin.module.css';
export type AdminIdentity = { user_id: string; display_name: string; email: string | null; role: 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR' };
export type AdminSection = 'overview' | 'users' | 'families' | 'people' | 'root' | 'announcements' | 'audit' | 'admins';
const roleLabels = { SUPER_ADMIN: 'Ерөнхий админ', ADMIN: 'Админ', MODERATOR: 'Хяналтын админ' };
function AdminIcon({ kind }: { kind: 'overview' | 'users' | 'families' | 'root' | 'announcements' | 'audit' | 'admins' }) {
  const paths = {
    overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    families: 'M12 8v5M5 13h14M5 13v3M19 13v3M8 3h8v5H8zM2 16h6v5H2zM16 16h6v5h-6z',
    root: 'M12 3 5 12h4l-5 6h16l-5-6h4L12 3M12 18v4',
    announcements: 'M3 10v4h4l12 5V5L7 10H3M7 14l2 7h3l-2-6M22 9v6',
    audit: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2',
    admins: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4M8 12l3 3 5-6',
  };
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}


export default function AdminShell({ active, title, children, identity: supplied, onOpen, superOnly = false }: { active: AdminSection; title: string; children: ReactNode; identity?: AdminIdentity | null; onOpen?: (section: AdminSection) => void; superOnly?: boolean }) {
 const router=useRouter(); const [who,setWho]=useState<AdminIdentity|null>(supplied || null); const [error,setError]=useState('');const [working,setWorking]=useState(false);const [authRevision,setAuthRevision]=useState(0);const [canRetryAuth,setCanRetryAuth]=useState(false);
 useEffect(()=>{if(supplied !== undefined){setWho(supplied);return;}let alive=true;setError('');setCanRetryAuth(false); api<AdminIdentity>('/admin/me').then(value=>{if(alive)setWho(value);}).catch(cause=>{if(!alive)return;if(cause instanceof ApiError && cause.status===401)router.replace('/login');else if(cause instanceof ApiError && cause.status===403)setError('Энэ хэсэгт хандах админ эрх шаардлагатай.');else{setError('Админ эрхийн мэдээллийг ачаалж чадсангүй. Дахин оролдоно уу.');setCanRetryAuth(true);}});return()=>{alive=false;};},[supplied,router,authRevision]);
 async function logout(){setWorking(true);try{await api('/auth/logout',{method:'POST'});router.replace('/login');}catch{setError('Гарах үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.');setWorking(false);}}
 const groups:Array<{label:string;items:Array<{key:AdminSection;name:string;description:string;icon:'overview'|'users'|'families'|'root'|'announcements'|'audit'|'admins';restricted?:boolean}>}>=[
 {label:'УДИРДЛАГА',items:[{key:'overview',name:'Ерөнхий',description:'Системийн тойм',icon:'overview'},{key:'users',name:'Хэрэглэгчид',description:'Аккаунт ба төлөв',icon:'users'},{key:'people',name:'Хүмүүс',description:'Хүний бүртгэл ба холбоос',icon:'users'},{key:'families',name:'Гэр бүл, удам',description:'Гэр бүлийн ажлын орчин',icon:'families'}]},
 {label:'ӨВИЙН САН',items:[{key:'root',name:'Эх мод · хандив',description:'Хүсэлт ба үндсэн удам',icon:'root',restricted:true},{key:'announcements',name:'Мэдэгдэл',description:'Нийтэлсэн, ноорог',icon:'announcements'},{key:'audit',name:'Өөрчлөлтийн түүх',description:'Үйлдлийн бүртгэл',icon:'audit',restricted:true}]},
 {label:'ХАНДАЛТ',items:[{key:'admins',name:'Админ эрхүүд',description:'Баг ба хамгаалалт',icon:'admins',restricted:true}]}];
 const href=(key:AdminSection)=>key==='root'?'/admin/ancestry':key==='people'?'/admin/people':key==='overview'?'/admin': '/admin?section='+key;
 return <main className={styles.page}><a className={styles.skipLink} href="#admin-main">Үндсэн хэсэг рүү очих</a><div className={styles.shell}><header className={styles.header}><div><Link className={styles.brand} href="/admin">ГУУЛИНГИЙНХАН</Link><span className={styles.eyebrow}>УДИРДЛАГЫН ОРЧИН</span></div><div className={styles.headerActions}><InstallAppButton/><Link className={styles.back} href="/settings#account">Миний профайл</Link><Link className={styles.back} href="/dashboard">Апп руу буцах →</Link><button type="button" onClick={()=>void logout()} disabled={working}>Гарах</button></div></header><div className={styles.layout}><nav className={styles.nav} aria-label="Админ цэс">{groups.map(group=>{const items=group.items.filter(item=>!item.restricted || who?.role==='SUPER_ADMIN');return items.length?<div key={group.label} className={styles.navGroup}><span className={styles.navGroupLabel}>{group.label}</span>{items.map(item=>{const content=<><AdminIcon kind={item.icon}/><span className={styles.navText}><strong>{item.name}</strong><small>{item.description}</small></span></>;return onOpen && item.key!=='root' && item.key!=='people'?<button key={item.key} type="button" aria-current={active===item.key?'page':undefined} onClick={()=>onOpen(item.key)}>{content}</button>:<Link key={item.key} href={href(item.key)} aria-current={active===item.key?'page':undefined} className={styles.navLink}>{content}</Link>;})}</div>:null;})}<p className={styles.navFootnote}>🌳 ГУУЛИНГИЙНХАН<br/>Удмын сангийн удирдлага</p></nav><section id="admin-main" tabIndex={-1} className={styles.content}><div className={styles.heading}><div><span className={styles.eyebrow}>УДМЫН САНГИЙН УДИРДЛАГА</span><h1>{title}</h1></div>{who && <div className={styles.identity}><strong>{who.display_name}</strong><span>{roleLabels[who.role]}</span></div>}</div>{error?<div className={styles.error} role="alert">{error}{canRetryAuth&&<div className={styles.panelActions}><button type="button" onClick={()=>setAuthRevision(value=>value+1)}>Дахин ачаалах</button></div>}</div>:superOnly && who && who.role!=='SUPER_ADMIN'?<p className={styles.state}>Энэ хэсгийг Ерөнхий админ удирдана.</p>: supplied !== undefined || who ? children : <p className={styles.state} role="status">Админ эрхийг шалгаж байна…</p>}</section></div></div></main>;
}
