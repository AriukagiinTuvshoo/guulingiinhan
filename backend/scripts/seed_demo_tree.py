"""Seed a DISPOSABLE local SQLite database with a clearly synthetic 9-generation family tree.

NEVER run this script against production, staging, or any real family database.
It refuses to run unless:
  1. ``APP_ENV`` is ``development`` or ``test``.
  2. ``DATABASE_URL`` points to an existing, non-symlink local SQLite file inside
     the OS temporary directory (``/tmp`` or ``tempfile.gettempdir()``) whose
     filename matches ``guulingiinhan-demo-<name>.sqlite``.
  3. The database has already been migrated (``alembic upgrade head``) and does
     not yet contain the synthetic demo fixtures.

What gets seeded (deterministic, ~150 clearly synthetic people, zero real PII):
  - 1 synthetic owner account (``demo-tree-owner@example.com``) + verified email identity
  - 1 synthetic family (``ТУРШИЛТ — Алтан Овог (Synthetic Demo)``)
  - 1 lineage (``Туршилтын Алтан Удам``) with 4 branches (founded by the 4 Gen-2 children)
  - Founding couple (Generation 1) -> 4 children as 4 branches (Generation 2) -> 9 generations
  - Married/widowed couples across generations, exactly 1 remarriage (divorced + remarried with
    children from both marriages), exactly 1 single parent (children with no marriage record),
    multiple daughters with their own families, and deliberate namesakes across generations/branches
  - ``PersonLineageAssignment`` for every person, plus normalized ``search_*_name`` fields

How to run (Linux / macOS bash):
  cd backend
  DB_PATH="/tmp/guulingiinhan-demo-local.sqlite"
  rm -f "$DB_PATH"
  touch "$DB_PATH"
  APP_ENV=development DATABASE_URL="sqlite:///$DB_PATH" alembic upgrade head
  APP_ENV=development DATABASE_URL="sqlite:///$DB_PATH" python scripts/seed_demo_tree.py
  # Optional: start backend against the disposable DB
  APP_ENV=development DATABASE_URL="sqlite:///$DB_PATH" uvicorn app.main:app --reload

How to run (Windows PowerShell):
  cd backend
  $dbPath = Join-Path $env:TEMP "guulingiinhan-demo-local.sqlite"
  Remove-Item -Force -ErrorAction SilentlyContinue $dbPath
  New-Item -ItemType File -Path $dbPath | Out-Null
  $env:APP_ENV = "development"
  $env:DATABASE_URL = "sqlite:///$($dbPath -replace '\\', '/')"
  .venv\\Scripts\\python.exe -m alembic upgrade head
  .venv\\Scripts\\python.exe scripts/seed_demo_tree.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict, deque
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import unquote
from uuid import UUID

DEMO_OWNER_EMAIL = "demo-tree-owner@example.com"
DEMO_OWNER_PASSWORD = "demo-tree-password-123"
DEMO_FAMILY_NAME = "ТУРШИЛТ — Алтан Овог (Synthetic Demo)"
DEMO_LINEAGE_NAME = "Туршилтын Алтан Удам"
DISPOSABLE_FILENAME_RE = re.compile(r"^guulingiinhan-demo-[a-zA-Z0-9_-]+\.sqlite$")


def _resolve_disposable_sqlite_path(url: str) -> Path:
    """Validate that DATABASE_URL is a disposable local SQLite file in temp storage."""
    app_env = os.environ.get("APP_ENV", "")
    if app_env not in ("development", "test"):
        raise SystemExit(
            "Refusing non-disposable environment: set APP_ENV=development or APP_ENV=test"
        )
    if not url.startswith("sqlite:///"):
        raise SystemExit(
            "Refusing non-disposable database: DATABASE_URL must be a local sqlite:/// URL"
        )

    raw_path = unquote(url.removeprefix("sqlite:///"))
    if not raw_path or raw_path == ":memory:":
        raise SystemExit(
            "Refusing in-memory or empty SQLite URL: point DATABASE_URL to a migrated temp file"
        )

    candidate = Path(raw_path)
    if not DISPOSABLE_FILENAME_RE.fullmatch(candidate.name):
        raise SystemExit(
            "Refusing non-disposable database filename: must match "
            "'guulingiinhan-demo-<name>.sqlite'"
        )
    if candidate.is_symlink():
        raise SystemExit("Refusing symlink database path")
    if not candidate.is_file():
        raise SystemExit(
            f"Database file not found ({candidate}). Create and migrate a fresh disposable "
            "SQLite file with 'alembic upgrade head' first."
        )

    resolved = candidate.resolve()
    allowed_roots = [Path(tempfile.gettempdir()).resolve()]
    posix_tmp = Path("/tmp")
    if posix_tmp.exists():
        allowed_roots.append(posix_tmp.resolve())

    if not any(_is_within(resolved, root) for root in allowed_roots):
        raise SystemExit(
            "Refusing database outside OS temp directory: place the disposable SQLite file "
            f"inside {allowed_roots[0]}"
        )
    return resolved


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


# Enforce disposable-DB guard BEFORE importing app.db / opening any engine.
_DISPOSABLE_DB_PATH = _resolve_disposable_sqlite_path(os.environ.get("DATABASE_URL", ""))

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app.auth import _password_hash  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Branch,
    Family,
    FamilyMember,
    FamilyPerson,
    Lineage,
    LoginIdentity,
    Marriage,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
    User,
)
from app.person_search import normalize_search_name  # noqa: E402
from app.relationships import canonical_pair  # noqa: E402

# Synthetic Mongolian given names and family surnames (no real individuals).
MALE_NAMES = [
    "Бат-Эрдэнэ",
    "Тэмүүлэн",
    "Гантулга",
    "Мөнхбат",
    "Эрдэнэбат",
    "Даваасүрэн",
    "Сүхбаатар",
    "Цогтбаяр",
    "Баярсайхан",
    "Очирбат",
    "Амарсайхан",
    "Билгүүн",
    "Хүслэн",
    "Энхбаяр",
    "Төгөлдөр",
    "Чингүүн",
    "Наранбаатар",
    "Жаргалсайхан",
    "Пүрэвсүрэн",
    "Алтанхуяг",
    "Золбаяр",
    "Түвшинбаяр",
    "Сэргэлэн",
    "Өсөхбаяр",
]

FEMALE_NAMES = [
    "Сарантуяа",
    "Энхжин",
    "Болормаа",
    "Оюунбилэг",
    "Алтантуяа",
    "Мөнхцэцэг",
    "Цэрэндулам",
    "Анужин",
    "Мишээл",
    "Номин-Эрдэнэ",
    "Халиун",
    "Солонго",
    "Уянга",
    "Дэлгэрмаа",
    "Эрдэнэцэцэг",
    "Гэрэлмаа",
    "Бадамцэцэг",
    "Цэндсүрэн",
    "Сувд-Эрдэнэ",
    "Нандинцэцэг",
    "Хулан",
    "Ариунзаяа",
    "Тунгалаг",
    "Өнөрцэцэг",
]

SPOUSE_SURNAMES = [
    "Төмөр",
    "Пүрэв",
    "Даваа",
    "Цэрэн",
    "Баяр",
    "Ган",
    "Сүрэн",
    "Очир",
    "Дорж",
    "Наран",
    "Мөнх",
    "Эрдэнэ",
]

BIRTH_PLACES = [
    "Архангай (Туршилт)",
    "Өвөрхангай (Туршилт)",
    "Төв аймаг (Туршилт)",
    "Булган (Туршилт)",
    "Хөвсгөл (Туршилт)",
    "Улаанбаатар (Туршилт)",
]

# Generation base years (Gen 1 .. Gen 9, ~25-year spacing).
GEN_BASE_YEAR = {
    1: 1812,
    2: 1837,
    3: 1862,
    4: 1887,
    5: 1912,
    6: 1937,
    7: 1962,
    8: 1988,
    9: 2013,
}


class _SyntheticTreeBuilder:
    def __init__(self, db, owner_id: UUID, family_id: UUID, lineage_id: UUID | None) -> None:
        self.db = db
        self.owner_id = owner_id
        self.family_id = family_id
        self.lineage_id = lineage_id

        self._male_idx = 0
        self._female_idx = 0
        self._surname_idx = 0
        self._place_idx = 0

        self.persons: list[Person] = []
        self.person_gen: dict[UUID, int] = {}
        self.person_branch: dict[UUID, UUID | None] = {}
        self.parent_edges: list[tuple[UUID, UUID]] = []
        self.marriages: list[Marriage] = []
        self.daughters_with_families: list[UUID] = []
        self.remarried_person_id: UUID | None = None
        self.single_parent_id: UUID | None = None

    def _next_given_name(self, gender: str) -> str:
        if gender == "male":
            name = MALE_NAMES[self._male_idx % len(MALE_NAMES)]
            self._male_idx += 1
            return name
        name = FEMALE_NAMES[self._female_idx % len(FEMALE_NAMES)]
        self._female_idx += 1
        return name

    def _next_spouse_surname(self) -> str:
        surname = SPOUSE_SURNAMES[self._surname_idx % len(SPOUSE_SURNAMES)]
        self._surname_idx += 1
        return surname

    def _next_place(self) -> str:
        place = BIRTH_PLACES[self._place_idx % len(BIRTH_PLACES)]
        self._place_idx += 1
        return place

    def add_person(
        self,
        *,
        first_name: str,
        last_name: str,
        gender: str,
        generation: int,
        branch_id: UUID | None,
        year_offset: int = 0,
        note: str | None = None,
    ) -> Person:
        birth_year = GEN_BASE_YEAR[generation] + year_offset
        month = ((len(self.persons) * 5) % 12) + 1
        day = ((len(self.persons) * 7) % 27) + 1
        birth_dt = date(birth_year, month, day)

        is_alive = generation >= 6
        death_dt: date | None = None
        if not is_alive:
            lifespan = 66 + (len(self.persons) % 16)
            death_year = min(2020, birth_year + lifespan)
            death_dt = date(death_year, ((month + 3) % 12) + 1, day)

        person = Person(
            first_name=first_name,
            last_name=last_name,
            gender=gender,
            birth_date=birth_dt,
            birth_place=self._next_place(),
            is_alive=is_alive,
            death_date=death_dt,
            death_place=self._next_place() if not is_alive else None,
            short_description=note or f"Хиймэл туршилтын гишүүн · {generation}-р үе",
            visibility="family",
            search_first_name=normalize_search_name(first_name),
            search_last_name=normalize_search_name(last_name),
            search_middle_name="",
            created_by=self.owner_id,
        )
        self.db.add(person)
        self.db.flush()

        self.db.add(
            FamilyPerson(
                family_id=self.family_id,
                person_id=person.id,
                added_by=self.owner_id,
            )
        )
        if self.lineage_id is not None:
            self.db.add(
                PersonLineageAssignment(
                    person_id=person.id,
                    lineage_id=self.lineage_id,
                    branch_id=branch_id,
                )
            )

        self.persons.append(person)
        self.person_gen[person.id] = generation
        self.person_branch[person.id] = branch_id
        return person

    def add_marriage(
        self,
        a: Person,
        b: Person,
        *,
        status: str,
        start_year: int,
        end_year: int | None = None,
        description: str | None = None,
    ) -> Marriage:
        p1, p2 = canonical_pair(a.id, b.id)
        marriage = Marriage(
            person_1_id=p1,
            person_2_id=p2,
            status=status,
            start_date=date(start_year, 6, 15),
            end_date=date(end_year, 9, 20) if end_year is not None else None,
            location="Туршилтын хот",
            description=description,
            created_by=self.owner_id,
        )
        self.db.add(marriage)
        self.db.flush()
        self.marriages.append(marriage)
        return marriage

    def link_parent_child(self, parent: Person, child: Person) -> None:
        self.db.add(
            ParentChildRelationship(
                parent_id=parent.id,
                child_id=child.id,
                relationship_type="biological",
                created_by=self.owner_id,
            )
        )
        self.parent_edges.append((parent.id, child.id))

    def marry_and_spawn(
        self,
        focal: Person,
        *,
        generation: int,
        branch_id: UUID | None,
        child_specs: list[tuple[str, str | None, str | None]],
        spouse_first_name: str | None = None,
        spouse_surname: str | None = None,
        marriage_status: str | None = None,
    ) -> tuple[Person, list[Person]]:
        """Marry `focal` to a synthetic spouse and create their children in `generation + 1`."""
        spouse_gender = "female" if focal.gender == "male" else "male"
        s_first = spouse_first_name or self._next_given_name(spouse_gender)
        s_last = spouse_surname or self._next_spouse_surname()
        spouse = self.add_person(
            first_name=s_first,
            last_name=s_last,
            gender=spouse_gender,
            generation=generation,
            branch_id=branch_id,
            year_offset=2,
            note=f"Хиймэл хань · {generation}-р үе",
        )

        start_year = (focal.birth_date.year if focal.birth_date else GEN_BASE_YEAR[generation]) + 22
        status = marriage_status or ("widowed" if generation <= 5 else "married")
        self.add_marriage(focal, spouse, status=status, start_year=start_year)

        # Daughters keep their branch lineage; their children take the father's surname.
        child_surname = focal.last_name if focal.gender == "male" else spouse.last_name
        children: list[Person] = []
        for idx, (c_gender, explicit_name, explicit_note) in enumerate(child_specs):
            c_name = explicit_name or self._next_given_name(c_gender)
            child = self.add_person(
                first_name=c_name,
                last_name=child_surname,
                gender=c_gender,
                generation=generation + 1,
                branch_id=branch_id,
                year_offset=idx * 3,
                note=explicit_note,
            )
            self.link_parent_child(focal, child)
            self.link_parent_child(spouse, child)
            children.append(child)

        if focal.gender == "female" and children:
            self.daughters_with_families.append(focal.id)

        return spouse, children


def _seed_branch_subtree(
    builder: _SyntheticTreeBuilder,
    branch_index: int,
    branch_founder: Person,
    branch_id: UUID | None,
) -> dict[str, Person]:
    """Expand one of the 4 branches from Generation 2 down to Generation 9.

    Each branch contributes ~37 people (4 * 37 + 2 founders = 150 people total),
    while embedding distinct genealogical cases:
      - Branch 1: Classic patrilineal line + deliberate namesakes (Бат-Эрдэнэ, Сарантуяа)
      - Branch 2: Daughter-founded branch (Оюунцэцэг) + multiple daughters with their own families
      - Branch 3: One remarriage (Gen 4 divorced + remarried with children from both marriages)
      - Branch 4: Daughter-founded branch (Нарантуяа) + one single parent (Gen 6, no marriage)
    """
    # --- Generation 2 -> Generation 3 (2 children per branch founder) ---
    g2_specs = {
        1: [("male", "Бат-Эрдэнэ", "Ижил нэртэй (1/4) · 3-р үе"), ("female", "Цэрэндулам", None)],
        2: [("female", "Оюунбилэг", "Охины удмын 3-р үе"), ("male", "Гантулга", None)],
        3: [("male", "Эрдэнэбат", None), ("female", "Дэлгэрмаа", None)],
        4: [("female", "Алтантуяа", "Охины удмын 3-р үе"), ("male", "Даваасүрэн", None)],
    }[branch_index]
    branch_spouse, g3_children = builder.marry_and_spawn(
        branch_founder,
        generation=2,
        branch_id=branch_id,
        child_specs=g2_specs,
    )

    # --- Generation 3 -> Generation 4 ---
    # First Gen-3 child has 2 children; second Gen-3 child has 2 children (4 Gen-4 descendants).
    g3_first_specs = {
        1: [("male", "Мөнхбат", None), ("female", "Сарантуяа", "Ижил нэртэй (1/3) · 4-р үе")],
        2: [("female", "Болормаа", None), ("male", "Очирбат", None)],
        3: [("male", "Ганзориг", "Дахин гэрлэсэн гишүүн · 4-р үе"), ("female", "Гэрэлмаа", None)],
        4: [("male", "Сүхбаатар", None), ("female", "Цэндсүрэн", None)],
    }[branch_index]
    g3_spouse, g4_a = builder.marry_and_spawn(
        g3_children[0], generation=3, branch_id=branch_id, child_specs=g3_first_specs
    )
    _, g4_b = builder.marry_and_spawn(
        g3_children[1],
        generation=3,
        branch_id=branch_id,
        child_specs=[("male", None, None), ("female", None, None)],
    )
    g4_all = g4_a + g4_b

    # --- Generation 4 -> Generation 5 ---
    g5_all: list[Person] = []
    if branch_index == 3:
        # EXACTLY ONE REMARRIAGE in the entire tree:
        # g4_all[0] ("Ганзориг") marries spouse #1 (divorced, 1 child), then spouse #2 (widowed, 2 children).
        remarried = g4_all[0]
        builder.remarried_person_id = remarried.id
        spouse1 = builder.add_person(
            first_name="Сарангэрэл",
            last_name="Баяр",
            gender="female",
            generation=4,
            branch_id=branch_id,
            year_offset=1,
            note="Анхны гэрлэлт (салсан) · 4-р үе",
        )
        builder.add_marriage(
            remarried,
            spouse1,
            status="divorced",
            start_year=1909,
            end_year=1918,
            description="Хиймэл анхны гэрлэлт (салсан)",
        )
        child_m1 = builder.add_person(
            first_name="Энхжин",
            last_name=remarried.last_name,
            gender="female",
            generation=5,
            branch_id=branch_id,
            year_offset=0,
            note="Анхны гэрлэлтийн хүүхэд · Ижил нэртэй (1/3) · 5-р үе",
        )
        builder.link_parent_child(remarried, child_m1)
        builder.link_parent_child(spouse1, child_m1)
        g5_all.append(child_m1)

        spouse2 = builder.add_person(
            first_name="Болормаа",
            last_name="Цэрэн",
            gender="female",
            generation=4,
            branch_id=branch_id,
            year_offset=4,
            note="Хоёр дахь гэрлэлт · 4-р үе",
        )
        builder.add_marriage(
            remarried,
            spouse2,
            status="widowed",
            start_year=1920,
            description="Хиймэл хоёр дахь гэрлэлт",
        )
        for offset, (cg, cname) in enumerate([("male", "Цогтбаяр"), ("female", "Бадамцэцэг")]):
            c = builder.add_person(
                first_name=cname,
                last_name=remarried.last_name,
                gender=cg,
                generation=5,
                branch_id=branch_id,
                year_offset=9 + offset * 3,
                note="Хоёр дахь гэрлэлтийн хүүхэд · 5-р үе",
            )
            builder.link_parent_child(remarried, c)
            builder.link_parent_child(spouse2, c)
            g5_all.append(c)

        # g4_all[1] has 1 child; g4_all[2] has 1 child
        _, c_b = builder.marry_and_spawn(
            g4_all[1], generation=4, branch_id=branch_id, child_specs=[("male", None, None)]
        )
        _, c_c = builder.marry_and_spawn(
            g4_all[2], generation=4, branch_id=branch_id, child_specs=[("female", None, None)]
        )
        g5_all.extend(c_b + c_c)
    else:
        g4_specs_0 = (
            [("male", "Бат-Эрдэнэ", "Ижил нэртэй (2/4) · 5-р үе"), ("female", None, None)]
            if branch_index == 1
            else [("female", None, None), ("male", None, None)]
        )
        _, c_a = builder.marry_and_spawn(
            g4_all[0], generation=4, branch_id=branch_id, child_specs=g4_specs_0
        )
        _, c_b = builder.marry_and_spawn(
            g4_all[1], generation=4, branch_id=branch_id, child_specs=[("female", None, None)]
        )
        _, c_c = builder.marry_and_spawn(
            g4_all[2],
            generation=4,
            branch_id=branch_id,
            child_specs=[("male", None, None), ("female", None, None)],
        )
        g5_all.extend(c_a + c_b + c_c)

    # --- Generation 5 -> Generation 6 ---
    g6_all: list[Person] = []
    g5_child_0 = (
        [("male", "Тэмүүлэн", "Ижил нэртэй (1/3) · 6-р үе"), ("female", "Сарантуяа", "Ижил нэртэй (2/3) · 6-р үе")]
        if branch_index == 2
        else [("female", "Отгонбаяр", "Ганц бие ээж · 6-р үе"), ("male", None, None)]
        if branch_index == 4
        else [("male", None, None), ("female", None, None)]
    )
    _, c6_a = builder.marry_and_spawn(
        g5_all[0], generation=5, branch_id=branch_id, child_specs=g5_child_0
    )
    _, c6_b = builder.marry_and_spawn(
        g5_all[1], generation=5, branch_id=branch_id, child_specs=[("female", None, None)]
    )
    g6_all.extend(c6_a + c6_b)

    # --- Generation 6 -> Generation 7 ---
    g7_all: list[Person] = []
    if branch_index == 4:
        # EXACTLY ONE SINGLE PARENT in the entire tree:
        # g6_all[0] ("Отгонбаяр") raises 2 children with NO marriage and NO second parent.
        single_parent = g6_all[0]
        builder.single_parent_id = single_parent.id
        for idx, (cg, cname) in enumerate([("female", "Энхжин"), ("male", "Билгүүн")]):
            child = builder.add_person(
                first_name=cname,
                last_name=single_parent.last_name,
                gender=cg,
                generation=7,
                branch_id=branch_id,
                year_offset=idx * 3,
                note="Ганц бие эцэг/эхийн хүүхэд · 7-р үе",
            )
            builder.link_parent_child(single_parent, child)
            g7_all.append(child)
        _, c7_b = builder.marry_and_spawn(
            g6_all[1], generation=6, branch_id=branch_id, child_specs=[("male", None, None)]
        )
        g7_all.extend(c7_b)
    else:
        g6_specs_0 = (
            [("male", "Бат-Эрдэнэ", "Ижил нэртэй (3/4) · 7-р үе"), ("female", None, None)]
            if branch_index == 1
            else [("female", "Энхжин", "Ижил нэртэй (2/3) · 7-р үе"), ("male", None, None)]
            if branch_index == 3
            else [("male", None, None), ("female", None, None)]
        )
        _, c7_a = builder.marry_and_spawn(
            g6_all[0], generation=6, branch_id=branch_id, child_specs=g6_specs_0
        )
        _, c7_b = builder.marry_and_spawn(
            g6_all[1], generation=6, branch_id=branch_id, child_specs=[("female", None, None)]
        )
        g7_all.extend(c7_a + c7_b)

    # --- Generation 7 -> Generation 8 ---
    g8_all: list[Person] = []
    g7_specs_0 = (
        [("male", "Тэмүүлэн", "Ижил нэртэй (2/3) · 8-р үе"), ("female", "Сарантуяа", "Ижил нэртэй (3/3) · 8-р үе")]
        if branch_index == 1
        else [("female", None, None), ("male", None, None)]
    )
    _, c8_a = builder.marry_and_spawn(
        g7_all[0], generation=7, branch_id=branch_id, child_specs=g7_specs_0
    )
    _, c8_b = builder.marry_and_spawn(
        g7_all[1], generation=7, branch_id=branch_id, child_specs=[("male", None, None)]
    )
    g8_all.extend(c8_a + c8_b)

    # --- Generation 8 -> Generation 9 (youngest generation, unmarried) ---
    g8_specs_0 = {
        1: [("male", "Бат-Эрдэнэ", "Ижил нэртэй (4/4) · 9-р үе"), ("female", "Мишээл", None)],
        2: [("female", "Энхжин", "Ижил нэртэй (3/3) · 9-р үе"), ("male", "Тэмүүлэн", "Ижил нэртэй (3/3) · 9-р үе")],
        3: [("male", "Чингүүн", None), ("female", "Анужин", None)],
        4: [("female", "Номин-Эрдэнэ", None), ("male", "Хүслэн", None)],
    }[branch_index]
    builder.marry_and_spawn(
        g8_all[0], generation=8, branch_id=branch_id, child_specs=g8_specs_0
    )
    if branch_index in (1, 2):
        builder.marry_and_spawn(
            g8_all[1], generation=8, branch_id=branch_id, child_specs=[("female", None, None)]
        )

    return {
        "g2_spouse": branch_spouse,
        "g3_spouse": g3_spouse,
        "g6_unmarried": g6_all[2],
    }


def _verify_seeded_invariants(builder: _SyntheticTreeBuilder, founder_id: UUID) -> dict[str, int]:
    """Assert every required genealogical invariant holds before committing."""
    # 1. Exact generation depth from founder via BFS over parent -> child edges.
    children_map: dict[UUID, list[UUID]] = defaultdict(list)
    parents_map: dict[UUID, list[UUID]] = defaultdict(list)
    for pid, cid in builder.parent_edges:
        children_map[pid].append(cid)
        parents_map[cid].append(pid)

    depth: dict[UUID, int] = {founder_id: 1}
    queue: deque[UUID] = deque([founder_id])
    while queue:
        cur = queue.popleft()
        for child_id in children_map[cur]:
            next_d = depth[cur] + 1
            if child_id not in depth or next_d > depth[child_id]:
                depth[child_id] = next_d
                queue.append(child_id)

    max_gen = max(depth.values())
    assert max_gen == 9, f"Expected 9 generations, got {max_gen}"

    # 2. Remarriage count: exactly one person with >= 2 marriages.
    marriage_counts: Counter[UUID] = Counter()
    for m in builder.marriages:
        marriage_counts[m.person_1_id] += 1
        marriage_counts[m.person_2_id] += 1
    remarried = [pid for pid, cnt in marriage_counts.items() if cnt >= 2]
    assert len(remarried) == 1, f"Expected 1 remarriage, got {len(remarried)}"

    # 3. Single parent count: exactly one parent whose children have only 1 parent & no marriage.
    single_parents = {
        parents_map[cid][0]
        for cid, plist in parents_map.items()
        if len(plist) == 1 and marriage_counts[plist[0]] == 0
    }
    assert len(single_parents) == 1, f"Expected 1 single parent, got {len(single_parents)}"

    # 4. Daughters with their own families.
    assert len(builder.daughters_with_families) >= 4, "Expected multiple daughters with families"

    # 5. Namesakes (first_name appearing >= 2 times).
    name_counts = Counter(p.first_name for p in builder.persons)
    namesake_groups = {name: cnt for name, cnt in name_counts.items() if cnt >= 2}
    assert len(namesake_groups) >= 4, f"Expected deliberate namesakes, got {namesake_groups}"

    return {
        "total_people": len(builder.persons),
        "generations": max_gen,
        "marriages": len(builder.marriages),
        "remarriages": len(remarried),
        "single_parents": len(single_parents),
        "daughters_with_families": len(builder.daughters_with_families),
        "namesake_groups": len(namesake_groups),
        "parent_child_edges": len(builder.parent_edges),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a disposable local demo family tree.")
    parser.add_argument(
        "--no-lineage",
        action="store_true",
        help="Skip creating Lineage, Branch, and PersonLineageAssignment rows (tests structural branch derivation).",
    )
    args = parser.parse_args()

    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == DEMO_OWNER_EMAIL)):
            raise SystemExit("Demo fixtures already present; use a fresh disposable database")

        now = datetime.now(UTC)
        owner = User(
            email=DEMO_OWNER_EMAIL,
            display_name="Туршилтын Эзэн (Synthetic Demo)",
            password_hash=_password_hash(DEMO_OWNER_PASSWORD),
            email_verified_at=now,
        )
        db.add(owner)
        db.flush()
        db.add(
            LoginIdentity(
                user_id=owner.id,
                provider="email",
                normalized_identifier=DEMO_OWNER_EMAIL,
                display_identifier=DEMO_OWNER_EMAIL,
                verified_at=now,
            )
        )

        family = Family(
            name=DEMO_FAMILY_NAME,
            description=(
                "Зөвхөн локал туршилтад зориулсан хиймэл 9 үеийн ургийн мод. "
                "Бодит хүний мэдээлэл агуулаагүй."
            ),
            created_by=owner.id,
        )
        db.add(family)
        db.flush()
        db.add(FamilyMember(family_id=family.id, user_id=owner.id, role="owner"))

        lineage_id: UUID | None = None
        branch_specs = [
            (1, "1-р салбар — Батболдын удам", "Батболд", "male"),
            (2, "2-р салбар — Оюунцэцэгийн удам", "Оюунцэцэг", "female"),
            (3, "3-р салбар — Ганбаатарын удам", "Ганбаатар", "male"),
            (4, "4-р салбар — Нарантуяагийн удам", "Нарантуяа", "female"),
        ]
        branches: list[tuple[int, UUID | None, str, str, str]] = []
        if not args.no_lineage:
            lineage = Lineage(
                family_id=family.id,
                name=DEMO_LINEAGE_NAME,
                description="Хиймэл 4 салбар, 9 үеийн туршилтын удам",
            )
            db.add(lineage)
            db.flush()
            lineage_id = lineage.id
            for idx, b_name, child_name, gender in branch_specs:
                branch = Branch(
                    lineage_id=lineage.id,
                    name=b_name,
                    description=f"Анхдагч хосын {idx}-р хүүхдээс салбарласан хиймэл салбар",
                )
                db.add(branch)
                db.flush()
                branches.append((idx, branch.id, b_name, child_name, gender))
        else:
            for idx, b_name, child_name, gender in branch_specs:
                branches.append((idx, None, b_name, child_name, gender))

        builder = _SyntheticTreeBuilder(db, owner.id, family.id, lineage_id)

        # Generation 1: Founding couple (assigned to lineage, branch_id=None).
        founder_father = builder.add_person(
            first_name="Дорж",
            last_name="Алтан",
            gender="male",
            generation=1,
            branch_id=None,
            year_offset=0,
            note="Анхдагч өвөг (Хиймэл 1-р үе)",
        )
        founder_mother = builder.add_person(
            first_name="Цэцэгмаа",
            last_name="Сүрэн",
            gender="female",
            generation=1,
            branch_id=None,
            year_offset=4,
            note="Анхдагч эмэг (Хиймэл 1-р үе)",
        )
        # Set explicit family root person so lineage_root_person_id is populated.
        family.root_person_id = founder_father.id
        builder.add_marriage(
            founder_father,
            founder_mother,
            status="widowed",
            start_year=1834,
            description="Анхдагч хос",
        )

        # Generation 2: 4 children founding the 4 branches -> expand each through Generation 9.
        branch_handles: dict[int, dict[str, Person]] = {}
        for idx, branch_id, b_name, child_name, gender in branches:
            branch_founder = builder.add_person(
                first_name=child_name,
                last_name="Алтан",
                gender=gender,
                generation=2,
                branch_id=branch_id,
                year_offset=(idx - 1) * 3,
                note=f"{b_name}-ын үндэслэгч · 2-р үе",
            )
            builder.link_parent_child(founder_father, branch_founder)
            builder.link_parent_child(founder_mother, branch_founder)
            branch_handles[idx] = _seed_branch_subtree(builder, idx, branch_founder, branch_id)

        # Non-tree case 1: Spouse (Branch 1 Gen-2 spouse) whose own two in-law parents are loaded.
        inlaw_father_1 = builder.add_person(
            first_name="Худ-Дамдин",
            last_name=branch_handles[1]["g2_spouse"].last_name,
            gender="male",
            generation=1,
            branch_id=None,
            year_offset=2,
            note="Худын талын эцэг (non-tree test case 1)",
        )
        inlaw_mother_1 = builder.add_person(
            first_name="Худ-Долгор",
            last_name="Очир",
            gender="female",
            generation=1,
            branch_id=None,
            year_offset=5,
            note="Худын талын эх (non-tree test case 1)",
        )
        builder.add_marriage(
            inlaw_father_1,
            inlaw_mother_1,
            status="widowed",
            start_year=1836,
            description="Худын талын гэрлэлт (non-tree test case 1)",
        )
        builder.link_parent_child(inlaw_father_1, branch_handles[1]["g2_spouse"])
        builder.link_parent_child(inlaw_mother_1, branch_handles[1]["g2_spouse"])

        # Non-tree case 2: Spouse (Branch 2 Gen-3 spouse) whose own in-law parents are loaded.
        inlaw_father_2 = builder.add_person(
            first_name="Худ-Жамц",
            last_name=branch_handles[2]["g3_spouse"].last_name,
            gender="male",
            generation=2,
            branch_id=None,
            year_offset=1,
            note="Худын талын эцэг (non-tree test case 2)",
        )
        inlaw_mother_2 = builder.add_person(
            first_name="Худ-Цэрэн",
            last_name="Дорж",
            gender="female",
            generation=2,
            branch_id=None,
            year_offset=3,
            note="Худын талын эх (non-tree test case 2)",
        )
        builder.add_marriage(
            inlaw_father_2,
            inlaw_mother_2,
            status="widowed",
            start_year=1860,
            description="Худын талын гэрлэлт (non-tree test case 2)",
        )
        builder.link_parent_child(inlaw_father_2, branch_handles[2]["g3_spouse"])
        builder.link_parent_child(inlaw_mother_2, branch_handles[2]["g3_spouse"])

        # Non-tree case 3: Inter-branch marriage where BOTH parents are lineage descendants
        # (Branch 1 Gen-6 member + Branch 2 Gen-6 member -> Gen-7 child with 2 lineage parents).
        parent_b1 = branch_handles[1]["g6_unmarried"]
        parent_b2 = branch_handles[2]["g6_unmarried"]
        builder.add_marriage(
            parent_b1,
            parent_b2,
            status="married",
            start_year=1964,
            description="Салбар хоорондын гэрлэлт (non-tree test case 3)",
        )
        interbranch_child = builder.add_person(
            first_name="Энх-Амгалан",
            last_name=parent_b1.last_name,
            gender="male",
            generation=7,
            branch_id=branches[0][1],
            year_offset=2,
            note="Хоёр эцэг эх нь хоёулаа удмын гишүүн (non-tree test case 3)",
        )
        builder.link_parent_child(parent_b1, interbranch_child)
        builder.link_parent_child(parent_b2, interbranch_child)

        stats = _verify_seeded_invariants(builder, founder_father.id)
        db.commit()

    lineage_summary = "NONE (--no-lineage)" if args.no_lineage else f"{DEMO_LINEAGE_NAME} ({len(branches)} branches)"
    print(f"Seeded disposable demo database: {_DISPOSABLE_DB_PATH}")
    print(f"  Family   : {DEMO_FAMILY_NAME} ({family.id})")
    print(f"  Root     : {founder_father.first_name} ({founder_father.id})")
    print(f"  Lineage  : {lineage_summary}")
    print(f"  Login    : {DEMO_OWNER_EMAIL} / {DEMO_OWNER_PASSWORD}")
    print(
        f"  Summary  : {stats['total_people']} people, {stats['generations']} generations, "
        f"{stats['marriages']} marriages ({stats['remarriages']} remarriage), "
        f"{stats['single_parents']} single parent, "
        f"{stats['daughters_with_families']} daughters with own families, "
        f"{stats['namesake_groups']} namesake groups, "
        f"{stats['parent_child_edges']} parent-child edges"
    )


if __name__ == "__main__":
    main()
