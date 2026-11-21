'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type DonationInfo = { title: string; purpose: string; currency: string; bank_name: string; account_name: string; account_number: string; qr_image_url: string | null };

export default function SharedDonationBanner({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [info, setInfo] = useState<DonationInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let active = true;
    setDismissed(window.sessionStorage.getItem(`donation-dismissed:${userId}`) === '1');
    api<DonationInfo | null>('/shared-lineage/donation-info')
      .then((result) => { if (active) setInfo(result); })
      .catch(() => { if (active) setInfo(null); });
    return () => { active = false; };
  }, [userId]);
  if (!info || dismissed) return null;
  const content = <aside className="shared-donation" aria-label="Гуулингийнхний нийтлэг хандив">
    <span className="shared-donation__mark" aria-hidden="true">💚</span>
    <div className="shared-donation__copy"><strong>{info.title || 'Гуулингийнхны удмын сан'}</strong><p>{info.purpose}</p>
      <div className="shared-donation__bank">{info.bank_name && <span>{info.bank_name}</span>}{info.account_name && <span>{info.account_name}</span>}{info.account_number && <span><b>Данс</b> {info.account_number}</span>}{info.currency && <span>{info.currency}</span>}</div>
    </div>
    {info.account_number && <button type="button" className="shared-donation__copy-button" onClick={async () => {
      try { await navigator.clipboard.writeText(info.account_number); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
      catch { setCopied(false); }
    }}>{copied ? 'Хуулагдлаа ✓' : 'Данс хуулах'}</button>}
    {info.qr_image_url && <img className="shared-donation__qr" src={info.qr_image_url} alt="Хандив шилжүүлэх QR код" loading="lazy" referrerPolicy="no-referrer" />}
    <button type="button" className="shared-donation__dismiss" aria-label="Хандивын мэдээллийг энэ удаа хаах" onClick={() => {
      window.sessionStorage.setItem(`donation-dismissed:${userId}`, '1');
      setDismissed(true);
    }}>✕</button>
  </aside>;
  return compact ? <details className="tree-shell-notice tree-shell-notice--fund"><summary><span aria-hidden="true">♡</span><span>{info.title || 'Гуулингийнхны сан'}</span><small>Дэлгэрэнгүй</small></summary>{content}</details> : content;
}
