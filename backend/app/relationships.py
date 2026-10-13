from collections import defaultdict
from collections.abc import Iterable, Sequence
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def lock_ancestry_writes(db: Session) -> None:
    """Serialize canonical graph checks/writes across all family and root APIs.

    A per-family lock cannot protect paths that cross family boundaries. The
    transaction lock is released on commit/rollback and needs no schema change.
    SQLite fixtures execute serially and do not support PostgreSQL advisory locks.
    """
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 604260703})


class RelationshipError(ValueError):
    """A family relationship would violate a graph invariant."""


def canonical_pair(person_a: UUID, person_b: UUID) -> tuple[UUID, UUID]:
    if person_a == person_b:
        raise RelationshipError("Хүн өөртэйгөө гэр бүлийн холбоо үүсгэж болохгүй.")
    return tuple(sorted((person_a, person_b), key=str))  # type: ignore[return-value]


def assert_parent_child_is_acyclic(
    existing_edges: Iterable[Sequence[UUID]], parent_id: UUID, child_id: UUID
) -> None:
    """Reject self-parenting and any edge that closes a directed ancestry cycle."""
    if parent_id == child_id:
        raise RelationshipError("Хүн өөрөө өөрийнхөө эцэг эх байж болохгүй.")

    children: dict[UUID, set[UUID]] = defaultdict(set)
    for parent, child in existing_edges:
        children[parent].add(child)

    # A new parent -> child edge cycles only if child already reaches parent.
    pending = [child_id]
    visited: set[UUID] = set()
    while pending:
        current = pending.pop()
        if current == parent_id:
            raise RelationshipError("Энэ холбоо ургийн модонд тойрог үүсгэнэ.")
        if current in visited:
            continue
        visited.add(current)
        pending.extend(children[current] - visited)


def assert_date_order(start, end) -> None:
    if start is not None and end is not None and end < start:
        raise RelationshipError("Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.")
