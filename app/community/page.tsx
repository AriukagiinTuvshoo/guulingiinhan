'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BookOpen,
  Camera,
  ChevronDown,
  Globe2,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import MemoryInteractions from '../../components/memory-interactions';
import { MongolianOrnamentBand } from '../../components/mongolian-ornament-band';
import ProfilePhoto from '../../components/profile-photo';
import { useAppShellContext } from '../../components/app-shell';
import { ApiError, api } from '../../lib/api';
import styles from './community.module.css';

type Post = {
  id: string;
  kind: 'story' | 'memory' | 'archive';
  family_id: string;
  family_name: string;
  author_name: string;
  title: string;
  content: string;
  event_date: string | null;
  created_at: string;
  thumbnail_url: string | null;
  liked?: boolean;
  like_count?: number;
  comment_count?: number;
};

type Feed = {
  items: Post[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};

type Kind = 'all' | Post['kind'];
type SortMode = 'newest' | 'oldest' | 'popular';

const KIND_LABELS: Record<Post['kind'], string> = {
  story: 'Түүх',
  memory: 'Дурсамж',
  archive: 'Архив',
};

const SECTIONS: { kind: Kind; label: string; icon: typeof Sparkles }[] = [
  { kind: 'all', label: 'Бүгд', icon: Sparkles },
  { kind: 'story', label: 'Түүх', icon: BookOpen },
  { kind: 'memory', label: 'Дурсамж', icon: Camera },
  { kind: 'archive', label: 'Архив', icon: Archive },
];

export default function CommunityPage() {
  const { familyId } = useAppShellContext();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('kind');
    setKind(SECTIONS.some((section) => section.kind === requested) ? (requested as Kind) : 'all');
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const load = useCallback(async (nextPage: number, selectedKind: Kind) => {
    setLoading(true);
    setError('');
    try {
      const result = await api<Feed>(`/community/feed?page=${nextPage}&page_size=12&kind=${selectedKind}`);
      setFeed(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Нийтийн нийтлэлийг ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (kind) void load(page, kind);
  }, [kind, load, page]);

  const visibleItems = useMemo(() => {
    const items = feed?.items ?? [];
    const query = search.trim().toLowerCase();
    const filtered = query
      ? items.filter((post) => {
          const haystack = `${post.title} ${post.content} ${post.author_name} ${post.family_name}`.toLowerCase();
          return haystack.includes(query);
        })
      : items;

    if (sort === 'newest') return filtered;
    return [...filtered].sort((a, b) => {
      if (sort === 'popular') {
        const scoreA = (a.like_count ?? 0) * 2 + (a.comment_count ?? 0);
        const scoreB = (b.like_count ?? 0) * 2 + (b.comment_count ?? 0);
        return scoreB - scoreA;
      }
      const timeA = new Date(a.event_date ?? a.created_at).getTime();
      const timeB = new Date(b.event_date ?? b.created_at).getTime();
      return timeA - timeB;
    });
  }, [feed, search, sort]);

  const encodedFamily = familyId ? encodeURIComponent(familyId) : '';
  const emptyTitle =
    kind === 'memory'
      ? 'Нийтийн дурсамж хараахан алга'
      : kind === 'archive'
        ? 'Нийтийн архив хараахан алга'
        : 'Нийтийн түүх одоогоор алга';

  const primaryCtaHref =
    kind === 'memory'
      ? `/memories?family=${encodedFamily}`
      : kind === 'archive'
        ? `/archives/new?family=${encodedFamily}`
        : `/stories/new?family=${encodedFamily}`;

  const primaryCtaLabel =
    kind === 'memory'
      ? 'Анхны дурсамж нэмэх'
      : kind === 'archive'
        ? 'Анхны архив нэмэх'
        : 'Анхны түүх нийтлэх';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.titleGroup}>
            <span className={styles.eyebrow}>
              <Globe2 size={14} aria-hidden="true" />
              ГУУЛИНГИЙНХАН · НИЙТИЙН ТҮҮХ
            </span>
            <h1 className={styles.title}>Нийтийн түүх</h1>
            <p className={styles.subtitle}>
              Гэр бүлүүдийн нийтэд зориулж хуваалцсан түүх, дурсамж, архивын бичлэгүүдийг нэг дороос уншаарай.
            </p>
          </div>

          {familyId && (
            <div className={styles.publishWrap} ref={menuRef}>
              <button
                type="button"
                className={styles.publishBtn}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <Plus size={16} aria-hidden="true" />
                Нийтлэх
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className={`${styles.chevron} ${menuOpen ? styles.chevronOpen : ''}`}
                />
              </button>

              {menuOpen && (
                <div role="menu" className={styles.publishMenu} aria-label="Шинэ нийтлэл нэмэх">
                  <Link
                    role="menuitem"
                    href={`/stories/new?family=${encodedFamily}`}
                    className={styles.publishItem}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className={styles.publishItemIcon}>
                      <BookOpen size={16} aria-hidden="true" />
                    </span>
                    <span className={styles.publishItemText}>
                      <span className={styles.publishItemTitle}>Түүх нийтлэх</span>
                      <span className={styles.publishItemDesc}>Удмын болон гэр бүлийн түүх</span>
                    </span>
                  </Link>
                  <Link
                    role="menuitem"
                    href={`/memories?family=${encodedFamily}`}
                    className={styles.publishItem}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className={styles.publishItemIcon}>
                      <Camera size={16} aria-hidden="true" />
                    </span>
                    <span className={styles.publishItemText}>
                      <span className={styles.publishItemTitle}>Дурсамж нэмэх</span>
                      <span className={styles.publishItemDesc}>Гэрэл зураг, онцлох мөч</span>
                    </span>
                  </Link>
                  <Link
                    role="menuitem"
                    href={`/archives/new?family=${encodedFamily}`}
                    className={styles.publishItem}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className={styles.publishItemIcon}>
                      <Archive size={16} aria-hidden="true" />
                    </span>
                    <span className={styles.publishItemText}>
                      <span className={styles.publishItemTitle}>Архив нэмэх</span>
                      <span className={styles.publishItemDesc}>Баримт бичиг, хуучин эх сурвалж</span>
                    </span>
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        <MongolianOrnamentBand />
      </header>

      <section className={styles.toolbar} aria-label="Шүүлтүүр ба хайлт">
        <div className={styles.toolbarRow}>
          <nav className={styles.sections} aria-label="Нийтийн өвийн төрлүүд">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isCurrent = kind === section.kind;
              return (
                <Link
                  key={section.kind}
                  href={section.kind === 'all' ? '/community' : `/community?kind=${section.kind}`}
                  className={styles.tab}
                  onClick={() => {
                    setKind(section.kind);
                    setPage(1);
                  }}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{section.label}</span>
                  {isCurrent && !loading && feed && (
                    <span className={styles.tabBadge}>{feed.total}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className={styles.controls}>
            <div className={styles.searchWrap}>
              <Search size={15} className={styles.searchIcon} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Гарчиг, зохиогчоор хайх…"
                aria-label="Нийтийн нийтлэлээс хайх"
                className={styles.searchInput}
              />
              {search && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() => setSearch('')}
                  aria-label="Хайлт цэвэрлэх"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              aria-label="Эрэмбэлэх дараалал"
              className={styles.sortSelect}
            >
              <option value="newest">Шинэ нь эхэндээ</option>
              <option value="oldest">Хуучин нь эхэндээ</option>
              <option value="popular">Хамгийн их таалагдсан</option>
            </select>
          </div>
        </div>

        <div className={styles.metaStrip}>
          <span className={styles.privacyPill}>
            <Globe2 size={13} aria-hidden="true" />
            Зөвхөн “Нийтийн” төлөвтэй бичлэгүүд харагдана — хувийн болон гэр бүлийн бичлэг нууцлалтай хэвээр үлдэнэ.
          </span>
          {!loading && feed && feed.total > 0 && (
            <span className={styles.countText}>
              {search.trim()
                ? `Илэрц: ${visibleItems.length} / ${feed.items.length}`
                : `Нийт ${feed.total} нийтлэл`}
            </span>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className={styles.error}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              if (kind) void load(page, kind);
            }}
          >
            Дахин оролдох
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-label="Нийтлэлийг ачаалж байна" className={styles.skeletonGrid}>
          {[0, 1, 2].map((idx) => (
            <div key={idx} className={styles.skeletonCard}>
              <div className={styles.skeletonBar} style={{ width: '42%', height: 20 }} />
              <div className={styles.skeletonBar} style={{ width: '100%', height: 150 }} />
              <div className={styles.skeletonBar} style={{ width: '78%', height: 22 }} />
              <div className={styles.skeletonBar} style={{ width: '92%', height: 14 }} />
              <div className={styles.skeletonBar} style={{ width: '64%', height: 14 }} />
            </div>
          ))}
        </div>
      ) : visibleItems.length > 0 ? (
        <>
          <div className={styles.list}>
            {visibleItems.map((post) => {
              const KindIcon =
                post.kind === 'memory' ? Camera : post.kind === 'archive' ? Archive : BookOpen;
              return (
                <article key={`${post.kind}-${post.id}`} className={styles.card}>
                  <div className={styles.meta}>
                    <span className={styles.kind}>
                      <KindIcon size={12} aria-hidden="true" />
                      {KIND_LABELS[post.kind]}
                    </span>
                    <span>{post.family_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{post.author_name}</span>
                  </div>

                  {post.thumbnail_url && (
                    <ProfilePhoto
                      url={post.thumbnail_url}
                      name={post.title}
                      fallback=""
                      className={styles.photo}
                    />
                  )}

                  <h2 className={styles.cardTitle}>
                    <Link href={`/community/${post.kind}/${encodeURIComponent(post.id)}`}>
                      {post.title}
                    </Link>
                  </h2>

                  <p className={styles.date}>
                    {new Date(post.event_date ?? post.created_at).toLocaleDateString('mn-MN')}
                  </p>

                  {post.content && <p className={styles.content}>{post.content}</p>}

                  <div className={styles.cardFooter}>
                    <Link
                      href={`/community/${post.kind}/${encodeURIComponent(post.id)}`}
                      className={styles.readMore}
                    >
                      Бүтнээр унших
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>

                    {post.kind === 'memory' && (
                      <MemoryInteractions
                        memoryId={post.id}
                        initial={
                          post.like_count !== undefined && post.like_count !== null
                            ? {
                                liked: post.liked ?? false,
                                like_count: post.like_count,
                                comment_count: post.comment_count ?? 0,
                              }
                            : undefined
                        }
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {feed && (page > 1 || feed.has_next) && (
            <nav className={styles.pagination} aria-label="Нийтлэлийн хуудас">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Өмнөх
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(feed.total / feed.page_size))}
              </span>
              <button type="button" disabled={!feed.has_next} onClick={() => setPage(page + 1)}>
                Дараах
              </button>
            </nav>
          )}
        </>
      ) : (
        !error && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon} aria-hidden="true">
              {kind === 'memory' ? (
                <Camera size={24} />
              ) : kind === 'archive' ? (
                <Archive size={24} />
              ) : (
                <BookOpen size={24} />
              )}
            </div>
            <h2>{search.trim() ? 'Хайлтад тохирох нийтлэл олдсонгүй' : emptyTitle}</h2>
            <p>
              {search.trim()
                ? 'Өөр түлхүүр үгээр хайх эсвэл хайлтын утгаа цэвэрлээд дахин үзнэ үү.'
                : 'Бичлэг үүсгэхдээ харагдах хүрээг “Нийтийн” гэж сонговол бүх гишүүдтэй хуваалцагдана.'}
            </p>
            {search.trim() ? (
              <button type="button" className={styles.emptyCta} onClick={() => setSearch('')}>
                Хайлт цэвэрлэх
              </button>
            ) : (
              familyId && (
                <Link href={primaryCtaHref} className={styles.emptyCta}>
                  <Plus size={16} aria-hidden="true" />
                  {primaryCtaLabel}
                </Link>
              )
            )}
          </div>
        )
      )}
    </main>
  );
}
