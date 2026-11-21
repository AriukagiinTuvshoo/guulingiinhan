"""Family scoped fund and gathering MVP using manual bank transfer confirmation."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    AuditLog,
    Donation,
    EventRegistration,
    Family,
    FamilyEvent,
    FamilyFund,
    FamilyMember,
    User,
)

router = APIRouter(prefix="/families/{family_id}", tags=["family activities"])
public_funds_router = APIRouter(prefix="/public/funds", tags=["public family funds"])


def _member(db: Session, family_id: UUID, user: User, roles: set[str] | None = None) -> str:
    family = db.get(Family, family_id)
    membership = db.scalar(select(FamilyMember).where(
        FamilyMember.family_id == family_id, FamilyMember.user_id == user.id,
    ))
    if family is None or family.archived_at is not None or membership is None:
        raise HTTPException(status_code=404, detail="Гэр бүлийн орчин олдсонгүй.")
    if roles and membership.role not in roles:
        raise HTTPException(status_code=403, detail="Энэ үйлдэлд эрх хүрэхгүй.")
    return membership.role


def _audit(db: Session, user: User, family_id: UUID, action: str, kind: str, target_id: UUID) -> None:
    db.add(AuditLog(actor_id=user.id, family_id=family_id, action=action,
                    target_type=kind, target_id=target_id))


def _commit(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail=message) from error


def _currency(value: str) -> str:
    code = value.strip().upper()
    if len(code) != 3 or not code.isascii() or not code.isalpha():
        raise ValueError("Валютын код ISO хэлбэртэй 3 үсэг байна.")
    return code


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        raise ValueError("Огноонд цагийн бүс шаардлагатай.")
    return value


class FundCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=180)
    purpose: str = Field(min_length=1, max_length=4000)
    currency: str = "MNT"
    payment_instruction: str = Field(min_length=1, max_length=4000)
    visibility: str = Field(default="family", pattern="^(family|public)$")

    @field_validator("currency")
    @classmethod
    def currency_code(cls, value: str) -> str:
        return _currency(value)


class FundOut(BaseModel):
    id: UUID
    family_id: UUID
    title: str
    purpose: str
    currency: str
    payment_instruction: str
    visibility: str = "family"
    is_active: bool
    created_at: datetime


class PublicFundOut(FundOut):
    family_name: str


class DonationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_minor: int = Field(gt=0, le=100_000_000_000)
    private_donor: bool = False


class DonationOut(BaseModel):
    id: UUID
    fund_id: UUID
    amount_minor: int
    currency: str
    status: str
    donor_name: str | None
    private_donor: bool
    created_at: datetime


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=12000)
    starts_at: datetime
    location: str = Field(min_length=1, max_length=300)
    registration_deadline: datetime | None = None
    capacity: int | None = Field(default=None, gt=0, le=100000)
    adult_fee_minor: int = Field(default=0, ge=0, le=100_000_000_000)
    child_fee_minor: int = Field(default=0, ge=0, le=100_000_000_000)
    currency: str = "MNT"
    payment_instruction: str = Field(default="", max_length=4000)

    @field_validator("starts_at", "registration_deadline")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        return _aware(value)

    @field_validator("currency")
    @classmethod
    def currency_code(cls, value: str) -> str:
        return _currency(value)

    @model_validator(mode="after")
    def deadline_before_event(self):
        if self.registration_deadline and self.registration_deadline > self.starts_at:
            raise ValueError("Бүртгэлийн хугацаа арга хэмжээний өдрөөс хойш байж болохгүй.")
        return self


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    family_id: UUID
    title: str
    description: str
    starts_at: datetime
    location: str
    registration_deadline: datetime | None
    capacity: int | None
    adult_fee_minor: int
    child_fee_minor: int
    currency: str
    payment_instruction: str


class RegistrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    adult_count: int = Field(default=1, ge=0, le=30)
    child_count: int = Field(default=0, ge=0, le=30)

    @model_validator(mode="after")
    def at_least_one(self):
        if self.adult_count + self.child_count == 0:
            raise ValueError("Дор хаяж нэг оролцогч бүртгэнэ үү.")
        return self


class RegistrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    event_id: UUID
    user_id: UUID
    adult_count: int
    child_count: int
    status: str
    payment_status: str
    created_at: datetime


def _fund_out(fund: FamilyFund) -> FundOut:
    return FundOut(id=fund.id, family_id=fund.family_id, title=fund.title,
                   purpose=fund.purpose, currency=fund.currency,
                   payment_instruction=fund.payment_instruction,
                   visibility=fund.visibility, is_active=fund.is_active,
                   created_at=fund.created_at)


@public_funds_router.get("", response_model=list[PublicFundOut])
def list_public_funds(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Expose only active funds explicitly published to the authenticated community."""
    rows = db.execute(
        select(FamilyFund, Family.name)
        .join(Family, Family.id == FamilyFund.family_id)
        .where(
            FamilyFund.visibility == "public",
            FamilyFund.is_active.is_(True),
            Family.archived_at.is_(None),
        )
        .order_by(FamilyFund.created_at.desc(), FamilyFund.id)
        .limit(100)
    ).all()
    return [PublicFundOut(**_fund_out(fund).model_dump(), family_name=family_name)
            for fund, family_name in rows]


def _event_out(event: FamilyEvent) -> EventOut:
    return EventOut.model_validate(event)


def _registration_out(row: EventRegistration) -> RegistrationOut:
    return RegistrationOut.model_validate(row)


@router.get("/funds", response_model=list[FundOut])
def list_funds(family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = _member(db, family_id, user)
    query = select(FamilyFund).where(FamilyFund.family_id == family_id)
    if role != "owner":
        query = query.where(FamilyFund.is_active.is_(True))
    rows = db.scalars(query.order_by(FamilyFund.created_at.desc(), FamilyFund.id)).all()
    return [_fund_out(row) for row in rows]


@router.post("/funds", response_model=FundOut, status_code=status.HTTP_201_CREATED)
def create_fund(family_id: UUID, body: FundCreate,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner"})
    fund = FamilyFund(family_id=family_id, title=body.title.strip(), purpose=body.purpose.strip(),
                      currency=body.currency, payment_instruction=body.payment_instruction.strip(),
                      visibility=body.visibility,
                      created_by=user.id)
    db.add(fund)
    db.flush()
    _audit(db, user, family_id, "fund.created", "family_fund", fund.id)
    db.commit()
    return _fund_out(fund)


@router.patch("/funds/{fund_id}/status", response_model=FundOut)
def set_fund_status(family_id: UUID, fund_id: UUID, is_active: bool,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner"})
    fund = db.scalar(select(FamilyFund).where(FamilyFund.id == fund_id,
                                              FamilyFund.family_id == family_id))
    if fund is None:
        raise HTTPException(status_code=404, detail="Гэр бүлийн сан олдсонгүй.")
    fund.is_active = is_active
    _audit(db, user, family_id, "fund.activated" if is_active else "fund.deactivated", "family_fund", fund.id)
    db.commit()
    return _fund_out(fund)


@router.post("/funds/{fund_id}/donations", response_model=DonationOut, status_code=status.HTTP_201_CREATED)
def create_donation(family_id: UUID, fund_id: UUID, body: DonationCreate,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    fund = db.scalar(select(FamilyFund).where(FamilyFund.id == fund_id,
                                              FamilyFund.family_id == family_id,
                                              FamilyFund.is_active.is_(True)))
    if fund is None:
        raise HTTPException(status_code=404, detail="Идэвхтэй сан олдсонгүй.")
    row = Donation(family_id=family_id, fund_id=fund.id, donor_user_id=user.id,
                   amount_minor=body.amount_minor, currency=fund.currency,
                   private_donor=body.private_donor, status="pledged")
    db.add(row)
    db.flush()
    _audit(db, user, family_id, "donation.pledged", "donation", row.id)
    db.commit()
    return DonationOut(id=row.id, fund_id=row.fund_id, amount_minor=row.amount_minor,
                       currency=row.currency, status=row.status,
                       donor_name=None if row.private_donor else user.display_name,
                       private_donor=row.private_donor, created_at=row.created_at)


@router.get("/funds/{fund_id}/donations", response_model=list[DonationOut])
def list_donations(family_id: UUID, fund_id: UUID,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = _member(db, family_id, user)
    if db.scalar(select(FamilyFund.id).where(FamilyFund.id == fund_id,
                                             FamilyFund.family_id == family_id)) is None:
        raise HTTPException(status_code=404, detail="Сан олдсонгүй.")
    query = select(Donation, User).join(User, User.id == Donation.donor_user_id).where(
        Donation.family_id == family_id, Donation.fund_id == fund_id,
    )
    if role != "owner":
        query = query.where(Donation.donor_user_id == user.id)
    rows = db.execute(query.order_by(Donation.created_at.desc(), Donation.id)).all()
    return [DonationOut(id=d.id, fund_id=d.fund_id, amount_minor=d.amount_minor,
                        currency=d.currency, status=d.status,
                        donor_name=None if d.private_donor else donor.display_name,
                        private_donor=d.private_donor, created_at=d.created_at)
            for d, donor in rows]


@router.post("/funds/{fund_id}/donations/{donation_id}/report", response_model=DonationOut)
def report_donation(family_id: UUID, fund_id: UUID, donation_id: UUID,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    row = db.scalar(select(Donation).where(Donation.id == donation_id,
                                           Donation.family_id == family_id,
                                           Donation.fund_id == fund_id,
                                           Donation.donor_user_id == user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Төлбөрийн хүсэлт олдсонгүй.")
    if row.status != "pledged":
        raise HTTPException(status_code=409, detail="Зөвхөн хүлээгдэж буй төлбөрийг мэдээлнэ.")
    row.status = "reported"
    _audit(db, user, family_id, "donation.payment_reported", "donation", row.id)
    db.commit()
    return DonationOut(id=row.id, fund_id=row.fund_id, amount_minor=row.amount_minor,
                       currency=row.currency, status=row.status, donor_name=None,
                       private_donor=row.private_donor, created_at=row.created_at)


@router.post("/funds/{fund_id}/donations/{donation_id}/confirm", response_model=DonationOut)
def confirm_donation(family_id: UUID, fund_id: UUID, donation_id: UUID,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner"})
    row = db.scalar(select(Donation).where(Donation.id == donation_id,
                                           Donation.family_id == family_id,
                                           Donation.fund_id == fund_id).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Төлбөрийн хүсэлт олдсонгүй.")
    if row.status != "reported":
        raise HTTPException(status_code=409, detail="Гишүүн төлбөр хийснээ эхлээд мэдээлсэн байх ёстой.")
    row.status = "confirmed"
    row.confirmed_by = user.id
    row.confirmed_at = datetime.now(UTC)
    _audit(db, user, family_id, "donation.payment_confirmed", "donation", row.id)
    db.commit()
    return DonationOut(id=row.id, fund_id=row.fund_id, amount_minor=row.amount_minor,
                       currency=row.currency, status=row.status, donor_name=None,
                       private_donor=row.private_donor, created_at=row.created_at)


@router.get("/events", response_model=list[EventOut])
def list_events(family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    rows = db.scalars(select(FamilyEvent).where(FamilyEvent.family_id == family_id)
                      .order_by(FamilyEvent.starts_at.desc(), FamilyEvent.id)).all()
    return [_event_out(row) for row in rows]


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(family_id: UUID, body: EventCreate,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner", "editor"})
    event = FamilyEvent(family_id=family_id, title=body.title.strip(),
                        description=body.description.strip(), starts_at=body.starts_at,
                        location=body.location.strip(), registration_deadline=body.registration_deadline,
                        capacity=body.capacity, adult_fee_minor=body.adult_fee_minor,
                        child_fee_minor=body.child_fee_minor, currency=body.currency,
                        payment_instruction=body.payment_instruction.strip(), created_by=user.id)
    db.add(event)
    db.flush()
    _audit(db, user, family_id, "family_event.created", "family_event", event.id)
    db.commit()
    return _event_out(event)


@router.post("/events/{event_id}/registrations", response_model=RegistrationOut,
             status_code=status.HTTP_201_CREATED)
def register_event(family_id: UUID, event_id: UUID, body: RegistrationCreate,
                   response: Response,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    event = db.scalar(select(FamilyEvent).where(FamilyEvent.id == event_id,
                                                FamilyEvent.family_id == family_id).with_for_update())
    if event is None:
        raise HTTPException(status_code=404, detail="Арга хэмжээ олдсонгүй.")
    now = datetime.now(UTC)
    deadline = event.registration_deadline
    if deadline is not None and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    if deadline and deadline <= now:
        raise HTTPException(status_code=409, detail="Бүртгэлийн хугацаа дууссан байна.")
    existing = db.scalar(select(EventRegistration).where(
        EventRegistration.event_id == event_id, EventRegistration.user_id == user.id,
    ).with_for_update())
    if existing is not None and existing.status == "registered":
        raise HTTPException(status_code=409, detail="Та энэ арга хэмжээнд аль хэдийн бүртгүүлсэн байна.")
    if event.capacity is not None:
        occupied = db.scalar(select(func.coalesce(func.sum(
            EventRegistration.adult_count + EventRegistration.child_count
        ), 0)).where(EventRegistration.event_id == event_id,
                     EventRegistration.status == "registered")) or 0
        if occupied + body.adult_count + body.child_count > event.capacity:
            raise HTTPException(status_code=409, detail="Арга хэмжээний сул суудал хүрэлцэхгүй байна.")
    if existing is None:
        row = EventRegistration(event_id=event_id, user_id=user.id,
                                adult_count=body.adult_count, child_count=body.child_count)
        db.add(row)
    else:
        row = existing
        row.adult_count = body.adult_count
        row.child_count = body.child_count
        row.status = "registered"
        row.payment_status = "unpaid"
        row.confirmed_by = None
        response.status_code = status.HTTP_200_OK
    db.flush()
    _audit(db, user, family_id, "family_event.registered", "event_registration", row.id)
    _commit(db, "Та энэ арга хэмжээнд аль хэдийн бүртгүүлсэн байна.")
    return _registration_out(row)


@router.get("/events/{event_id}/registrations", response_model=list[RegistrationOut])
def list_registrations(family_id: UUID, event_id: UUID,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner", "editor"})
    if db.scalar(select(FamilyEvent.id).where(FamilyEvent.id == event_id,
                                              FamilyEvent.family_id == family_id)) is None:
        raise HTTPException(status_code=404, detail="Арга хэмжээ олдсонгүй.")
    rows = db.scalars(select(EventRegistration).where(EventRegistration.event_id == event_id)
                      .order_by(EventRegistration.created_at, EventRegistration.id)).all()
    return [_registration_out(row) for row in rows]


@router.get("/events/{event_id}/registrations/me", response_model=RegistrationOut)
def get_my_registration(family_id: UUID, event_id: UUID,
                        user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    row = db.scalar(select(EventRegistration).join(FamilyEvent).where(
        EventRegistration.event_id == event_id, EventRegistration.user_id == user.id,
        FamilyEvent.id == event_id, FamilyEvent.family_id == family_id,
    ))
    if row is None:
        raise HTTPException(status_code=404, detail="Бүртгэл олдсонгүй.")
    return _registration_out(row)


@router.post("/events/{event_id}/registrations/me/cancel", status_code=204)
def cancel_registration(family_id: UUID, event_id: UUID,
                        user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    row = db.scalar(select(EventRegistration).join(FamilyEvent).where(
        EventRegistration.event_id == event_id, EventRegistration.user_id == user.id,
        EventRegistration.status == "registered", FamilyEvent.id == event_id,
        FamilyEvent.family_id == family_id,
    ))
    if row is None:
        raise HTTPException(status_code=404, detail="Идэвхтэй бүртгэл олдсонгүй.")
    if row.payment_status != "unpaid":
        raise HTTPException(status_code=409, detail="Төлбөрийн шилжүүлгийг зохицуулагчтай шийдсэний дараа цуцална уу.")
    row.status = "cancelled"
    _audit(db, user, family_id, "family_event.registration_cancelled", "event_registration", row.id)
    db.commit()


@router.post("/events/{event_id}/registrations/me/report-payment", response_model=RegistrationOut)
def report_event_payment(family_id: UUID, event_id: UUID,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    row = db.scalar(select(EventRegistration).join(FamilyEvent).where(
        EventRegistration.event_id == event_id, EventRegistration.user_id == user.id,
        EventRegistration.status == "registered", FamilyEvent.id == event_id,
        FamilyEvent.family_id == family_id,
    ))
    if row is None:
        raise HTTPException(status_code=404, detail="Идэвхтэй бүртгэл олдсонгүй.")
    if row.payment_status != "unpaid":
        raise HTTPException(status_code=409, detail="Төлбөрийн төлөв аль хэдийн шинэчлэгдсэн байна.")
    row.payment_status = "reported"
    _audit(db, user, family_id, "family_event.payment_reported", "event_registration", row.id)
    db.commit()
    return _registration_out(row)


@router.post("/events/{event_id}/registrations/{registration_id}/confirm-payment",
             response_model=RegistrationOut)
def confirm_event_payment(family_id: UUID, event_id: UUID, registration_id: UUID,
                          user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner", "editor"})
    row = db.scalar(select(EventRegistration).join(FamilyEvent).where(
        EventRegistration.id == registration_id, EventRegistration.event_id == event_id,
        FamilyEvent.id == event_id, FamilyEvent.family_id == family_id,
    ).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Бүртгэл олдсонгүй.")
    if row.status != "registered" or row.payment_status != "reported":
        raise HTTPException(status_code=409, detail="Гишүүн төлбөр хийснээ эхлээд мэдээлсэн байх ёстой.")
    row.payment_status = "confirmed"
    row.confirmed_by = user.id
    _audit(db, user, family_id, "family_event.payment_confirmed", "event_registration", row.id)
    db.commit()
    return _registration_out(row)
