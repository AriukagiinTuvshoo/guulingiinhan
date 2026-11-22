"""Family Messenger / Real-Time Family Chat endpoints with Server-Sent Events (SSE)."""

import asyncio
import json
import logging
import threading
from collections import defaultdict, deque
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import engine, get_db
from app.families import _audit, _can_manage_content, _member
from app.models import (
    ChatMessage,
    FamilyMember,
    FamilyPerson,
    Person,
    User,
    UserPersonLink,
)

router = APIRouter(tags=["family chat"])
logger = logging.getLogger("guulingiinhan.chat")

CHAT_NOTIFY_CHANNEL = "guulin_chat_events"
CHAT_NOTIFY_MAX_BYTES = 7500

_subscribers_lock = threading.Lock()
_chat_subscribers: dict[
    UUID, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]]
] = defaultdict(list)
_seen_event_ids: deque[str] = deque(maxlen=512)

_pg_listener_lock = threading.Lock()
_pg_listener_stop: threading.Event | None = None
_pg_listener_thread: threading.Thread | None = None
_pg_listener_conn: Any = None


def active_sse_subscriber_count() -> int:
    """Return total active in-process SSE chat subscriber connections."""
    with _subscribers_lock:
        return sum(len(subs) for subs in _chat_subscribers.values())


def _psycopg_conninfo(database_url: str) -> str | None:
    """Return a psycopg3-compatible PostgreSQL DSN or None for non-PostgreSQL URLs."""
    url = database_url.strip()
    if url.startswith("postgresql+psycopg://"):
        return "postgresql://" + url.removeprefix("postgresql+psycopg://")
    if url.startswith(("postgresql://", "postgres://")):
        return url
    return None


def _dispatch_local_chat_event(family_id: UUID, event_payload: dict[str, Any]) -> None:
    """Deliver a chat event to local in-process SSE subscribers."""
    with _subscribers_lock:
        targets = list(_chat_subscribers.get(family_id, ()))
    for loop, queue in targets:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event_payload)
        except RuntimeError:
            continue


def _record_event_id(event_id: str) -> bool:
    """Record a seen event_id and return True only if it has not been seen recently."""
    with _subscribers_lock:
        if event_id in _seen_event_ids:
            return False
        _seen_event_ids.append(event_id)
        return True


def _handle_pg_notification(raw_payload: str) -> bool:
    """Parse a PostgreSQL NOTIFY envelope and fan it out locally unless already delivered."""
    try:
        data = json.loads(raw_payload)
        if not isinstance(data, dict):
            logger.warning("Ignoring malformed chat PG notification envelope")
            return False
        event_id = data.get("event_id")
        family_id_raw = data.get("family_id")
        event = data.get("event")
        if (
            not isinstance(event_id, str)
            or not event_id
            or not isinstance(family_id_raw, str)
            or not isinstance(event, dict)
        ):
            logger.warning("Ignoring incomplete chat PG notification payload")
            return False
        family_id = UUID(family_id_raw)
    except (ValueError, TypeError, json.JSONDecodeError):
        logger.warning("Failed to parse chat PG notification payload")
        return False

    if not _record_event_id(event_id):
        return False

    _dispatch_local_chat_event(family_id, event)
    return True


def _emit_pg_notify(envelope_json: str, db: Session | None = None) -> bool:
    """Publish a chat notification over PostgreSQL NOTIFY when running on Postgres."""
    bind = db.get_bind() if db is not None else engine
    if bind is None or bind.dialect.name != "postgresql":
        return False
    connect_target = bind.engine if isinstance(bind, Connection) else bind
    if len(envelope_json.encode("utf-8")) > CHAT_NOTIFY_MAX_BYTES:
        logger.warning("Chat PG notification payload exceeds safe byte limit")
        return False
    try:
        with connect_target.connect() as conn:
            conn.execute(
                text("SELECT pg_notify(:channel, :payload)"),
                {"channel": CHAT_NOTIFY_CHANNEL, "payload": envelope_json},
            )
            conn.commit()
        return True
    except Exception as error:  # noqa: BLE001 - notification failure never breaks persisted chat write
        logger.warning(
            "Failed to emit chat PG notification",
            extra={"event": "chat_pg_notify_failed", "error_type": type(error).__name__},
        )
        return False


def publish_chat_event(
    family_id: UUID,
    event_payload: dict[str, Any],
    db: Session | None = None,
) -> None:
    """Broadcast a real-time chat notification locally and across PostgreSQL workers."""
    event_id = uuid4().hex
    _record_event_id(event_id)
    _dispatch_local_chat_event(family_id, event_payload)
    envelope_json = json.dumps(
        {
            "event_id": event_id,
            "family_id": str(family_id),
            "event": event_payload,
        },
        separators=(",", ":"),
    )
    _emit_pg_notify(envelope_json, db=db)


def _pg_listener_loop(conninfo: str, stop_event: threading.Event) -> None:
    """Background PostgreSQL LISTEN loop with exponential backoff reconnect."""
    global _pg_listener_conn
    import psycopg

    backoff = 1.0
    while not stop_event.is_set():
        conn = None
        try:
            conn = psycopg.connect(conninfo, autocommit=True)
            with _pg_listener_lock:
                if stop_event.is_set():
                    break
                _pg_listener_conn = conn
            conn.execute(f"LISTEN {CHAT_NOTIFY_CHANNEL}")
            backoff = 1.0
            while not stop_event.is_set():
                for note in conn.notifies(timeout=1.0):
                    if stop_event.is_set():
                        break
                    _handle_pg_notification(note.payload)
        except Exception as error:  # noqa: BLE001 - keep listener resilient across transient DB drops
            if not stop_event.is_set():
                logger.warning(
                    "Chat PG listener error; reconnecting",
                    extra={"event": "chat_pg_listen_retry", "error_type": type(error).__name__},
                )
        finally:
            with _pg_listener_lock:
                if _pg_listener_conn is conn:
                    _pg_listener_conn = None
            if conn is not None:
                with suppress(Exception):
                    conn.close()
        if not stop_event.is_set():
            stop_event.wait(backoff)
            backoff = min(backoff * 2.0, 15.0)


def start_chat_pg_listener(database_url: str | None = None) -> bool:
    """Start the background PostgreSQL LISTEN thread if the configured DB is PostgreSQL."""
    global _pg_listener_stop, _pg_listener_thread
    conninfo = _psycopg_conninfo(database_url or get_settings().database_url)
    if conninfo is None:
        return False
    with _pg_listener_lock:
        if _pg_listener_thread is not None and _pg_listener_thread.is_alive():
            return True
        stop_event = threading.Event()
        thread = threading.Thread(
            target=_pg_listener_loop,
            args=(conninfo, stop_event),
            name="guulin-chat-pg-listener",
            daemon=True,
        )
        _pg_listener_stop = stop_event
        _pg_listener_thread = thread
        thread.start()
    return True


def stop_chat_pg_listener() -> None:
    """Stop the background PostgreSQL LISTEN thread and close its active connection cleanly."""
    global _pg_listener_conn, _pg_listener_stop, _pg_listener_thread
    with _pg_listener_lock:
        stop_event = _pg_listener_stop
        conn = _pg_listener_conn
        thread = _pg_listener_thread
        _pg_listener_stop = None
        _pg_listener_thread = None
        _pg_listener_conn = None
    if stop_event is not None:
        stop_event.set()
    if conn is not None:
        with suppress(Exception):
            conn.close()
    if thread is not None:
        thread.join(timeout=2.0)


class ChatMessageInput(BaseModel):
    content: str = Field(max_length=4000)
    recipient_id: UUID | None = None


class ChatMessageOut(BaseModel):
    id: UUID
    family_id: UUID
    sender_id: UUID
    sender_name: str
    sender_role: str
    recipient_id: UUID | None = None
    content: str
    created_at: datetime


class ChatMemberOut(BaseModel):
    user_id: UUID
    display_name: str
    role: str
    person_id: UUID | None = None
    person_name: str | None = None


@router.get("/{family_id}/chat/members", response_model=list[ChatMemberOut])
def list_chat_members(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    rows = db.execute(
        select(
            User.id,
            User.display_name,
            FamilyMember.role,
            UserPersonLink.person_id,
            Person.first_name,
            Person.last_name,
        )
        .join(FamilyMember, FamilyMember.user_id == User.id)
        .outerjoin(
            UserPersonLink,
            and_(
                UserPersonLink.user_id == User.id,
                UserPersonLink.person_id.in_(
                    select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
                ),
            ),
        )
        .outerjoin(Person, Person.id == UserPersonLink.person_id)
        .where(FamilyMember.family_id == family_id)
        .order_by(FamilyMember.role, User.display_name)
    ).all()

    result: list[ChatMemberOut] = []
    for r in rows:
        p_name = (
            f"{r.last_name + ' ' if r.last_name else ''}{r.first_name}" if r.first_name else None
        )
        result.append(
            ChatMemberOut(
                user_id=r.id,
                display_name=r.display_name or "Гишүүн",
                role=r.role,
                person_id=r.person_id,
                person_name=p_name,
            )
        )
    return result


@router.get("/{family_id}/chat/messages", response_model=list[ChatMessageOut])
def list_chat_messages(
    family_id: UUID,
    recipient_id: UUID | None = None,
    limit: int = 60,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    capped_limit = max(1, min(limit, 100))

    query = (
        select(ChatMessage, User.display_name, FamilyMember.role)
        .join(User, User.id == ChatMessage.sender_id)
        .outerjoin(
            FamilyMember,
            and_(
                FamilyMember.family_id == ChatMessage.family_id,
                FamilyMember.user_id == ChatMessage.sender_id,
            ),
        )
        .where(ChatMessage.family_id == family_id)
    )

    if recipient_id is None:
        query = query.where(ChatMessage.recipient_id.is_(None))
    else:
        query = query.where(
            or_(
                and_(
                    ChatMessage.sender_id == user.id,
                    ChatMessage.recipient_id == recipient_id,
                ),
                and_(
                    ChatMessage.sender_id == recipient_id,
                    ChatMessage.recipient_id == user.id,
                ),
            )
        )

    try:
        with db.begin_nested():
            rows = db.execute(query.order_by(ChatMessage.created_at.desc()).limit(capped_limit)).all()
    except SQLAlchemyError:
        return []

    reversed_rows = list(reversed(rows))
    return [
        ChatMessageOut(
            id=msg.id,
            family_id=msg.family_id,
            sender_id=msg.sender_id,
            sender_name=disp or "Гишүүн",
            sender_role=role or "member",
            recipient_id=msg.recipient_id,
            content=msg.content,
            created_at=msg.created_at,
        )
        for msg, disp, role in reversed_rows
    ]


@router.get("/{family_id}/chat/stream")
async def stream_chat_events(
    family_id: UUID,
    request: Request,
    once: bool = Query(default=False, description="Emit initial frame and close (for tests)."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Server-Sent Events stream notifying family members of new or deleted chat messages."""
    _member(db, family_id, user)
    user_id_str = str(user.id)
    family_id_str = str(family_id)

    async def event_generator():
        initial = json.dumps({"status": "ok", "family_id": family_id_str})
        yield f"event: connected\ndata: {initial}\n\n"
        if once:
            return

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        entry = (loop, queue)
        with _subscribers_lock:
            _chat_subscribers[family_id].append(entry)

        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue

                rec_id = event.get("recipient_id")
                snd_id = event.get("sender_id")
                if rec_id is None or rec_id == user_id_str or snd_id == user_id_str:
                    yield f"event: chat_update\ndata: {json.dumps(event)}\n\n"
        finally:
            with _subscribers_lock:
                subs = _chat_subscribers.get(family_id)
                if subs and entry in subs:
                    subs.remove(entry)
                if subs is not None and not subs:
                    _chat_subscribers.pop(family_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{family_id}/chat/messages", response_model=ChatMessageOut)
def send_chat_message(
    family_id: UUID,
    payload: ChatMessageInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    body = payload.content.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Зурвас хоосон байж болохгүй.")

    cutoff = datetime.now(UTC) - timedelta(seconds=60)
    recent_count = (
        db.scalar(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.family_id == family_id,
                ChatMessage.sender_id == user.id,
                ChatMessage.created_at >= cutoff,
            )
        )
        or 0
    )
    if recent_count >= 30:
        raise HTTPException(
            status_code=429,
            detail="Хэт олон зурвас дараалан илгээсэн байна. Түр хүлээнэ үү.",
        )

    if payload.recipient_id is not None:
        target_member = db.scalar(
            select(FamilyMember).where(
                FamilyMember.family_id == family_id,
                FamilyMember.user_id == payload.recipient_id,
            )
        )
        if target_member is None:
            raise HTTPException(
                status_code=404, detail="Хүлээн авагч энэ гэр бүлийн гишүүн биш байна."
            )

    msg = ChatMessage(
        family_id=family_id,
        sender_id=user.id,
        recipient_id=payload.recipient_id,
        content=body[:4000],
    )
    db.add(msg)
    _audit(db, user, family_id, "chat.message_sent", "chat_message", msg.id)
    db.commit()
    db.refresh(msg)

    publish_chat_event(
        family_id,
        {
            "type": "message_created",
            "message_id": str(msg.id),
            "sender_id": str(user.id),
            "recipient_id": str(msg.recipient_id) if msg.recipient_id else None,
        },
        db=db,
    )

    return ChatMessageOut(
        id=msg.id,
        family_id=msg.family_id,
        sender_id=msg.sender_id,
        sender_name=user.display_name or (user.email or "Би"),
        sender_role=member.role,
        recipient_id=msg.recipient_id,
        content=msg.content,
        created_at=msg.created_at,
    )


@router.delete("/{family_id}/chat/messages/{message_id}", status_code=204)
def delete_chat_message(
    family_id: UUID,
    message_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    msg = db.scalar(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.family_id == family_id,
        )
    )
    if msg is None:
        raise HTTPException(status_code=404, detail="Зурвас олдсонгүй.")

    is_admin = _can_manage_content(db, member, user, msg.sender_id)
    if msg.sender_id != user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Бусдын зурвасыг устгах эрхгүй.")

    sender_id_str = str(msg.sender_id)
    recipient_id_str = str(msg.recipient_id) if msg.recipient_id else None

    _audit(db, user, family_id, "chat.message_deleted", "chat_message", msg.id)
    db.delete(msg)
    db.commit()

    publish_chat_event(
        family_id,
        {
            "type": "message_deleted",
            "message_id": str(message_id),
            "sender_id": sender_id_str,
            "recipient_id": recipient_id_str,
        },
        db=db,
    )
    return Response(status_code=204)
