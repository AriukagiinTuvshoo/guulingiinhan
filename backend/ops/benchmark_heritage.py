"""Local synthetic PostgreSQL + ASGI benchmark. Never connects to staging."""
import hashlib
import json
import logging
import secrets
import statistics
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.config import get_settings
from app.db import SessionLocal, engine
from app.main import app
from app.models import (
    Archive,
    ArchivePerson,
    Family,
    FamilyMember,
    FamilyPerson,
    LifeEvent,
    Marriage,
    Memory,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    Story,
    StoryPerson,
    User,
    UserSession,
)
from app.relationships import canonical_pair

root = Path(__file__).resolve().parents[2]
settings = get_settings()
assert settings.app_env == "test"
assert settings.database_url == "postgresql+psycopg://postgres@127.0.0.1:55433/guulingiinhan_test_p123"
logging.disable(logging.CRITICAL)
cookie = secrets.token_urlsafe(32)
with SessionLocal.begin() as db:
    user = User(display_name="Local performance fixture", email=f"p124-{secrets.token_hex(6)}@example.com")
    db.add(user); db.flush()
    family = Family(name="P12.4 local fixture", created_by=user.id)
    db.add(family); db.flush()
    people = [Person(first_name=f"Fixture{i}", search_first_name=f"fixture{i}", birth_date=date(1980, 1, 1), created_by=user.id) for i in range(800)]
    db.add_all(people); db.flush()
    family.root_person_id = people[0].id
    db.add(FamilyMember(family_id=family.id, user_id=user.id, role="owner"))
    db.add(UserSession(user_id=user.id, token_hash=hashlib.sha256(cookie.encode()).hexdigest(), expires_at=datetime.now(UTC) + timedelta(hours=4)))
    db.add_all([FamilyPerson(family_id=family.id, person_id=p.id, added_by=user.id) for p in people])
    db.add_all([ParentChildRelationship(parent_id=people[(i-1)//2].id, child_id=people[i].id, created_by=user.id) for i in range(1,800)])
    for i in range(620,800,2):
        first, second = canonical_pair(people[i].id, people[i+1].id)
        db.add(Marriage(person_1_id=first, person_2_id=second, created_by=user.id))
    for i in range(30):
        story = Story(family_id=family.id, title=f"Fixture story {i}", body="Local text", event_date=date(2000+i%20, 1, 1), created_by=user.id)
        archive = Archive(family_id=family.id, title=f"Fixture archive {i}", description="Local text", document_date=date(1990+i%20, 1, 1), created_by=user.id)
        memory = Memory(family_id=family.id, title=f"Fixture memory {i}", description="Local text", memory_date=date(1995+i%20, 1, 1), created_by=user.id)
        db.add_all([story, archive, memory]); db.flush()
        db.add_all([StoryPerson(story_id=story.id, family_id=family.id, person_id=people[0].id), ArchivePerson(archive_id=archive.id, family_id=family.id, person_id=people[0].id), MemoryPersonTag(memory_id=memory.id, person_id=people[0].id)])
    db.add(LifeEvent(person_id=people[0].id, title="Local school", event_date=date(1995, 9, 1), event_type="school", created_by=user.id))
    family_id, root_id, first_id, second_id = family.id, people[0].id, people[799].id, people[798].id
    fixture = {"family_id": str(family.id), "person_id": str(root_id), "first": str(first_id), "second": str(second_id), "cookie_name": settings.session_cookie_name, "cookie": cookie, "story_id": str(story.id), "archive_id": str(archive.id), "memory_id": str(memory.id)}
(root / ".p12_4_local_fixture.json").write_text(json.dumps(fixture), encoding="utf-8")
sql_times = []
def before(conn, cursor, statement, parameters, context, executemany):
    context.p124_started = time.perf_counter()
def after(conn, cursor, statement, parameters, context, executemany):
    sql_times.append((time.perf_counter() - context.p124_started) * 1000)
event.listen(engine, "before_cursor_execute", before); event.listen(engine, "after_cursor_execute", after)
results = []
base = f"/api/v1/families/{family_id}"
paths = [("people_directory", base + "/people?page_size=30"), ("search_people", base + "/people?q=Fixture&page_size=12"), ("search_stories", base + "/stories?q=Fixture&page_size=12"), ("search_memories", base + "/memories?q=Fixture&page_size=12"), ("search_archives", base + "/archives?q=Fixture&page_size=12"), ("tree", base + "/tree?scope=all&node_limit=1000"), ("relationship", base + f"/relationship-path?first={first_id}&second={second_id}"), ("profile", base + f"/persons/{root_id}"), ("timeline", base + f"/persons/{root_id}/timeline")]
with TestClient(app) as client:
    client.cookies.set(settings.session_cookie_name, cookie)
    for label, path in paths:
        samples = []
        for attempt in range(6):
            sql_times.clear(); started = time.perf_counter()
            response = client.get(path); elapsed = (time.perf_counter() - started) * 1000
            assert response.status_code == 200, label
            if label == "tree": assert len(response.json()["persons"]) == 800
            if label == "relationship": assert response.json()["status"] == "found"
            if label == "timeline": assert response.json()["total"] >= 90
            if attempt: samples.append((elapsed, sum(sql_times), len(sql_times), len(response.content)))
        results.append({"route": label, "asgi_median_ms": round(statistics.median(x[0] for x in samples), 2), "sql_median_ms": round(statistics.median(x[1] for x in samples), 2), "query_count": samples[-1][2], "response_bytes": samples[-1][3]})
report = {"scope": "Local synthetic PostgreSQL + in-process HTTP, not staging/production/GPU/network", "dataset": {"people": 800, "parent_child": 799, "marriages": 90, "stories": 30, "memories": 30, "archives": 30}, "results": results}
(root / "docs/P12_4_LOCAL_PERFORMANCE.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
