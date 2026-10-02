'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type DonationInfo = { title: string; purpose: string; currency: string; bank_name: string; account_name: string; account_number: string; qr_image_url: string | null };

export default function SharedDonationBanner({ userId }: { userId: string }) {
  const [info, setInfo] = useState<DonationInfo | null>(null);
  useEffect(() => {
    let active = true;
    api<DonationInfo | null>('/shared-lineage/donation-info')
      .then((result) => { if (active) setInfo(result); })
      .catch(() => { if (active) setInfo(null); });
    return () => { active = false; };
  }, [userId]);
  if (!info) return null;
  return <aside className="shared-donation" aria-label="Гуулингийнхний нийтлэг хандив">
    <span className="shared-donation__mark" aria-hidden="true">💚</span>
    <div className="shared-donation__copy"><strong>{info.title || 'Гуулингийнхны удмын сан'}</strong><p>{info.purpose}</p>
      <div className="shared-donation__bank">{info.bank_name && <span>{info.bank_name}</span>}{info.account_name && <span>{info.account_name}</span>}{info.account_number && <span><b>Данс</b> {info.account_number}</span>}{info.currency && <span>{info.currency}</span>}</div>
    </div>
    {info.qr_image_url && <img className="shared-donation__qr" src={info.qr_image_url} alt="Хандив шилжүүлэх QR код" loading="lazy" referrerPolicy="no-referrer" />}
  </aside>;
}
