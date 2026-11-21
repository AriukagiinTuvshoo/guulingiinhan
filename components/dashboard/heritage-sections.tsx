"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  TreeDeciduous,
  Plus,
  Image as ImageIcon,
} from "lucide-react";
import {
  API_BASE,
  type Family,
  type Person,
  type TreeData,
  type MemoryListItem,
  type StoryListPage,
  type ArchiveListPage,
  personName,
} from "../../lib/api";
import type { SectionData } from "./use-dashboard-section";
export type MemoryPage = {
  items: MemoryListItem[];
  total: number;
  page: number;
  page_size: number;
};
export const familyLink = (path: string, familyId: string) =>
  `${path}?family=${encodeURIComponent(familyId)}`;
export const personLink = (id: string, familyId: string) =>
  `${familyLink("/profile", familyId)}&person=${encodeURIComponent(id)}`;
export function displayDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : `${date.getUTCFullYear()} оны ${date.getUTCMonth() + 1} сарын ${date.getUTCDate()}`;
}
export function SectionHeading({
  eyebrow,
  title,
  href,
  linkText = "Бүгдийг үзэх",
}: {
  eyebrow: string;
  title: string;
  href?: string;
  linkText?: string;
}) {
  return (
    <header className="heritage-section-heading">
      <div>
        <p className="heritage-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {href && (
        <Link href={href}>
          {linkText}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </header>
  );
}
export function EmptyState({
  title,
  children,
  href,
  action,
  headingLevel = "h3",
}: {
  title: string;
  children?: ReactNode;
  href?: string;
  action?: string;
  headingLevel?: "h1" | "h2" | "h3";
}) {
  const Heading = headingLevel;
  return (
    <div className="heritage-empty">
      <Heading>{title}</Heading>
      {children && <p>{children}</p>}
      {href && (
        <Link className="heritage-text-link" href={href}>
          {action}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
export function SectionState<T>({
  state,
  children,
  kind = "lines",
}: {
  state: SectionData<T>;
  children: (data: T) => ReactNode;
  kind?: "lines" | "album" | "tree";
}) {
  if (state.loading)
    return (
      <div
        className={`heritage-skeleton heritage-skeleton--${kind}`}
        role="status"
        aria-label="Мэдээллийг ачаалж байна"
      >
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  if (state.error || !state.data)
    return (
      <div className="heritage-error" role="alert">
        <p>{state.error || "Мэдээллийг ачаалж чадсангүй."}</p>
        <button onClick={state.retry}>Дахин оролдох</button>
      </div>
    );
  return children(state.data);
}
export function DashboardSkeleton() {
  return (
    <main
      className="heritage-dashboard"
      aria-busy="true"
      aria-label="Гэр бүлийн орчныг ачаалж байна"
    >
      <h1 className="sr-only">Гэр бүлийн тойм</h1>
      <div className="heritage-skeleton heritage-skeleton--hero">
        <span />
        <span />
        <span />
      </div>
      <div className="heritage-stats-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="heritage-skeleton heritage-skeleton--tree">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
export function DashboardHero({
  family,
  name,
}: {
  family: Family;
  name?: string;
}) {
  return (
    <header className="heritage-hero">
      <div className="heritage-hero-copy">
        <p className="heritage-eyebrow">МАНАЙ ГЭР БҮЛИЙН ӨВ</p>
        <p className="heritage-family-name">{family.name}</p>
        <h1>
          Хамтдаа бүтээсэн түүх.
          <br />
          <em>Үе дамжин үлдэх өв.</em>
        </h1>
        <p className="heritage-hero-description">
          {family.description ||
            "Бидний хүмүүс, нандигнах дурсамж, ярьж үлдээх түүх — манай гэр бүлийн хувийн орон зай."}
        </p>
        <div className="heritage-hero-actions">
          <Link
            className="heritage-button heritage-button--gold"
            href={familyLink("/tree", family.id)}
          >
            Удмын модыг үзэх
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link
            className="heritage-hero-story-link"
            href={familyLink("/stories", family.id)}
          >
            Манай түүх <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        {name && <p className="heritage-welcome">Тавтай морил, {name}.</p>}
      </div>
      <div className="heritage-hero-art" aria-hidden="true">
        <svg viewBox="0 0 220 340" fill="none">
          <path d="M112 330V72M112 258C36 242 12 192 30 142C86 146 112 201 112 258ZM112 207C179 198 215 139 191 94C140 112 113 155 112 207ZM112 150C57 131 47 81 62 51C96 65 113 107 112 150ZM112 106C144 75 148 35 126 9C99 45 95 75 112 106Z" />
          <path d="M30 142L112 258M191 94L112 207M62 51L112 150" />
        </svg>
        <span>ҮНДЭС · ХОЛБОО · ҮРГЭЛЖЛЭЛ</span>
      </div>
    </header>
  );
}
export function TreeOverview({
  state,
  familyId,
}: {
  state: SectionData<TreeData>;
  familyId: string;
}) {
  return (
    <section className="heritage-tree-section" aria-busy={state.loading}>
      <SectionHeading
        eyebrow="БИДНИЙ ҮНДЭС"
        title="Нэг модны мөчир бүр"
        href={familyLink("/tree", familyId)}
        linkText="Бүтэн мод"
      />
      <SectionState state={state} kind="tree">
        {(tree) =>
          tree.persons.length ? (
            <div className="heritage-tree-overview">
              {(() => {
                const positions =
                  tree.persons.length === 1
                    ? [{ x: 50, y: 50 }]
                    : tree.persons.length === 2
                      ? [
                          { x: 27, y: 50 },
                          { x: 73, y: 50 },
                        ]
                      : tree.persons.length === 3
                        ? [
                            { x: 50, y: 20 },
                            { x: 25, y: 76 },
                            { x: 75, y: 76 },
                          ]
                        : [
                            { x: 25, y: 23 },
                            { x: 75, y: 23 },
                            { x: 25, y: 77 },
                            { x: 75, y: 77 },
                          ];
                const people = tree.persons.slice(0, 4);
                const personIds = new Set(people.map((person) => person.id));
                const connections = [
                  ...tree.parent_child_relationships.map((relation) => ({
                    from: relation.parent_id,
                    to: relation.child_id,
                    kind: "family" as const,
                  })),
                  ...tree.marriages.map((marriage) => ({
                    from: marriage.person_1_id,
                    to: marriage.person_2_id,
                    kind: "partner" as const,
                  })),
                ].filter(
                  (relation) =>
                    personIds.has(relation.from) && personIds.has(relation.to),
                );
                const indexById = new Map(
                  people.map((person, index) => [person.id, index]),
                );
                return (
                  <>
                    <div
                      className="heritage-tree-graph"
                      role="group"
                      aria-label="Бүртгэлтэй удмын холбоос бүхий хүмүүс"
                    >
                      <svg
                        className="heritage-tree-connections"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        {connections.map((connection, index) => {
                          const from = positions[indexById.get(connection.from)!];
                          const to = positions[indexById.get(connection.to)!];
                          return (
                            <line
                              key={`${connection.from}-${connection.to}-${index}`}
                              x1={from.x}
                              y1={from.y}
                              x2={to.x}
                              y2={to.y}
                              className={`heritage-tree-edge heritage-tree-edge--${connection.kind}`}
                            />
                          );
                        })}
                      </svg>
                      <div className="heritage-tree-nodes">
                        {people.map((person, index) => (
                          <Link
                            key={person.id}
                            className="heritage-tree-node"
                            href={personLink(person.id, familyId)}
                            style={{
                              left: `${positions[index].x}%`,
                              top: `${positions[index].y}%`,
                            }}
                          >
                            <TreeDeciduous
                              size={18}
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                            <span>{personName(person)}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                    <p className="heritage-tree-caption">
                      {connections.length
                        ? `${connections.length} бүртгэлтэй холбоос · ${people.length} хүний хураангуй`
                        : `Холбоос хараахан бүртгэгдээгүй · ${people.length} хүний хураангуй`}
                    </p>
                  </>
                );
              })()}
              <small>
                Удмын модны жишээ өгөгдөл. Хураангуйд {tree.persons.length} хүн
                · {tree.parent_child_relationships.length} эцэг эх, хүүхдийн
                холбоо
              </small>
              <Link
                className="heritage-button"
                href={familyLink("/tree", familyId)}
              >
                Удмын холбоог дэлгэрүүлж үзэх{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <EmptyState
              title="Удмын модоо хамтдаа ургуулъя."
              href={familyLink("/people", familyId)}
              action="Гэр бүлийн хүмүүс"
            >
              Гэр бүлийнхээ хүмүүсийг холбоход удмын түүх тань энд үргэлжилнэ.
            </EmptyState>
          )
        }
      </SectionState>
    </section>
  );
}
function PersonPortrait({
  person,
  familyId,
}: {
  person: Person;
  familyId: string;
}) {
  const [failedSource, setFailedSource] = useState("");
  const value = person.profile_photo_url || "";
  const path =
    API_BASE && value.startsWith(API_BASE + "/")
      ? value.slice(API_BASE.length)
      : value;
  const prefix = `/families/${encodeURIComponent(familyId)}/photos/`;
  const validPath =
    path.startsWith(prefix) &&
    /^[^/]+\/content(?:\?variant=(?:thumbnail|original))?$/.test(
      path.slice(prefix.length),
    );
  const src = API_BASE && validPath ? API_BASE + path : "";
  const initials = [person.last_name, person.first_name]
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
  return (
    <div className="heritage-portrait" aria-hidden="true">
      {src && failedSource !== src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(src)}
        />
      ) : (
        <>
          <span>{initials}</span>
          <TreeDeciduous size={24} strokeWidth={1} />
        </>
      )}
    </div>
  );
}

export function FeaturedPerson({
  person,
  familyId,
}: {
  person: Person | undefined;
  familyId: string;
}) {
  if (!person)
    return (
      <EmptyState
        title="Хүн бүрийн түүх үнэ цэнтэй."
        href={familyLink("/people", familyId)}
        action="Хүмүүс рүү очих"
      >
        Гэр бүлийн хүний намтар, дурсамжийг энд онцлон хадгална.
      </EmptyState>
    );
  return (
    <article className="heritage-featured">
      <PersonPortrait key={person.id} person={person} familyId={familyId} />
      <div>
        <p className="heritage-eyebrow">ОНЦЛОХ ХҮН</p>
        <h2>{personName(person)}</h2>
        {person.birth_date && (
          <p className="heritage-person-dates">
            {displayDate(person.birth_date)}
            {!person.is_alive && person.death_date
              ? ` — ${displayDate(person.death_date)}`
              : ""}
          </p>
        )}
        <p>
          {person.short_description ||
            "Амьдралын түүх, гэр бүлийн холбоо, дурсамжтай нь танилцаарай."}
        </p>
        <Link
          className="heritage-text-link"
          href={personLink(person.id, familyId)}
        >
          Профайл үзэх
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
function AlbumPhoto({
  memory,
  photo,
  familyId,
}: {
  memory: MemoryListItem;
  photo: NonNullable<MemoryListItem["photos"]>[number];
  familyId: string;
}) {
  const [failed, setFailed] = useState(false);
  // Resolve only authenticated family content, never an arbitrary external image URL.
  const src = `${API_BASE}/families/${encodeURIComponent(familyId)}/photos/${encodeURIComponent(photo.id)}/content?variant=thumbnail`;
  return (
    <Link
      className="heritage-album-photo"
      href={familyLink(`/memories/${encodeURIComponent(memory.id)}`, familyId)}
    >
      <div className="heritage-photo-frame">
        {!failed && API_BASE ? (
          <img
            src={src}
            alt={photo.title || memory.title}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="heritage-photo-unavailable">
            <ImageIcon aria-hidden="true" />
            <span>Зургийг одоогоор үзүүлэх боломжгүй.</span>
          </span>
        )}
      </div>
      <div className="heritage-photo-caption">
        <strong>{memory.title}</strong>
        {memory.memory_date && (
          <time dateTime={memory.memory_date}>
            {displayDate(memory.memory_date)}
          </time>
        )}
        {memory.person_names?.length ? (
          <span>{memory.person_names.join(" · ")}</span>
        ) : null}
      </div>
    </Link>
  );
}
export function MemoryAlbum({
  page,
  familyId,
}: {
  page: MemoryPage;
  familyId: string;
}) {
  const photos = page.items
    .flatMap((memory) =>
      (memory.photos || []).map((photo) => ({ memory, photo })),
    )
    .slice(0, 3);
  if (!page.items.length)
    return (
      <EmptyState
        title="Одоохондоо дурсамж нэмэгдээгүй байна."
        href={familyLink("/memories", familyId)}
        action="Анхны дурсамжаа хадгалах"
      >
        Хамтдаа өнгөрүүлсэн нэгэн мөчөөс гэр бүлийн цомог эхэлнэ.
      </EmptyState>
    );
  return (
    <>
      {photos.length ? (
        <div className="heritage-album">
          {photos.map(({ memory, photo }) => (
            <AlbumPhoto
              key={photo.id}
              memory={memory}
              photo={photo}
              familyId={familyId}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Дурсамж бий. Зургийн хуудас хараахан нээгдээгүй."
          href={familyLink("/memories", familyId)}
          action="Дурсамжуудаа үзэх"
        >
          Эдгээр дурсамжид харагдах зураг одоогоор алга.
        </EmptyState>
      )}
      <div className="heritage-memory-index">
        {page.items.slice(0, 3).map((memory) => (
          <Link
            key={memory.id}
            href={familyLink(
              `/memories/${encodeURIComponent(memory.id)}`,
              familyId,
            )}
          >
            <span>{memory.title}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </>
  );
}
export function FamilyStory({
  page,
  familyId,
}: {
  page: StoryListPage;
  familyId: string;
}) {
  const story = page.items[0];
  return story ? (
    <article className="heritage-story">
      <BookOpen size={28} strokeWidth={1} aria-hidden="true" />
      {story.event_date && (
        <time dateTime={story.event_date}>{displayDate(story.event_date)}</time>
      )}
      <h3>{story.title}</h3>
      <p>{story.excerpt}</p>
      {story.author_name && <small>Бичсэн: {story.author_name}</small>}
      <Link
        className="heritage-text-link"
        href={familyLink(`/stories/${encodeURIComponent(story.id)}`, familyId)}
      >
        Түүхийг унших
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  ) : (
    <EmptyState
      title="Манай гэр бүлийн түүх эндээс эхэлнэ."
      href={familyLink("/stories", familyId)}
      action="Манай түүх"
    >
      Ахмадын хууч яриа, амьдралын сургамж, нэгэн нандин түүхээ хадгалаарай.
    </EmptyState>
  );
}
export function StoryTimeline({
  page,
  familyId,
}: {
  page: StoryListPage;
  familyId: string;
}) {
  const dated = page.items
    .filter((story) => story.event_date && displayDate(story.event_date))
    .sort((a, b) => a.event_date!.localeCompare(b.event_date!));
  return dated.length ? (
    <ol className="heritage-timeline">
      {dated.map((story) => (
        <li key={story.id}>
          <time dateTime={story.event_date!}>
            {displayDate(story.event_date)}
          </time>
          <Link
            href={familyLink(
              `/stories/${encodeURIComponent(story.id)}`,
              familyId,
            )}
          >
            {story.title}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {story.place && <p>{story.place}</p>}
        </li>
      ))}
    </ol>
  ) : (
    <EmptyState
      title="Он цагтай түүхүүдээ энд холбож хадгална."
      href={familyLink("/stories", familyId)}
      action="Түүхүүдээ үзэх"
    >
      Одоогийн хураангуйд үйл явдлын огноотой түүх алга.
    </EmptyState>
  );
}
export function ArchivePreview({
  page,
  familyId,
}: {
  page: ArchiveListPage;
  familyId: string;
}) {
  return page.items.length ? (
    <ol className="heritage-archive">
      {page.items.map((item) => (
        <li key={item.id}>
          <Link
            href={familyLink(
              `/archives/${encodeURIComponent(item.id)}`,
              familyId,
            )}
          >
            <span className="heritage-document-mark" aria-hidden="true">
              ӨВ
            </span>
            <span>
              <strong>{item.title}</strong>
              {item.document_date && (
                <time dateTime={item.document_date}>
                  {displayDate(item.document_date)}
                </time>
              )}
              {item.description && <p>{item.description}</p>}
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ol>
  ) : (
    <EmptyState
      title="Өвлөж ирсэн баримтаа мартахгүй."
      href={familyLink("/archives", familyId)}
      action="Архив руу очих"
    >
      Хуучин бичиг, баримтын нэр, огноо, эх сурвалжийг нэг дор тэмдэглэн
      үлдээгээрэй.
    </EmptyState>
  );
}
export function QuickActions({ family }: { family: Family }) {
  const canEdit = family.role === "owner" || family.role === "editor";
  return (
    <section className="heritage-actions">
      <SectionHeading
        eyebrow="ӨНӨӨДӨР НЭГ ТҮҮХ НЭМЬЕ"
        title="Та юу хадгалж үлдээх вэ?"
      />
      <div>
        {canEdit && (
          <Link href={familyLink("/tree", family.id)}>
            <Plus aria-hidden="true" size={18} />
            Хүн, холбоо нэмэх
          </Link>
        )}
        <Link href={familyLink("/memories", family.id)}>
          <Plus aria-hidden="true" size={18} />
          Дурсамж нэмэх
        </Link>
        {canEdit && (
          <>
            <Link href={familyLink("/stories/new", family.id)}>
              <Plus aria-hidden="true" size={18} />
              Түүх бичих
            </Link>
            <Link href={familyLink("/archives/new", family.id)}>
              <Plus aria-hidden="true" size={18} />
              Архив нэмэх
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
