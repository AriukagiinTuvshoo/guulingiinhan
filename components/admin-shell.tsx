'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Users,
  GitFork,
  TreeDeciduous,
  Megaphone,
  History,
  ShieldCheck,
  ArrowUpRight,
  LogOut,
  UserRound,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { InstallAppButton } from './install-app';
import { ThemePicker } from './theme-picker';
import styles from '../app/admin/admin.module.css';

export type AdminIdentity = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR';
};

export type AdminSection =
  | 'overview'
  | 'users'
  | 'families'
  | 'people'
  | 'root'
  | 'announcements'
  | 'audit'
  | 'admins';

const roleLabels: Record<AdminIdentity['role'], string> = {
  SUPER_ADMIN: 'Ерөнхий админ',
  ADMIN: 'Админ',
  MODERATOR: 'Хяналтын админ',
};

type IconKind = 'overview' | 'users' | 'families' | 'root' | 'announcements' | 'audit' | 'admins';

function AdminIcon({ kind }: { kind: IconKind }) {
  const props = { size: 17, strokeWidth: 1.65, 'aria-hidden': true as const };
  switch (kind) {
    case 'overview':
      return <LayoutGrid {...props} />;
    case 'users':
      return <Users {...props} />;
    case 'families':
      return <GitFork {...props} />;
    case 'root':
      return <TreeDeciduous {...props} />;
    case 'announcements':
      return <Megaphone {...props} />;
    case 'audit':
      return <History {...props} />;
    case 'admins':
      return <ShieldCheck {...props} />;
  }
}

export default function AdminShell({
  active,
  title,
  children,
  identity: supplied,
  onOpen,
  superOnly = false,
}: {
  active: AdminSection;
  title: string;
  children: ReactNode;
  identity?: AdminIdentity | null;
  onOpen?: (section: AdminSection) => void;
  superOnly?: boolean;
}) {
  const router = useRouter();
  const [who, setWho] = useState<AdminIdentity | null>(supplied || null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const [canRetryAuth, setCanRetryAuth] = useState(false);

  useEffect(() => {
    if (supplied !== undefined) {
      setWho(supplied);
      return;
    }
    let alive = true;
    setError('');
    setCanRetryAuth(false);
    api<AdminIdentity>('/admin/me')
      .then((value) => {
        if (alive) setWho(value);
      })
      .catch((cause) => {
        if (!alive) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace('/login');
        else if (cause instanceof ApiError && cause.status === 403)
          setError('Энэ хэсэгт хандах админ эрх шаардлагатай.');
        else {
          setError('Админ эрхийн мэдээллийг ачаалж чадсангүй. Дахин оролдоно уу.');
          setCanRetryAuth(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [supplied, router, authRevision]);

  async function logout() {
    setWorking(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch {
      setError('Гарах үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.');
      setWorking(false);
    }
  }

  const groups: Array<{
    label: string;
    items: Array<{
      key: AdminSection;
      name: string;
      description: string;
      icon: IconKind;
      restricted?: boolean;
    }>;
  }> = [
    {
      label: 'УДИРДЛАГА',
      items: [
        { key: 'overview', name: 'Ерөнхий', description: 'Системийн тойм', icon: 'overview' },
        { key: 'users', name: 'Хэрэглэгчид', description: 'Аккаунт ба төлөв', icon: 'users' },
        { key: 'people', name: 'Хүмүүс', description: 'Хүний бүртгэл ба холбоос', icon: 'users' },
        { key: 'families', name: 'Гэр бүл, удам', description: 'Гэр бүлийн ажлын орчин', icon: 'families' },
      ],
    },
    {
      label: 'ӨВИЙН САН',
      items: [
        { key: 'root', name: 'Эх мод · хандив', description: 'Хүсэлт ба үндсэн удам', icon: 'root', restricted: true },
        { key: 'announcements', name: 'Мэдэгдэл', description: 'Нийтэлсэн, ноорог', icon: 'announcements' },
        { key: 'audit', name: 'Өөрчлөлтийн түүх', description: 'Үйлдлийн бүртгэл', icon: 'audit', restricted: true },
      ],
    },
    {
      label: 'ХАНДАЛТ',
      items: [
        { key: 'admins', name: 'Админ эрхүүд', description: 'Баг ба хамгаалалт', icon: 'admins', restricted: true },
      ],
    },
  ];

  const href = (key: AdminSection) =>
    key === 'root'
      ? '/admin/ancestry'
      : key === 'people'
        ? '/admin/people'
        : key === 'overview'
          ? '/admin'
          : '/admin?section=' + key;

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#admin-main">
        Үндсэн хэсэг рүү очих
      </a>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerBrand}>
            <Link className={styles.brand} href="/admin">
              ГУУЛИНГИЙНХАН
            </Link>
            <span className={styles.eyebrow}>УДМЫН САНГИЙН УДИРДЛАГА</span>
          </div>
          <div className={styles.headerActions}>
            <ThemePicker variant="compact" />
            <InstallAppButton />
            <Link className={styles.back} href="/settings#account">
              <UserRound size={14} aria-hidden="true" />
              <span>Миний профайл</span>
            </Link>
            <Link className={styles.back} href="/dashboard">
              <span>Апп руу буцах</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
            <button type="button" onClick={() => void logout()} disabled={working}>
              <LogOut size={14} aria-hidden="true" />
              <span>Гарах</span>
            </button>
          </div>
        </header>

        <div className={styles.layout}>
          <nav className={styles.nav} aria-label="Админ цэс">
            {groups.map((group) => {
              const items = group.items.filter((item) => !item.restricted || who?.role === 'SUPER_ADMIN');
              return items.length ? (
                <div key={group.label} className={styles.navGroup}>
                  <span className={styles.navGroupLabel}>{group.label}</span>
                  {items.map((item) => {
                    const isCurrent = active === item.key;
                    const content = (
                      <>
                        <AdminIcon kind={item.icon} />
                        <span className={styles.navText}>
                          <strong>{item.name}</strong>
                          <small>{item.description}</small>
                        </span>
                      </>
                    );
                    return onOpen && item.key !== 'root' && item.key !== 'people' ? (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={isCurrent ? 'page' : undefined}
                        onClick={() => onOpen(item.key)}
                      >
                        {content}
                      </button>
                    ) : (
                      <Link
                        key={item.key}
                        href={href(item.key)}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={styles.navLink}
                      >
                        {content}
                      </Link>
                    );
                  })}
                </div>
              ) : null;
            })}
            <div className={styles.navFootnote}>
              <strong>ГУУЛИНГИЙНХАН</strong>
              <span>Удмын сангийн удирдлага</span>
            </div>
          </nav>

          <section id="admin-main" tabIndex={-1} className={styles.content}>
            <div className={styles.heading}>
              <div>
                <span className={styles.eyebrow}>УДМЫН САНГИЙН УДИРДЛАГА</span>
                <h1>{title}</h1>
              </div>
              {who && (
                <div className={styles.identity}>
                  <strong>{who.display_name}</strong>
                  <span>{roleLabels[who.role]}</span>
                </div>
              )}
            </div>

            {error ? (
              <div className={styles.error} role="alert">
                {error}
                {canRetryAuth && (
                  <div className={styles.panelActions}>
                    <button type="button" onClick={() => setAuthRevision((value) => value + 1)}>
                      Дахин ачаалах
                    </button>
                  </div>
                )}
              </div>
            ) : superOnly && who && who.role !== 'SUPER_ADMIN' ? (
              <p className={styles.state}>Энэ хэсгийг Ерөнхий админ удирдана.</p>
            ) : supplied !== undefined || who ? (
              children
            ) : (
              <p className={styles.state} role="status">
                Админ эрхийг шалгаж байна…
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
