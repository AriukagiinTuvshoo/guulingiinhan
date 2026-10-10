"use client";
import { Suspense } from "react";
import Link from "next/link";
import type {
  Family,
  Person,
  StoryListPage,
  ArchiveListPage,
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
  TreeOverview,
  familyLink,
  type MemoryPage,
  type SharedLineagePreview,
} from "../../components/dashboard/heritage-sections";

function FamilyDashboard({ family, name }: { family: Family; name?: string }) {
  const base = `/families/${encodeURIComponent(family.id)}`;
  const people = useDashboardSection<Person[]>(
    `${base}/persons`,
  );
  const featured = useDashboardSection<Person | null>(`${base}/featured-person`);
  const tree = useDashboardSection<SharedLineagePreview>("/shared-lineage");
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
        className="heritage-stats"
        aria-label="Танд харагдах гэр бүлийн мэдээллийн тоо"
      >
        {metrics
          .filter((metric) => metric.value !== undefined)
          .map((metric) => (
            <Link key={metric.href} href={familyLink(metric.href, family.id)}>
              <strong>{metric.value!.toLocaleString("mn-MN")}</strong>
              <span>{metric.label}</span>
            </Link>
          ))}
      </section>
      <div className="heritage-editorial-grid">
        <TreeOverview state={tree} familyId={family.id} />
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
