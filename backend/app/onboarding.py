"""Atomic, explicit registration of the signed-in account's canonical identity."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.families import _member
from app.models import (
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    Person,
    PersonLinkRequest,
    User,
    UserPersonLink,
)
from app.person_search import normalize_search_name
from app.privacy import person_is_minor

router = APIRouter(prefix="/families", tags=["onboarding"])


class OnboardingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_key: UUID
    family_id: UUID | None = None
    family_name: str | None = Field(default=None, max_length=180)
    first_name: str | None = Field(default=None, max_length=120)
    last_name: str = Field(default="", max_length=120)
    gender: Literal["unknown", "male", "female", "other"] = "unknown"
    reuse_existing_person: bool = False

    @model_validator(mode="after")
    def trim_names(self):
        self.family_name = self.family_name.strip() if self.family_name is not None else None
        self.first_name = self.first_name.strip() if self.first_name is not None else None
        self.last_name = self.last_name.strip()
        return self


class OnboardingOutput(BaseModel):
    family_id: UUID
    person_id: UUID
    role: str
    reused: bool


def _locked_membership(db: Session, family_id: UUID, user: User) -> tuple[FamilyMember, Family]:
    _member(db, family_id, user)
    family = db.scalar(select(Family).where(Family.id == family_id).with_for_update()
                       .execution_options(populate_existing=True))
    member = db.scalar(select(FamilyMember).where(
        FamilyMember.family_id == family_id, FamilyMember.user_id == user.id,
    ).with_for_update().execution_options(populate_existing=True))
    if family is None or family.archived_at is not None or member is None:
        raise HTTPException(status_code=404, detail="Гэр бүлийн бүртгэл олдсонгүй.")
    return member, family


def _finish(
    db: Session, user: User, body: OnboardingInput, family: Family,
    person: Person, role: str, *, reused: bool,
) -> OnboardingOutput:
    # One client intent is recorded in the existing audit table. The user row lock
    # serializes retries, including requests with different keys for the same account.
    db.add(AuditLog(
        actor_id=user.id, family_id=family.id, action="onboarding.completed",
        target_type="person", target_id=person.id, request_id=str(body.request_key),
    ))
    db.commit()
    return OnboardingOutput(
        family_id=family.id, person_id=person.id, role=role, reused=reused,
    )


@router.post("/onboarding", response_model=OnboardingOutput)
def complete_onboarding(
    body: OnboardingInput, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Create self and family atomically, or explicitly reuse the account's own identity."""
    try:
        locked_user = db.scalar(select(User).where(User.id == user.id).with_for_update()
                                .execution_options(populate_existing=True))
        if locked_user is None or not locked_user.is_active:
            raise HTTPException(status_code=403, detail="Таны бүртгэл идэвхгүй байна.")
        member = family = None
        if body.family_id is not None:
            member, family = _locked_membership(db, body.family_id, user)

        link = db.scalar(select(UserPersonLink).where(
            UserPersonLink.user_id == user.id,
        ).with_for_update())
        prior = db.scalar(select(AuditLog).where(
            AuditLog.actor_id == user.id, AuditLog.action == "onboarding.completed",
            AuditLog.request_id == str(body.request_key),
        ).order_by(AuditLog.created_at, AuditLog.id).limit(1))
        if prior is not None:
            if body.family_id is not None and body.family_id != prior.family_id:
                raise HTTPException(status_code=409, detail="Энэ хүсэлтийг өөр гэр бүлд ашигласан байна.")
            if prior.family_id is None or link is None or link.person_id != prior.target_id:
                raise HTTPException(status_code=409, detail="Өмнөх бүртгэл өөрчлөгдсөн тул дахин шалгана уу.")
            prior_member, prior_family = _locked_membership(db, prior.family_id, user)
            attached = db.scalar(select(FamilyPerson.id).where(
                FamilyPerson.family_id == prior_family.id, FamilyPerson.person_id == link.person_id,
            ))
            if attached is None:
                raise HTTPException(status_code=409, detail="Хүний гэр бүлийн холбоос өөрчлөгдсөн байна.")
            return OnboardingOutput(family_id=prior_family.id, person_id=link.person_id,
                                    role=prior_member.role, reused=True)

        if link is not None:
            person = db.scalar(select(Person).where(Person.id == link.person_id).with_for_update()
                               .execution_options(populate_existing=True))
            if person is None:
                raise HTTPException(status_code=409, detail="Таны хүний бүртгэлийг дахин шалгана уу.")
            if family is None:
                existing_family_id = db.scalar(select(Family.id)
                    .join(FamilyMember, FamilyMember.family_id == Family.id)
                    .join(FamilyPerson, FamilyPerson.family_id == Family.id)
                    .where(FamilyMember.user_id == user.id, FamilyPerson.person_id == person.id,
                           Family.archived_at.is_(None))
                    .order_by(FamilyMember.joined_at, Family.id).limit(1))
                if existing_family_id is None:
                    raise HTTPException(status_code=409, detail="Өөрийн нэгдсэн гэр бүлээ сонгож, байгаа бүртгэлээ холбоно уу.")
                member, family = _locked_membership(db, existing_family_id, user)
            attached = db.scalar(select(FamilyPerson.id).where(
                FamilyPerson.family_id == family.id, FamilyPerson.person_id == person.id,
            ))
            if attached is None:
                if not body.reuse_existing_person:
                    raise HTTPException(status_code=409, detail="Та хүний бүртгэлтэй байна. Байгаа мэдээллээ энэ гэр бүлд холбохыг зөвшөөрнө үү.")
                if person.visibility == "private" or person_is_minor(person):
                    raise HTTPException(status_code=403, detail="Хувийн эсвэл насанд хүрээгүй хүний бүртгэлийг өөр гэр бүлд шууд холбох боломжгүй.")
                if not person.is_alive:
                    raise HTTPException(status_code=409, detail="Нас барсан хүний бүртгэлийг өөрийн аккаунттай холбох боломжгүй.")
                db.add(FamilyPerson(family_id=family.id, person_id=person.id, added_by=user.id))
            assert member is not None
            return _finish(db, user, body, family, person, member.role, reused=True)

        if db.scalar(select(PersonLinkRequest.id)
            .join(Family, Family.id == PersonLinkRequest.family_id)
            .join(FamilyMember, FamilyMember.family_id == Family.id).where(
            PersonLinkRequest.user_id == user.id, PersonLinkRequest.status == "pending",
            Family.archived_at.is_(None), FamilyMember.user_id == user.id,
        ).limit(1)) is not None:
            raise HTTPException(status_code=409, detail="Байгаа хүнтэй холбогдох хүсэлт хүлээгдэж байна. Гэр бүлийн эзний баталгаажуулалтыг хүлээнэ үү.")
        if not body.first_name or (family is None and not body.family_name):
            raise HTTPException(status_code=422, detail="Өөрийн нэр болон шинэ гэр бүлийн нэрийг оруулна уу.")
        if family is None:
            family = Family(name=body.family_name, created_by=user.id)
            db.add(family)
            db.flush()
            member = FamilyMember(family_id=family.id, user_id=user.id, role="owner")
            db.add(member)
        person = Person(
            first_name=body.first_name, last_name=body.last_name, gender=body.gender,
            visibility="family", is_alive=True, created_by=user.id,
            search_first_name=normalize_search_name(body.first_name),
            search_last_name=normalize_search_name(body.last_name), search_middle_name="",
        )
        db.add(person)
        db.flush()
        db.add(FamilyPerson(family_id=family.id, person_id=person.id, added_by=user.id))
        db.add(UserPersonLink(user_id=user.id, person_id=person.id, linked_by=user.id))
        assert member is not None
        return _finish(db, user, body, family, person, member.role, reused=False)
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Бүртгэл давхардсан байна. Байгаа бүртгэлээ дахин шалгана уу.") from error
