import asyncio
import json
from uuid import UUID, uuid4

from conftest import register_verified

from app.family_chat import (
    _chat_subscribers,
    _handle_pg_notification,
    _psycopg_conninfo,
    _subscribers_lock,
    publish_chat_event,
)
from app.models import FamilyMember


def test_family_chat_broadcast_and_direct(client, database):
    # Register Owner
    assert register_verified(client, "chat-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Чаттай гэр бүл"}).json()
    family_id = family["id"]
    me_owner = client.get("/api/v1/auth/me").json()

    # Register Member 2
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "chat-member2@example.com").status_code == 201
    me_m2 = client.get("/api/v1/auth/me").json()

    # Add Member 2 to Family
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(me_m2["id"]), role="member"))
        db.commit()

    # 1. Member 2 sends a general broadcast message to the family
    msg1 = client.post(
        f"/api/v1/families/{family_id}/chat/messages",
        json={"content": "Сайн байцгаана уу, гэр бүлийнхээн!"},
    )
    assert msg1.status_code == 200
    msg1_data = msg1.json()
    assert msg1_data["content"] == "Сайн байцгаана уу, гэр бүлийнхээн!"
    assert msg1_data["recipient_id"] is None
    assert msg1_data["sender_id"] == me_m2["id"]

    # 2. Member 2 sends a 1-on-1 direct message to Owner
    msg_dm = client.post(
        f"/api/v1/families/{family_id}/chat/messages",
        json={"content": "Сайн байна уу админаа, хувийн зурвас бичлээ.", "recipient_id": me_owner["id"]},
    )
    assert msg_dm.status_code == 200
    dm_data = msg_dm.json()
    assert dm_data["recipient_id"] == me_owner["id"]

    # 3. Member 2 lists broadcast messages -> should only see broadcast
    b_msgs = client.get(f"/api/v1/families/{family_id}/chat/messages")
    assert b_msgs.status_code == 200
    assert len(b_msgs.json()) == 1
    assert b_msgs.json()[0]["id"] == msg1_data["id"]

    # 4. Member 2 lists direct messages with Owner -> should see dm
    dm_msgs = client.get(f"/api/v1/families/{family_id}/chat/messages?recipient_id={me_owner['id']}")
    assert dm_msgs.status_code == 200
    assert len(dm_msgs.json()) == 1
    assert dm_msgs.json()[0]["id"] == dm_data["id"]

    # 5. Switch to Owner and verify Owner sees both
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "chat-owner@example.com", "password": "strong-passphrase-123"},
    ).status_code == 200

    owner_b = client.get(f"/api/v1/families/{family_id}/chat/messages").json()
    assert len(owner_b) == 1
    assert owner_b[0]["content"] == "Сайн байцгаана уу, гэр бүлийнхээн!"

    owner_dm = client.get(f"/api/v1/families/{family_id}/chat/messages?recipient_id={me_m2['id']}").json()
    assert len(owner_dm) == 1
    assert owner_dm[0]["content"] == "Сайн байна уу админаа, хувийн зурвас бичлээ."

    # 6. Check members list
    res = client.get(f"/api/v1/families/{family_id}/chat/members")
    assert res.status_code == 200
    members = res.json()
    assert len(members) == 2
    user_ids = {m["user_id"] for m in members}
    assert me_owner["id"] in user_ids
    assert me_m2["id"] in user_ids

    # 7. Outsider cannot access or send chat
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "chat-outsider@example.com").status_code == 201
    assert client.get(f"/api/v1/families/{family_id}/chat/messages").status_code == 403
    assert client.post(
        f"/api/v1/families/{family_id}/chat/messages",
        json={"content": "Би хамаагүй хүн"},
    ).status_code == 403


def test_family_chat_sse_stream_auth_and_event_delivery(client):
    assert register_verified(client, "sse-owner@example.com").status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "SSE Чат"}).json()["id"]

    # Authorized member receives event: connected SSE stream
    stream_res = client.get(f"/api/v1/families/{family_id}/chat/stream?once=true")
    assert stream_res.status_code == 200
    assert stream_res.headers["content-type"].startswith("text/event-stream")
    assert "no-cache" in stream_res.headers.get("cache-control", "").lower()
    assert "event: connected" in stream_res.text
    assert family_id in stream_res.text

    # Non-member receives 403
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "sse-stranger@example.com").status_code == 201
    assert client.get(f"/api/v1/families/{family_id}/chat/stream?once=true").status_code == 403

    # Unauthenticated user receives 401
    client.post("/api/v1/auth/logout")
    assert client.get(f"/api/v1/families/{family_id}/chat/stream?once=true").status_code == 401


def test_psycopg_conninfo_normalization():
    assert (
        _psycopg_conninfo("postgresql+psycopg://user:pass@db:5432/guulin")
        == "postgresql://user:pass@db:5432/guulin"
    )
    assert _psycopg_conninfo("postgresql://user:pass@db:5432/guulin") == "postgresql://user:pass@db:5432/guulin"
    assert _psycopg_conninfo("postgres://user:pass@db:5432/guulin") == "postgres://user:pass@db:5432/guulin"
    assert _psycopg_conninfo("sqlite:///./guulin.db") is None


def test_pg_notification_dispatches_and_deduplicates():
    family_id = uuid4()
    loop = asyncio.new_event_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    entry = (loop, queue)
    with _subscribers_lock:
        _chat_subscribers[family_id].append(entry)

    try:
        event_id = uuid4().hex
        envelope = json.dumps(
            {
                "event_id": event_id,
                "family_id": str(family_id),
                "event": {"type": "message_created", "message_id": "m-1", "sender_id": "u-1"},
            }
        )
        # First delivery succeeds
        assert _handle_pg_notification(envelope) is True
        # Duplicate delivery (same worker PG loopback) is deduplicated
        assert _handle_pg_notification(envelope) is False

        # Flush loop callbacks
        loop.call_soon(loop.stop)
        loop.run_forever()

        assert queue.qsize() == 1
        delivered = queue.get_nowait()
        assert delivered["type"] == "message_created"
        assert delivered["message_id"] == "m-1"

        # Malformed payloads fail safely without raising
        assert _handle_pg_notification("not-json") is False
        assert _handle_pg_notification(json.dumps(["not-a-dict"])) is False
        assert _handle_pg_notification(json.dumps({"event_id": "abc", "family_id": "bad-uuid", "event": {}})) is False
    finally:
        with _subscribers_lock:
            subs = _chat_subscribers.get(family_id)
            if subs and entry in subs:
                subs.remove(entry)
            if subs is not None and not subs:
                _chat_subscribers.pop(family_id, None)
        loop.close()


def test_publish_chat_event_invokes_pg_notify_and_local_dispatch(monkeypatch):
    family_id = uuid4()
    loop = asyncio.new_event_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    entry = (loop, queue)
    emitted: list[str] = []

    def fake_notify(envelope_json: str, db=None) -> bool:
        emitted.append(envelope_json)
        return True

    monkeypatch.setattr("app.family_chat._emit_pg_notify", fake_notify)

    with _subscribers_lock:
        _chat_subscribers[family_id].append(entry)

    try:
        publish_chat_event(
            family_id,
            {"type": "message_created", "message_id": "m-2", "sender_id": "u-2", "recipient_id": None},
        )
        assert len(emitted) == 1
        parsed = json.loads(emitted[0])
        assert parsed["family_id"] == str(family_id)
        assert parsed["event"]["message_id"] == "m-2"
        assert isinstance(parsed["event_id"], str) and parsed["event_id"]

        loop.call_soon(loop.stop)
        loop.run_forever()
        assert queue.qsize() == 1
        assert queue.get_nowait()["message_id"] == "m-2"

        # Loopback of the same event_id from PG LISTEN must be deduplicated
        assert _handle_pg_notification(emitted[0]) is False
    finally:
        with _subscribers_lock:
            subs = _chat_subscribers.get(family_id)
            if subs and entry in subs:
                subs.remove(entry)
            if subs is not None and not subs:
                _chat_subscribers.pop(family_id, None)
        loop.close()
