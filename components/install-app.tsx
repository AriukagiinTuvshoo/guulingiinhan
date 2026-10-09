'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Download, X } from 'lucide-react';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
const InstallContext = createContext<{ prompt: InstallPrompt | null; installed: boolean; consume(): void }>({ prompt: null, installed: false, consume() {} });

export function InstallAppProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const afterInstall = () => { setInstalled(true); setPrompt(null); };
    update();
    standalone.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', afterInstall);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      // No private pages, media or API responses are stored by this worker.
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
    }
    return () => {
      standalone.removeEventListener('change', update);
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', afterInstall);
    };
  }, []);
  return <InstallContext.Provider value={{ prompt, installed, consume: () => setPrompt(null) }}>{children}</InstallContext.Provider>;
}

export function InstallAppButton({ menuItem = false }: { menuItem?: boolean }) {
  const { prompt, installed, consume } = useContext(InstallContext);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!help) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setHelp(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [help]);
  if (installed) return null;
  async function install() {
    if (!prompt) { setHelp(value => !value); return; }
    setBusy(true);
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setHelp(true); }
    finally { consume(); setBusy(false); }
  }
  return <div className="install-app">
    <button type="button" role={menuItem ? 'menuitem' : undefined} className="install-app__button" disabled={busy} onClick={() => void install()} aria-expanded={help}>
      <Download size={17} aria-hidden="true" />{busy ? 'Түр хүлээнэ үү…' : 'Апп суулгах'}
    </button>
    {help && <div className="install-app__help" role="status">
      <button type="button" aria-label="Суулгах зааврыг хаах" onClick={() => setHelp(false)}><X size={16} /></button>
      <strong>Утасныхаа нүүр дэлгэцэд нэмэх</strong>
      <p>iPhone / iPad: хуваалцах цэснээс «Нүүр дэлгэцэд нэмэх» (Add to Home Screen) сонгоно.</p>
      <p>Android / компьютер: browser-ийн цэснээс «Апп суулгах» эсвэл «Нүүр дэлгэцэд нэмэх» сонгоно.</p>
      <small>Аппын мэдээллийг харахад интернет холболт шаардлагатай.</small>
    </div>}
  </div>;
}
