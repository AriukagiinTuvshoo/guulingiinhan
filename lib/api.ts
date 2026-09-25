export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new ApiError(0, 'Сервертэй холбогдож чадсангүй. API хаягаа шалгана уу.');
  }
  if (!response.ok) {
    let message = 'Серверийн алдаа гарлаа. Дахин оролдоно уу.';
    try {
      const payload = await response.json();
      message =
        response.status === 401 ? 'Нэвтрэх шаардлагатай.' :
        response.status === 403 ? 'Энэ мэдээлэлд хандах эрхгүй.' :
        response.status === 404 ? 'Мэдээлэл олдсонгүй.' :
        response.status === 409 ? 'Энэ мэдээлэл аль хэдийн бүртгэгдсэн байна.' :
        response.status === 422 ? 'Оруулсан мэдээллээ шалгана уу.' :
        response.status === 429 ? 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.' :
        payload.detail ?? message;
    } catch {
      // Keep the friendly fallback message when the server sends no JSON.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type User = { id: string; email: string; display_name: string; person_id: string | null };
export type Family = { id: string; name: string; description: string | null; role: string };
export type Person = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  gender: string;
  birth_date: string | null;
  birth_place: string | null;
  is_alive: boolean;
  death_date: string | null;
  death_place: string | null;
  short_description: string | null;
  visibility: string;
};
export type TreeData = {
  persons: TreePerson[];
  parent_child_relationships: { id: string; parent_id: string; child_id: string; relationship_type: string }[];
  marriages: Marriage[];
  root_person_id?: string | null;
  meta?: { depth: number; node_count: number; node_limit: number; truncated: boolean };
};
export type TreePerson = Pick<Person, 'id' | 'first_name' | 'last_name' | 'middle_name' | 'birth_date' | 'is_alive' | 'death_date'> & {
  lineage_id?: string | null;
  lineage_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
};
export type Marriage = { id: string; person_1_id: string; person_2_id: string; status: 'married' | 'divorced' | 'widowed'; start_date: string | null; end_date: string | null; location?: string | null; description?: string | null; created_at?: string; other_person?: Person };
export type PersonSearchPage = { items: { id: string; name: string; birth_year: number | null }[]; page: number; page_size: number; total: number; has_next: boolean };

export const personName = (person: Pick<Person, 'first_name' | 'last_name' | 'middle_name'>) =>
  [person.last_name, person.first_name, person.middle_name].filter(Boolean).join(' ');
