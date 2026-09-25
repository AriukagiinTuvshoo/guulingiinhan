from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db import Base


def now_utc() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True, nullable=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (Index("ix_user_sessions_expires_at", "expires_at"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class LoginIdentity(Base):
    """An authentication identifier owned by an account, never by a Person."""

    __tablename__ = "login_identities"
    __table_args__ = (
        CheckConstraint("provider IN ('email', 'phone', 'google')", name="ck_identity_provider"),
        CheckConstraint(
            "(provider IN ('email', 'phone') AND normalized_identifier IS NOT NULL "
            "AND normalized_identifier <> '' "
            "AND issuer IS NULL AND subject IS NULL) OR "
            "(provider = 'google' AND normalized_identifier IS NULL "
            "AND issuer IS NOT NULL AND issuer <> '' "
            "AND subject IS NOT NULL AND subject <> '')",
            name="ck_identity_provider_fields",
        ),
        Index(
            "uq_identity_provider_identifier",
            "provider",
            "normalized_identifier",
            unique=True,
            sqlite_where=text("provider IN ('email', 'phone')"),
            postgresql_where=text("provider IN ('email', 'phone')"),
        ),
        Index(
            "uq_identity_google_subject",
            "provider",
            "issuer",
            "subject",
            unique=True,
            sqlite_where=text("provider = 'google'"),
            postgresql_where=text("provider = 'google'"),
        ),
        Index("ix_login_identity_user", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    normalized_identifier: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_identifier: Mapped[str | None] = mapped_column(String(320), nullable=True)
    issuer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class IdentityLinkRequest(Base):
    """Unverified intent only; it grants no login or identity ownership."""

    __tablename__ = "identity_link_requests"
    __table_args__ = (
        CheckConstraint(
            "provider IN ('email', 'phone', 'google')", name="ck_identity_link_provider"
        ),
        CheckConstraint(
            "status IN ('pending', 'consumed', 'expired', 'cancelled')",
            name="ck_identity_link_status",
        ),
        CheckConstraint(
            "(provider IN ('email', 'phone') AND normalized_identifier IS NOT NULL "
            "AND normalized_identifier <> '' AND issuer IS NULL AND subject IS NULL) OR "
            "(provider = 'google' AND normalized_identifier IS NULL "
            "AND issuer IS NOT NULL AND issuer <> '' "
            "AND subject IS NOT NULL AND subject <> '')",
            name="ck_identity_link_provider_fields",
        ),
        CheckConstraint(
            "(status = 'consumed' AND consumed_at IS NOT NULL) OR "
            "(status <> 'consumed' AND consumed_at IS NULL)",
            name="ck_identity_link_consumed_state",
        ),
        Index("ix_identity_link_user_created", "user_id", "created_at"),
        Index("ix_identity_link_expiry", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    normalized_identifier: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_identifier: Mapped[str | None] = mapped_column(String(320), nullable=True)
    issuer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="pending", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint("role IN ('editor', 'member')", name="ck_invitation_role"),
        Index("ix_invitation_family_email", "family_id", "invited_email"),
        Index("ix_invitation_expiry", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"))
    invited_email: Mapped[str] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"
    __table_args__ = (
        Index("ix_email_verification_user_created", "user_id", "created_at"),
        Index("ix_email_verification_created", "created_at"),
        Index("ix_email_verification_expiry", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        Index("ix_password_reset_user_created", "user_id", "created_at"),
        Index("ix_password_reset_created", "created_at"),
        Index("ix_password_reset_expiry", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class LoginThrottle(Base):
    __tablename__ = "login_throttles"

    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(default=0)


class PhoneOtpChallenge(Base):
    __tablename__ = "phone_otp_challenges"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('phone_link', 'phone_login', 'phone_registration', 'password_recovery')",
            name="ck_phone_otp_purpose",
        ),
        CheckConstraint(
            "status IN ('pending', 'consumed', 'expired', 'locked', 'superseded')",
            name="ck_phone_otp_status",
        ),
        CheckConstraint("attempt_count >= 0 AND max_attempts > 0", name="ck_phone_otp_attempts"),
        Index("ix_phone_otp_phone_purpose_created", "phone_e164", "purpose", "created_at"),
        Index("ix_phone_otp_expiry", "expires_at"),
        Index("ix_phone_otp_user_created", "user_id", "created_at"),
        Index(
            "uq_phone_otp_pending",
            "phone_e164",
            "purpose",
            unique=True,
            sqlite_where=text("status = 'pending'"),
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    phone_e164: Mapped[str] = mapped_column(String(16), nullable=False)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="pending", nullable=False)
    attempt_count: Mapped[int] = mapped_column(default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(default=5, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    request_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_family_created", "family_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("families.id", ondelete="SET NULL"), nullable=True
    )
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(String(60))
    target_type: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Family(Base):
    __tablename__ = "families"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_photo_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Lineage(Base):
    """An explicit ancestral/descent lineage within one Family."""

    __tablename__ = "lineages"
    __table_args__ = (
        UniqueConstraint("family_id", "name", name="uq_lineage_family_name"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class Branch(Base):
    """An explicit subdivision/path within one Lineage."""

    __tablename__ = "branches"
    __table_args__ = (
        UniqueConstraint("lineage_id", "name", name="uq_branch_lineage_name"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    lineage_id: Mapped[UUID] = mapped_column(
        ForeignKey("lineages.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class PersonLineageAssignment(Base):
    """The one current explicit lineage/branch assignment for a Person."""

    __tablename__ = "person_lineage_assignments"
    __table_args__ = (
        UniqueConstraint("person_id", name="uq_person_lineage_assignment_person"),
        Index("ix_person_lineage_assignment_lineage", "lineage_id"),
        Index("ix_person_lineage_assignment_branch", "branch_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    lineage_id: Mapped[UUID] = mapped_column(ForeignKey("lineages.id", ondelete="CASCADE"))
    branch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class FamilyMember(Base):
    __tablename__ = "family_members"
    __table_args__ = (
        UniqueConstraint("family_id", "user_id", name="uq_family_member_user"),
        CheckConstraint("role IN ('owner', 'editor', 'member')", name="ck_family_member_role"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Person(Base):
    __tablename__ = "persons"
    __table_args__ = (
        CheckConstraint(
            "gender IN ('female', 'male', 'other', 'unknown')", name="ck_person_gender"
        ),
        CheckConstraint(
            "visibility IN ('private', 'family', 'public')", name="ck_person_visibility"
        ),
        Index(
            "ix_person_search_first",
            "search_first_name",
            postgresql_ops={"search_first_name": "text_pattern_ops"},
        ),
        Index(
            "ix_person_search_last",
            "search_last_name",
            postgresql_ops={"search_last_name": "text_pattern_ops"},
        ),
        Index(
            "ix_person_search_middle",
            "search_middle_name",
            postgresql_ops={"search_middle_name": "text_pattern_ops"},
        ),
        Index("ix_person_birth_date", "birth_date"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    first_name: Mapped[str] = mapped_column(String(120))
    last_name: Mapped[str] = mapped_column(String(120), default="")
    middle_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gender: Mapped[str] = mapped_column(String(12), default="unknown")
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    birth_date_note: Mapped[str | None] = mapped_column(String(80), nullable=True)
    birth_place: Mapped[str | None] = mapped_column(String(240), nullable=True)
    is_alive: Mapped[bool] = mapped_column(default=True)
    death_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    death_place: Mapped[str | None] = mapped_column(String(240), nullable=True)
    death_cause: Mapped[str | None] = mapped_column(String(500), nullable=True)
    profile_photo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    short_description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    visibility: Mapped[str] = mapped_column(String(12), default="family")
    search_first_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    search_last_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    search_middle_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class FamilyPerson(Base):
    __tablename__ = "family_persons"
    __table_args__ = (UniqueConstraint("family_id", "person_id", name="uq_family_person"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    person_id: Mapped[UUID] = mapped_column(
        ForeignKey("persons.id", ondelete="CASCADE"), index=True
    )
    added_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class UserPersonLink(Base):
    """Optional account-to-tree-person link; historical people need no account."""

    __tablename__ = "user_person_links"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_person_user"),
        UniqueConstraint("person_id", name="uq_user_person_person"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    linked_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PersonGuardianship(Base):
    """Explicit, revocable authorization scoped to one person in one family."""

    __tablename__ = "person_guardianships"
    __table_args__ = (
        ForeignKeyConstraint(
            ["family_id", "person_id"],
            ["family_persons.family_id", "family_persons.person_id"],
            ondelete="CASCADE",
            name="fk_guardianship_family_person",
        ),
        ForeignKeyConstraint(
            ["family_id", "guardian_user_id"],
            ["family_members.family_id", "family_members.user_id"],
            ondelete="CASCADE",
            name="fk_guardianship_family_member",
        ),
        CheckConstraint(
            "scope IN ('view_profile', 'edit_profile', 'manage_biography', "
            "'manage_events', 'manage_memories', 'manage_media')",
            name="ck_guardianship_scope",
        ),
        CheckConstraint("status IN ('active', 'revoked')", name="ck_guardianship_status"),
        CheckConstraint(
            "(status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR "
            "(status = 'revoked' AND revoked_at IS NOT NULL)",
            name="ck_guardianship_revocation_state",
        ),
        Index(
            "uq_guardianship_active_scope",
            "family_id",
            "person_id",
            "guardian_user_id",
            "scope",
            unique=True,
            sqlite_where=text("status = 'active' AND revoked_at IS NULL"),
            postgresql_where=text("status = 'active' AND revoked_at IS NULL"),
        ),
        Index(
            "ix_guardianship_scope_lookup",
            "family_id",
            "person_id",
            "guardian_user_id",
            "status",
        ),
        Index("ix_guardianship_guardian_user", "guardian_user_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    person_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    guardian_user_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="active", nullable=False)
    granted_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ParentChildRelationship(Base):
    __tablename__ = "parent_child_relationships"
    __table_args__ = (
        UniqueConstraint("parent_id", "child_id", name="uq_parent_child"),
        CheckConstraint("parent_id <> child_id", name="ck_parent_child_not_self"),
        CheckConstraint(
            "relationship_type IN ('biological', 'adoptive')", name="ck_parent_child_type"
        ),
        Index("ix_parent_child_child", "child_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    parent_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    child_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    relationship_type: Mapped[str] = mapped_column(String(16), default="biological")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Marriage(Base):
    __tablename__ = "marriages"
    __table_args__ = (
        CheckConstraint("person_1_id < person_2_id", name="ck_marriage_canonical_order"),
        CheckConstraint("status IN ('married', 'divorced', 'widowed')", name="ck_marriage_status"),
        CheckConstraint("person_1_id <> person_2_id", name="ck_marriage_not_self"),
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="ck_marriage_dates",
        ),
        Index(
            "uq_marriage_pair_active",
            "person_1_id",
            "person_2_id",
            unique=True,
            sqlite_where=text("status = 'married' AND deleted_at IS NULL"),
            postgresql_where=text("status = 'married' AND deleted_at IS NULL"),
        ),
        Index("ix_marriage_person_1_start", "person_1_id", "start_date", "created_at"),
        Index("ix_marriage_person_2_start", "person_2_id", "start_date", "created_at"),
        Index("ix_marriage_person_2", "person_2_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    person_1_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    person_2_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(12), default="married")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location: Mapped[str | None] = mapped_column(String(240), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Biography(Base):
    __tablename__ = "biographies"
    __table_args__ = (UniqueConstraint("person_id", name="uq_biography_person"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class LifeEvent(Base):
    __tablename__ = "life_events"
    __table_args__ = (Index("ix_life_event_person_date", "person_id", "event_date"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(
        ForeignKey("persons.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(180))
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_note: Mapped[str | None] = mapped_column(String(80), nullable=True)
    location: Mapped[str | None] = mapped_column(String(240), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class Story(Base):
    __tablename__ = "stories"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_story_family"),
        CheckConstraint(
            "visibility IN ('private', 'family', 'public')",
            name="ck_story_visibility",
        ),
        Index("ix_story_family_created", "family_id", "created_at"),
        Index("ix_story_family_event_date", "family_id", "event_date"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    place: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    visibility: Mapped[str] = mapped_column(String(12), default="family")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class StoryPerson(Base):
    __tablename__ = "story_persons"
    __table_args__ = (
        UniqueConstraint("story_id", "person_id", name="uq_story_person"),
        ForeignKeyConstraint(
            ["story_id", "family_id"],
            ["stories.id", "stories.family_id"],
            name="fk_story_person_story_family",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["family_id", "person_id"],
            ["family_persons.family_id", "family_persons.person_id"],
            name="fk_story_person_family_person",
            ondelete="CASCADE",
        ),
        Index("ix_story_person_family_id", "family_id"),
        Index("ix_story_person_person", "person_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    story_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    family_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    person_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)


class Archive(Base):
    """A family source/document record kept separate from stories and memories."""

    __tablename__ = "archives"
    __table_args__ = (
        UniqueConstraint("id", "family_id", name="uq_archive_family"),
        CheckConstraint(
            "visibility IN ('private', 'family', 'public')",
            name="ck_archive_visibility",
        ),
        Index("ix_archive_family_created", "family_id", "created_at"),
        Index("ix_archive_family_document_date", "family_id", "document_date"),
        Index("ix_archive_family_title", "family_id", "title"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    place: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    visibility: Mapped[str] = mapped_column(String(12), default="family")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class ArchivePerson(Base):
    __tablename__ = "archive_persons"
    __table_args__ = (
        UniqueConstraint("archive_id", "person_id", name="uq_archive_person"),
        ForeignKeyConstraint(
            ["archive_id", "family_id"],
            ["archives.id", "archives.family_id"],
            name="fk_archive_person_archive_family",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["family_id", "person_id"],
            ["family_persons.family_id", "family_persons.person_id"],
            name="fk_archive_person_family_person",
            ondelete="CASCADE",
        ),
        Index("ix_archive_person_family_id", "family_id"),
        Index("ix_archive_person_person", "person_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    archive_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    family_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    person_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    memory_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    visibility: Mapped[str] = mapped_column(String(12), default="family")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class MemoryPersonTag(Base):
    __tablename__ = "memory_person_tags"
    __table_args__ = (UniqueConstraint("memory_id", "person_id", name="uq_memory_person_tag"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    memory_id: Mapped[UUID] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"))
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))


class Photo(Base):
    __tablename__ = "photos"
    __table_args__ = (
        Index("ix_photo_memory_created", "memory_id", "created_at"),
        Index("ix_photo_family_storage_status", "family_id", "storage_status", "created_at"),
        CheckConstraint(
            "storage_status IN ('uploading', 'ready', 'deletion_pending')",
            name="ck_photo_storage_status",
        ),
        CheckConstraint(
            "cleanup_attempts >= 0 AND cleanup_attempts <= 20",
            name="ck_photo_cleanup_attempts",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    family_id: Mapped[UUID] = mapped_column(
        ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    memory_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("memories.id", ondelete="SET NULL"), nullable=True
    )
    object_key: Mapped[str] = mapped_column(String(500))
    thumbnail_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[str] = mapped_column(String(255), default="photo")
    mime_type: Mapped[str] = mapped_column(String(80), default="image/jpeg")
    file_size: Mapped[int] = mapped_column(default=0)
    storage_status: Mapped[str] = mapped_column(
        String(20), default="ready", server_default=text("'ready'")
    )
    cleanup_attempts: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    title: Mapped[str | None] = mapped_column(String(180), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PhotoPersonTag(Base):
    __tablename__ = "photo_person_tags"
    __table_args__ = (
        UniqueConstraint("photo_id", "person_id", name="uq_photo_person_tag"),
        Index("ix_photo_person_tag_person", "person_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    photo_id: Mapped[UUID] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"))
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
