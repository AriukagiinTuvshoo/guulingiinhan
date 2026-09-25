'use client';

import { useSearchParams } from 'next/navigation';
import StoryEditor from '../../../components/story-editor';

export default function NewStoryPage() {
  const params = useSearchParams();
  return <StoryEditor mode="create" familyId={params.get('family') ?? ''} />;
}
