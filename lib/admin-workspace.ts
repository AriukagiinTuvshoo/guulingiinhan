export type WorkspacePerson = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  is_alive: boolean;
};

export type FamilyWorkspacePeople = { people: WorkspacePerson[] };

/** The admin workspace API returns `people`; the shared tree returns `persons`. */
export function readWorkspacePeople(workspace: FamilyWorkspacePeople): WorkspacePerson[] {
  if (!Array.isArray(workspace.people)) {
    throw new Error('Invalid admin family workspace response: people must be an array');
  }
  return workspace.people;
}

