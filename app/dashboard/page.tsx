"use client";
import { Suspense } from "react";
import Link from "next/link";
import {
  API_BASE,
  personName,
  type Family,
  type Person,
  type StoryListPage,
  type ArchiveListPage,
} from "../../lib/api";
import { useFamilyContext } from "../../components/family-context";
import { useDashboardSection } from "../../components/dashboard/use-dashboard-section";
import {
  ArchivePreview,
  DashboardHero,
  DashboardSkeleton,
  EmptyState,
  FamilyStory,
  FeaturedPerson,
  MemoryAlbum,
  QuickActions,
  SectionHeading,
  SectionState,
  StoryTimeline,
  familyLink,
  type MemoryPage,
} from "../../components/dashboard/heritage-sections";

function memberInitials(person: Person) {
  return (
    [person.last_name, person.first_name]
      .filter(Boolean)
      .map((part) => part.slice(0, 1))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function memberYears(person: Person) {
  const birth = person.birth_date?.slice(0, 4);
  const death = !person.is_alive ? person.death_date?.slice(0, 4) : null;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.is_alive ? `${birth} – одоо` : `${birth} – ?`;
  return person.is_alive ? "Энх тунх" : "Дурсгалд";
}

function FamilyMembersGallery({
  people,
  familyId,
}: {
  people: Person[];
  familyId: string;
}) {
  return (
    <section
      className="heritage-gallery-section"
      aria-label="Гэр бүлийн бүх гишүүд"
    >
      <SectionHeading
        eyebrow="МАНАЙ УДАМ · БҮХ ГИШҮҮД"
        title={`Ургийн хөрөг цомог (${people.length})`}
        href={familyLink("/tree", familyId)}
        linkText="✨ Алтан Мод нээх"
      />
      {people.length === 0 ? (
        <EmptyState
          title="Одоохондоо гэр бүлийн хүн бүртгэгдээгүй байна."
          href={familyLink("/tree", familyId)}
          action="Ургийн модонд хүн нэмэх"
        >
          Гэр бүлийн гишүүдээ нэмснээр бүх хөрөг болон удмын хэлхээ энд харагдана.
        </EmptyState>
      ) : (
        <div className="luxury-arched-grid">
          {people.map((person) => (
            <Link
              key={person.id}
              href={`/profile?family=${encodeURIComponent(familyId)}&person=${encodeURIComponent(person.id)}`}
              className="luxury-arched-card"
            >
              <div className="luxury-arched-frame">
                {person.profile_photo_url ? (
                  <img
                    src={
                      person.profile_photo_url.startsWith("/")
                        ? `${API_BASE}${person.profile_photo_url}`
                        : person.profile_photo_url
                    }
                    alt={personName(person)}
                    loading="lazy"
                  />
                ) : (
                  <span className="luxury-arched-monogram" aria-hidden="true">
                    {memberInitials(person)}
                  </span>
                )}
              </div>
              <div className="luxury-arched-meta">
                <strong>{personName(person) || "Нэргүй хүн"}</strong>
                <span>{memberYears(person)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function FamilyDashboard({ family, name }: { family: Family; name?: string }) {
  const base = `/families/${encodeURIComponent(family.id)}`;
  const people = useDashboardSection<Person[]>(
    `${base}/persons`,
  );
  const featured = useDashboardSection<Person | null>(`${base}/featured-person`);
  const stories = useDashboardSection<StoryListPage>(
    `${base}/stories?page=1&page_size=4`,
  );
  const memories = useDashboardSection<MemoryPage>(
    `${base}/memories?page=1&page_size=6`,
  );
  const archives = useDashboardSection<ArchiveListPage>(
    `${base}/archives?page=1&page_size=3`,
  );
  const metrics = [
    { label: "Гэр бүлийн хүн", value: people.data?.length, href: "/tree" },
    { label: "Хадгалсан түүх", value: stories.data?.total, href: "/stories" },
    { label: "Нандин дурсамж", value: memories.data?.total, href: "/memories" },
    { label: "Архивын баримт", value: archives.data?.total, href: "/archives" },
  ];
  return (
    <main className="heritage-dashboard" id="family-dashboard">
      <DashboardHero family={family} name={name} />
      <section
        className="heritage-stats luxury-kpi-grid"
        aria-label="Танд харагдах гэр бүлийн мэдээллийн тоо"
      >
        {metrics
          .filter((metric) => metric.value !== undefined)
          .map((metric) => (
            <Link key={metric.href} href={familyLink(metric.href, family.id)} className="luxury-kpi-card">
              <span className="luxury-kpi-ring" aria-hidden="true">
                <svg viewBox="0 0 44 44" width="44" height="44">
                  <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(196,150,53,0.18)" strokeWidth="3" />
                  <circle cx="22" cy="22" r="18" fill="none" stroke="#c49635" strokeWidth="3" strokeDasharray="82 114" strokeLinecap="round" transform="rotate(-90 22 22)" />
                </svg>
              </span>
              <span className="luxury-kpi-text">
                <strong>{metric.value!.toLocaleString("mn-MN")}</strong>
                <span>{metric.label}</span>
              </span>
            </Link>
          ))}
      </section>
      <div className="heritage-editorial-grid">
        <SectionState state={people}>
          {(rows) => <FamilyMembersGallery people={rows} familyId={family.id} />}
        </SectionState>
        <section className="heritage-story-section" aria-busy={stories.loading}>
          <SectionHeading
            eyebrow="МАНАЙ ТҮҮХ"
            title="Яриагаар үлдсэн өв"
            href={familyLink("/stories", family.id)}
          />
          <SectionState state={stories}>
            {(data) => <><FamilyStory page={data} familyId={family.id} /><StoryTimeline page={data} familyId={family.id} /></>}
          </SectionState>
        </section>
        <section
          className="heritage-person-section"
          aria-label="Онцлох хүн"
          aria-busy={featured.loading}
        >
          {!featured.loading && !featured.error && !featured.data ? <FeaturedPerson person={undefined} familyId={family.id} /> : <SectionState state={featured}>
            {(data) => (
              <FeaturedPerson
                person={data ?? undefined}
                familyId={family.id}
              />
            )}
          </SectionState>}
        </section>
      </div>
      <section className="heritage-album-section" aria-busy={memories.loading}>
        <SectionHeading
          eyebrow="МАНАЙ ЦОМОГ"
          title="Дахин дурсах мөчүүд"
          href={familyLink("/memories", family.id)}
          linkText="Цомог нээх"
        />
        <SectionState state={memories} kind="album">
          {(data) => <MemoryAlbum page={data} familyId={family.id} />}
        </SectionState>
      </section>
      <section
        className="heritage-archive-section"
        aria-busy={archives.loading}
      >
        <SectionHeading
          eyebrow="МАНАЙ АРХИВ"
          title="Үлдээсэн бүхэн үнэ цэнтэй"
          href={familyLink("/archives", family.id)}
          linkText="Архив нээх"
        />
        <SectionState state={archives}>
          {(data) => <ArchivePreview page={data} familyId={family.id} />}
        </SectionState>
      </section>
      <QuickActions family={family} />
      <footer className="heritage-footer">
        <span>{family.name}</span>
        <p>Өнөөдрийн дурсамж — маргаашийн өв.</p>
      </footer>
    </main>
  );
}
function DashboardContent() {
  const { family, user, loading, error, retry } = useFamilyContext();
  if (loading) return <DashboardSkeleton />;
  if (error)
    return (
      <main className="heritage-dashboard">
        <div className="heritage-error" role="alert">
          <h1>Гэр бүлийн орчныг нээж чадсангүй.</h1>
          <p>{error}</p>
          <button onClick={retry}>Дахин оролдох</button>
          <Link href="/families">Гэр бүлүүдээ харах</Link>
        </div>
      </main>
    );
  if (!user || !family)
    return (
      <main className="heritage-dashboard">
        <EmptyState
          title="Гэр бүлийнхээ түүхийг эндээс эхлүүлье."
          href="/families"
          action="Гэр бүлээ сонгох"
          headingLevel="h1"
        >
          Таны гэр бүлийн хүмүүс, түүх, дурсамж нэг дор цугларна.
        </EmptyState>
      </main>
    );
  return (
    <FamilyDashboard key={family.id} family={family} name={user.display_name} />
  );
}
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
