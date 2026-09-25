'use client';

import { useParams, useSearchParams } from 'next/navigation';
import StoryEditor from '../../../../components/story-editor';

export default function EditStoryPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  return <StoryEditor mode="edit" familyId={search.get('family') ?? ''} storyId={params.id} />;
}
