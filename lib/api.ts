const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
const developmentApiBase = 'http://localhost:8000/api/v1';

function resolveApiBase(): string {
  const base = configuredApiBase || (process.env.NODE_ENV === 'development' ? developmentApiBase : '');
  if (!base) return '';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    try {
      const parsed = new URL(base);
      if (parsed.protocol === 'https:' && parsed.origin !== window.location.origin) {
        return '/api/v1';
      }
    } catch {
      // Keep configured base if not parseable.
    }
  }
  return base;
}

export const API_BASE = resolveApiBase();

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

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

function isTransientGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function waitWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (csrfTokenRequest) return csrfTokenRequest;
  const pendingRequest = (async (): Promise<string> => {
    const maxAttempts = 10;
    let lastStatus = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' });
      } catch {
        if (attempt + 1 < maxAttempts) {
          await waitWithSignal(4500);
          continue;
        }
        throw new ApiError(0, 'Аюулгүй хүсэлтийн token авах үед холболт тасарлаа.', 'CSRF_TOKEN_UNAVAILABLE');
      }
      if (!response.ok) {
        lastStatus = response.status;
        if (isTransientGatewayStatus(response.status) && attempt + 1 < maxAttempts) {
          await waitWithSignal(5000);
          continue;
        }
        throw new ApiError(
          response.status,
          isTransientGatewayStatus(response.status)
            ? 'Сервер дөнгөж асаж байна. Түр хүлээгээд дахин оролдоно уу.'
            : 'Аюулгүй хүсэлтийн token авах боломжгүй байна.',
          isTransientGatewayStatus(response.status) ? 'BACKEND_WAKING' : 'CSRF_TOKEN_UNAVAILABLE',
        );
      }
      const token = response.headers.get('X-CSRF-Token');
      if (!token) {
        throw new ApiError(0, 'Аюулгүй хүсэлтийн token буруу байна.', 'CSRF_TOKEN_INVALID');
      }
      csrfToken = token;
      return token;
    }
    throw new ApiError(lastStatus || 503, 'Сервер дөнгөж асаж байна. Түр хүлээгээд дахин оролдоно уу.', 'BACKEND_WAKING');
  })();
  const request = pendingRequest.finally(() => {
    csrfTokenRequest = null;
  });
  csrfTokenRequest = request;
  return request;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, 'API тохиргоо олдсонгүй. Дахин оролдоно уу.', 'API_CONFIGURATION_MISSING');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const isUnsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const canRetryColdStart =
    method === 'GET' ||
    method === 'HEAD' ||
    path === '/auth/login' ||
    path === '/auth/csrf';
  const isRawBody = init.body instanceof FormData || init.body instanceof Blob;
  const headers = new Headers(init.headers);
  if (init.body && !isRawBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let csrfRetried = false;
  let coldStartRetries = 0;
  const maxColdStartRetries = canRetryColdStart ? 8 : 0;
  while (true) {
    if (isUnsafe) headers.set('X-CSRF-Token', await getCsrfToken());

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers,
      });
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      if (coldStartRetries < maxColdStartRetries) {
        coldStartRetries += 1;
        await waitWithSignal(4500, init.signal);
        continue;
      }
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
        if (
          (
            response.status === 422 ||
            response.status === 409 ||
            (response.status === 403 && code !== 'CSRF_TOKEN_INVALID' && code !== 'CSRF_TOKEN_REQUIRED')
          ) &&
          typeof payload.detail === 'string' &&
          payload.detail.length <= 300
        ) {
          validationMessage = payload.detail;
        }
        message =
          response.status === 401 ? 'Нэвтрэх шаардлагатай.' :
          response.status === 403 ? 'Энэ мэдээлэлд хандах эрхгүй.' :
          response.status === 404 ? 'Мэдээлэл олдсонгүй.' :
          response.status === 409 ? 'Энэ үйлдлийг одоогоор гүйцэтгэх боломжгүй байна.' :
          response.status === 422 ? 'Оруулсан мэдээллээ шалгана уу.' :
          response.status === 429 ? 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.' :
          code === 'BACKEND_WAKING' ? 'Сервер дөнгөж асаж байна. Түр хүлээгээд дахин оролдоно уу.' :
          response.status >= 500 ? 'Серверийн алдаа гарлаа. Дахин оролдоно уу.' :
          typeof payload.detail === 'string' ? payload.detail : message;
      } catch {
        // Keep the friendly fallback message when the server sends no JSON.
      }
      if (
        (isTransientGatewayStatus(response.status) || code === 'BACKEND_WAKING' || code === 'UPSTREAM_UNAVAILABLE') &&
        coldStartRetries < maxColdStartRetries
      ) {
        coldStartRetries += 1;
        await waitWithSignal(5000, init.signal);
        continue;
      }
      if (code === 'CSRF_TOKEN_INVALID' || code === 'CSRF_TOKEN_REQUIRED') {
        csrfToken = null;
        if (!csrfRetried && isUnsafe && response.status === 403) {
          csrfRetried = true;
          continue;
        }
      }
      throw new ApiError(response.status, message, code, requestId, validationMessage);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}

export type User = { id: string; email: string | null; display_name: string; person_id: string | null; profile_photo_url?: string | null };
export type Family = { id: string; name: string; description: string | null; role: string; created_at: string };
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
  can_edit?: boolean;
  can_delete?: boolean;
  created_at: string;
  updated_at: string;
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
  gender?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
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

export type FamilyStats = {
  total_persons: number;
  male_count: number;
  female_count: number;
  living_count: number;
  deceased_count: number;
  marriage_count: number;
  parent_child_count: number;
  generation_depth: number;
  total_stories: number;
  total_archives: number;
  total_memories: number;
  member_count: number;
};

export type Story = StoryListItem & {
  body: string;
  related_people: StoryPerson[];
};

export type ChatMessage = {
  id: string;
  family_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  recipient_id: string | null;
  content: string;
  created_at: string;
};

export type ChatMember = {
  user_id: string;
  display_name: string;
  role: string;
  person_id?: string | null;
  person_name?: string | null;
};

export type SmartConnectOut = {
  created_parent_child_edges: number;
  created_marriages: number;
  created_shared_parent_id?: string | null;
  summary: string;
};

export type LifeEvent = {
  id: string;
  person_id: string;
  event_type:
    | 'birth'
    | 'school'
    | 'work'
    | 'marriage'
    | 'divorce'
    | 'child_birth'
    | 'award'
    | 'move'
    | 'death'
    | 'other'
    | string;
  title: string;
  event_date: string | null;
  date_note: string | null;
  location: string | null;
  description: string | null;
  created_by?: string;
};

export type ExtractedEventDraft = {
  event_type: string;
  title: string;
  event_date: string | null;
  date_note: string | null;
  location: string | null;
  description: string | null;
};

export type OralHistoryExtractOut = {
  suggested_biography: string;
  extracted_events: ExtractedEventDraft[];
  created_events_count: number;
  biography_updated: boolean;
};

export const personName = (person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) =>
  [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ');
