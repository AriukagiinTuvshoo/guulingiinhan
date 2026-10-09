export type WorkspacePerson = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  is_alive: boolean;
  // Optional extended fields returned by GET /admin/families/{id}/workspace
  // (WorkspacePerson). Older call sites use only the core fields above.
  gender?: string;
  birth_place?: string | null;
  death_date?: string | null;
  short_description?: string | null;
  visibility?: string;
  updated_at?: string;
};

export type FamilyWorkspacePeople = { people: WorkspacePerson[] };

/** The admin workspace API returns `people`; the shared tree returns `persons`. */
export function readWorkspacePeople(workspace: FamilyWorkspacePeople): WorkspacePerson[] {
  if (!Array.isArray(workspace.people)) {
    throw new Error('Invalid admin family workspace response: people must be an array');
  }
  return workspace.people;
}
