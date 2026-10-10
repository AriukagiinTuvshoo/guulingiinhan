'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/api';
export default function PeoplePage() {
 const router=useRouter();const [failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;const family=new URLSearchParams(window.location.search).get('family');api('/admin/me').then(()=>{if(active)router.replace('/admin/people');}).catch(cause=>{if(!active)return;if(cause instanceof ApiError && cause.status===401)router.replace('/login');else if(cause instanceof ApiError && cause.status===403)router.replace(`/tree?view=family${family?`&family=${encodeURIComponent(family)}`:''}`);else setFailed(true);});return()=>{active=false;};},[router]);
 return <div className="container"><h1>Хүний бүртгэл</h1>{failed?<p role="alert">Хандах эрхийг шалгаж чадсангүй. Хуудсаа дахин ачаална уу.</p>:<p role="status">Хандах эрхийг шалгаж байна…</p>}</div>;
}
