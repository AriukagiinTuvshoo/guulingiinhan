"""Read-only discovery over the existing authorized canonical graph and content."""

from collections import defaultdict, deque
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.families import (
    _assert_person_visible,
    _member,
    _memory_visible_to_member,
    _person_in_family,
    _person_profile_output,
    _require_minor_scope,
    family_tree,
    list_person_archives,
    list_stories,
)
from app.models import LifeEvent, Marriage, Memory, MemoryPersonTag, User
from app.privacy import active_guardian_scopes, person_is_minor

router = APIRouter(prefix="/families", tags=["heritage discovery"])


def relationship_paths(graph: dict, first: UUID, second: UUID, include_former: bool) -> dict:
    """Bounded shortest paths; only identifiers admitted by the authorized tree enter here."""
    people = {person.id: person for person in graph["persons"]}
    result: dict = {"status": "not_found", "paths": [], "common_ancestors": [],
                    "truncated": graph["meta"]["truncated"], "paths_limited": False}
    if first not in people or second not in people:
        result["status"] = "limited"
        return result
    adjacent: dict = defaultdict(list)
    parents: dict = defaultdict(set)
    for edge in graph["parent_child_relationships"]:
        if edge.parent_id not in people or edge.child_id not in people:
            continue
        parents[edge.child_id].add(edge.parent_id)
        for source, target, direction in ((edge.child_id, edge.parent_id, "parent"),
                                           (edge.parent_id, edge.child_id, "child")):
            adjacent[source].append((target, {"kind": direction, "relationship_type": edge.relationship_type,
                                               "id": edge.id}))
    for marriage in graph["marriages"]:
        if marriage.status == "divorced" and not include_former:
            continue
        if marriage.person_1_id not in people or marriage.person_2_id not in people:
            continue
        for source, target in ((marriage.person_1_id, marriage.person_2_id),
                               (marriage.person_2_id, marriage.person_1_id)):
            adjacent[source].append((target, {"kind": "spouse", "id": marriage.id,
                                               "status": marriage.status}))

    def summary(person_id):
        person = people[person_id]
        return {"id": person_id, "name": " ".join(filter(None, (
            person.last_name, person.first_name, person.middle_name)))}

    distance = {first: 0}
    predecessors: dict = defaultdict(list)
    queue = deque([first])
    while queue:
        current = queue.popleft()
        if distance[current] >= distance.get(second, 33) or distance[current] >= 32:
            continue
        for target, step in adjacent[current]:
            candidate = distance[current] + 1
            if target not in distance:
                distance[target] = candidate
                queue.append(target)
            if distance[target] == candidate:
                predecessors[target].append((current, step))
    if second in distance:
        # Distances strictly decrease during reconstruction, even on corrupt cyclic input.
        stack: list[tuple[UUID, list[UUID], list[dict]]] = [(second, [second], [])]
        while stack and len(result["paths"]) < 3:
            current, nodes, steps = stack.pop()
            if current == first:
                ordered_steps = list(reversed(steps))
                result["paths"].append({"people": [summary(pid) for pid in reversed(nodes)],
                    "steps": ordered_steps, "distance": len(steps),
                    "generation_distance": sum({"parent": -1, "child": 1, "spouse": 0}[s["kind"]]
                                               for s in ordered_steps)})
            else:
                for previous, step in predecessors[current]:
                    stack.append((previous, nodes + [previous], steps + [step]))
        result["paths_limited"] = bool(stack)
        result["status"] = "same" if first == second else "found"
    elif graph["meta"]["truncated"] or any(value == 32 for value in distance.values()):
        result["status"] = "limited"

    def ancestors(person_id):
        found = {person_id: 0}
        pending = deque([person_id])
        while pending:
            current = pending.popleft()
            for parent in parents[current]:
                if parent not in found:
                    found[parent] = found[current] + 1
                    pending.append(parent)
        return found

    left, right = ancestors(first), ancestors(second)
    common = sorted(left.keys() & right.keys(), key=lambda pid: (left[pid] + right[pid], str(pid)))
    if common:
        nearest = left[common[0]] + right[common[0]]
        result["common_ancestors"] = [dict(summary(pid), first_distance=left[pid], second_distance=right[pid])
                                       for pid in common if left[pid] + right[pid] == nearest][:5]
    return result


@router.get("/{family_id}/relationship-path")
def find_relationship(
    family_id: UUID, first: UUID, second: UUID, response: Response, include_former: bool = False,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    response.headers["Cache-Control"] = "private, no-store"
    for person_id in {first, second}:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        _require_minor_scope(db, family_id, person, user, "view_profile")
    graph = family_tree(family_id=family_id, person_id=first, depth=5, scope="all",
                        node_limit=1000, user=user, db=db)
    return relationship_paths(graph, first, second, include_former)


@router.get("/{family_id}/persons/{person_id}/timeline")
def person_timeline(
    family_id: UUID, person_id: UUID, response: Response,
    page: int = Query(default=1, ge=1), page_size: int = Query(default=30, ge=1, le=50),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    response.headers["Cache-Control"] = "private, no-store"
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "view_profile")
    profile = _person_profile_output(db, family_id, person, user)
    scopes = active_guardian_scopes(db, user.id, family_id, [person_id]).get(person_id, set())
    minor = person_is_minor(person)
    entries: list[dict] = []
    capped = False

    def add(key: str, kind: str, when: date | None, title: str, href: str | None = None):
        entries.append({"id": key, "kind": kind, "date": when, "title": title, "href": href})

    def name(item):
        return " ".join(filter(None, (item.last_name, item.first_name, item.middle_name)))

    if profile.birth_date:
        add("birth", "birth", profile.birth_date, "Төрсөн")
    if not profile.is_alive and profile.death_date:
        add("death", "death", profile.death_date, "Дурсгал")
    for child in profile.children:
        if child.birth_date:
            add(f"child-{child.id}", "child", child.birth_date, f"Хүүхэд төрсөн · {name(child)}",
                f"/profile?person={child.id}&family={family_id}")
    visible_partners = {item.id: item for item in profile.spouses}
    marriages = db.scalars(select(Marriage).where(
        Marriage.deleted_at.is_(None),
        or_(Marriage.person_1_id == person_id, Marriage.person_2_id == person_id),
        Marriage.person_1_id.in_({person_id, *visible_partners}),
        Marriage.person_2_id.in_({person_id, *visible_partners}),
    ).order_by(Marriage.start_date, Marriage.id).limit(101)).all()
    capped |= len(marriages) > 100
    for marriage in marriages[:100]:
        other_id = marriage.person_2_id if marriage.person_1_id == person_id else marriage.person_1_id
        title = name(visible_partners[other_id])
        add(f"marriage-{marriage.id}", "marriage", marriage.start_date, f"Гэрлэлт · {title}")
        if marriage.status != "married":
            add(f"end-{marriage.id}", marriage.status, marriage.end_date,
                ("Гэрлэлт дууссан" if marriage.status == "divorced" else "Ханиа алдсан") + f" · {title}")
    if not minor or "manage_events" in scopes:
        events = db.scalars(select(LifeEvent).where(LifeEvent.person_id == person_id)
                           .order_by(LifeEvent.event_date, LifeEvent.id).limit(101)).all()
        capped |= len(events) > 100
        for event in events[:100]:
            add(f"event-{event.id}", "event", event.event_date, event.title)
    story_page = list_stories(family_id, q=None, person_id=person_id, year=None,
                             event_date=None, page=1, page_size=50, user=user, db=db)
    archive_page = list_person_archives(family_id, person_id, page=1, page_size=50, user=user, db=db)
    capped |= story_page.has_next or archive_page.has_next
    for story in story_page.items:
        add(f"story-{story.id}", "story", story.event_date, story.title, f"/stories/{story.id}?family={family_id}")
    for archive in archive_page.items:
        add(f"archive-{archive.id}", "archive", archive.document_date, archive.title,
            f"/archives/{archive.id}?family={family_id}")
    if not minor or "manage_memories" in scopes:
        memories = db.scalars(select(Memory).where(
            Memory.family_id == family_id,
            Memory.id.in_(select(MemoryPersonTag.memory_id).where(MemoryPersonTag.person_id == person_id)),
            or_(Memory.visibility != "private", Memory.created_by == user.id),
        ).order_by(Memory.memory_date, Memory.id).limit(101)).all()
        capped |= len(memories) > 100
        visible = _memory_visible_to_member(db, family_id, user, [item.id for item in memories[:100]])
        for memory in memories[:100]:
            if memory.id in visible:
                add(f"memory-{memory.id}", "memory", memory.memory_date, memory.title,
                    f"/memories/{memory.id}?family={family_id}")
    entries.sort(key=lambda item: (item["date"] is None, item["date"] or date.max, item["id"]))
    return {"items": entries[(page - 1) * page_size:page * page_size], "page": page,
            "has_next": page * page_size < len(entries), "total": len(entries), "truncated": capped}
