const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
const developmentApiBase = 'http://localhost:8000/api/v1';

export const API_BASE = configuredApiBase || (process.env.NODE_ENV === 'development' ? developmentApiBase : '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    public requestId: string | null = null,
    public validationMessage: string | null = null,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, 'API тохиргоо олдсонгүй. Дахин оролдоно уу.', 'API_CONFIGURATION_MISSING');
  }
  let response: Response;
  const isRawBody = init.body instanceof FormData || init.body instanceof Blob;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body && !isRawBody ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Холболтод асуудал гарлаа. Дахин оролдоно уу.');
  }
  if (!response.ok) {
    let message = 'Серверийн алдаа гарлаа. Дахин оролдоно уу.';
    let code: string | null = null;
    let validationMessage: string | null = null;
    let requestId = response.headers.get('X-Request-ID');
    try {
      const parsed: unknown = await response.json();
      const payload = parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : {};
      code = typeof payload.error_code === 'string' ? payload.error_code : null;
      requestId = typeof payload.request_id === 'string' ? payload.request_id : requestId;
      if ((response.status === 422 || response.status === 409) && typeof payload.detail === 'string' && payload.detail.length <= 300) {
        validationMessage = payload.detail;
      }
      message =
        response.status === 401 ? 'Нэвтрэх шаардлагатай.' :
        response.status === 403 ? 'Энэ мэдээлэлд хандах эрхгүй.' :
        response.status === 404 ? 'Мэдээлэл олдсонгүй.' :
        response.status === 409 ? 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.' :
        response.status === 422 ? 'Оруулсан мэдээллээ шалгана уу.' :
        response.status === 429 ? 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.' :
        response.status >= 500 ? 'Серверийн алдаа гарлаа. Дахин оролдоно уу.' :
        typeof payload.detail === 'string' ? payload.detail : message;
    } catch {
      // Keep the friendly fallback message when the server sends no JSON.
    }
    throw new ApiError(response.status, message, code, requestId, validationMessage);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type User = { id: string; email: string | null; display_name: string; person_id: string | null; profile_photo_url?: string | null };
export type Family = { id: string; name: string; description: string | null; role: string };
export type Person = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  nickname: string | null;
  gender: string;
  birth_date: string | null;
  birth_place: string | null;
  is_alive: boolean;
  death_date: string | null;
  death_place: string | null;
  profile_photo_url?: string | null;
  short_description: string | null;
  visibility: string;
};
export type TreeData = {
  persons: TreePerson[];
  parent_child_relationships: { id: string; parent_id: string; child_id: string; relationship_type: string }[];
  marriages: Marriage[];
  root_person_id?: string | null;
  lineage_root_person_id?: string | null;
  linked_person_id?: string | null;
  meta?: { depth: number; node_count: number; node_limit: number; truncated: boolean };
};
export type TreePerson = Pick<Person, 'id' | 'first_name' | 'last_name' | 'middle_name' | 'birth_date' | 'is_alive' | 'death_date' | 'profile_photo_url'> & {
  lineage_id?: string | null;
  lineage_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
};
export type Marriage = { id: string; person_1_id: string; person_2_id: string; status: 'married' | 'divorced' | 'widowed'; start_date: string | null; end_date: string | null; location?: string | null; description?: string | null; created_at?: string; other_person?: Person };
export type ProfileRelationPerson = Pick<
  Person,
  'id' | 'first_name' | 'last_name' | 'middle_name' | 'nickname' | 'gender' | 'birth_date' | 'is_alive' | 'death_date' | 'profile_photo_url'
>;
export type PersonProfile = Person & {
  can_edit_profile: boolean;
  lineage_id: string | null;
  lineage_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  parents: ProfileRelationPerson[];
  children: ProfileRelationPerson[];
  spouses: ProfileRelationPerson[];
};

export type PersonSearchPage = { items: { id: string; name: string; birth_year: number | null; family_name?: string | null; branch_name?: string | null }[]; page: number; page_size: number; total: number; has_next: boolean };
export type PersonDirectoryItem = Person & {
  lineage_id: string | null;
  lineage_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
};
export type PersonDirectoryPage = {
  items: PersonDirectoryItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};
export type LineageSummary = {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
};
export type BranchSummary = {
  id: string;
  lineage_id: string;
  name: string;
  description: string | null;
};

export type ArchivePerson = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
};

export type ArchiveListItem = {
  id: string;
  title: string;
  description: string | null;
  document_date: string | null;
  place: string | null;
  visibility: string;
  author_id: string;
  author_name: string;
  related_people_count: number;
  created_at: string;
  updated_at: string;
};

export type ArchiveListPage = {
  items: ArchiveListItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};

export type Archive = ArchiveListItem & {
  related_people: ArchivePerson[];
};

export type ArchiveInput = {
  title: string;
  description: string | null;
  document_date: string | null;
  place: string | null;
  visibility: 'private' | 'family' | 'public';
  person_ids: string[];
};

export type MemoryPhoto = {
  id: string;
  title: string | null;
  description?: string | null;
  photo_date?: string | null;
  created_at?: string;
  thumbnail_url: string;
  content_url: string;
  person_ids?: string[];
  person_names?: string[];
};

export type MemoryPhotoPage = {
  items: MemoryPhoto[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};

export type MemoryListItem = {
  id: string;
  title: string;
  description: string | null;
  memory_date: string | null;
  visibility: string;
  person_ids: string[];
  person_names?: string[];
  liked?: boolean;
  like_count?: number;
  comment_count?: number;
  author_name?: string;
  created_at: string;
  photos?: MemoryPhoto[];
  photos_page?: number;
  photos_page_size?: number;
  photos_total?: number;
  photos_has_next?: boolean;
};

export type MemoryListPage = { items: MemoryListItem[]; page: number; page_size: number; total: number; has_next: boolean };
export type RelationshipResult = {
  status: 'same' | 'found' | 'not_found' | 'limited'; truncated: boolean; paths_limited: boolean;
  paths: { people: { id: string; name: string }[]; steps: { kind: 'parent' | 'child' | 'spouse'; relationship_type?: string; status?: string }[]; distance: number; generation_distance: number }[];
  common_ancestors: { id: string; name: string; first_distance: number; second_distance: number }[];
};
export type TimelinePage = { items: { id: string; kind: string; date: string | null; title: string; href: string | null }[]; page: number; has_next: boolean; total: number; truncated: boolean };

export type StoryPerson = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
};

export type StoryListItem = {
  id: string;
  title: string;
  excerpt: string;
  event_date: string | null;
  place: string | null;
  visibility: string;
  author_id: string;
  author_name: string;
  related_people_count: number;
  created_at: string;
  updated_at: string;
};

export type StoryListPage = {
  items: StoryListItem[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
};

export type Story = StoryListItem & {
  body: string;
  related_people: StoryPerson[];
};

export const personName = (person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) =>
  [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ');
