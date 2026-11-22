import hmac
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.account_photos import router as account_photos_router
from app.admin import bootstrap_admin_roles
from app.admin import router as admin_router
from app.admin_workspace import public_router as announcements_router
from app.admin_workspace import router as admin_workspace_router
from app.auth import router as auth_router
from app.community import router as community_router
from app.config import get_settings
from app.csrf import (
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    request_origin_allowed,
    valid_double_submit,
)
from app.db import engine
from app.families import invitations_router, lineages_router
from app.families import router as families_router
from app.family_activities import public_funds_router
from app.family_activities import router as family_activities_router
from app.family_admin import router as family_admin_router
from app.family_chat import (
    router as family_chat_router,
)
from app.family_chat import (
    start_chat_pg_listener,
    stop_chat_pg_listener,
)
from app.heritage_discovery import router as heritage_discovery_router
from app.heritage_links import router as heritage_links_router
from app.invitation_preview import router as invitation_preview_router
from app.memory_interactions import router as memory_interactions_router
from app.memory_photos import router as memory_photos_router
from app.metrics import metrics_registry
from app.observability import configure_logging, error_classification, request_id_context
from app.onboarding import router as onboarding_router
from app.phone_verification import router as phone_verification_router
from app.profile_photos import router as profile_photos_router
from app.shared_ancestry import admin_router as admin_shared_ancestry_router
from app.shared_ancestry import family_router as family_root_connection_router
from app.shared_ancestry import router as shared_ancestry_router
from app.shared_ancestry_requests import admin_router as admin_ancestry_requests_router
from app.shared_ancestry_requests import family_router as family_ancestry_requests_router

settings = get_settings()
configure_logging(settings.log_level, settings.app_env)


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap_admin_roles()
    start_chat_pg_listener()
    try:
        yield
    finally:
        stop_chat_pg_listener()
        engine.dispose()


app = FastAPI(
    title="Гуулингийнхан API",
    version="0.1.0",
    description="Гэр бүлийн мод, хүмүүс болон удам угсааны түүхийн API.",
    docs_url=None if settings.app_env.lower() in {"production", "staging"} else "/docs",
    redoc_url=None if settings.app_env.lower() in {"production", "staging"} else "/redoc",
    lifespan=lifespan,
)


def _http_error_code(status_code: int) -> str:
    return {
        400: "BAD_REQUEST", 401: "AUTHENTICATION_REQUIRED", 403: "FORBIDDEN",
        404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA_TYPE", 422: "VALIDATION_ERROR",
        429: "RATE_LIMITED", 503: "SERVICE_UNAVAILABLE",
    }.get(status_code, "REQUEST_ERROR" if status_code < 500 else "INTERNAL_ERROR")


@app.exception_handler(HTTPException)
async def safe_http_error(request: Request, error: HTTPException):
    return JSONResponse(
        status_code=error.status_code,
        content={"detail": error.detail, "error_code": _http_error_code(error.status_code),
                 "request_id": getattr(request.state, "request_id", None)},
        headers=error.headers,
    )


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request: Request, _: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Хүсэлтийн өгөгдөл буруу байна.", "error_code": "VALIDATION_ERROR",
                 "request_id": getattr(request.state, "request_id", None)},
    )
@app.middleware("http")
async def request_context(request: Request, call_next):
    started = time.perf_counter()
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    context_token = request_id_context.set(request_id)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        rejection: tuple[str, str] | None = None
        if not request_origin_allowed(
            request.headers.get("origin"),
            request.headers.get("referer"),
            settings.cors_origin_list,
        ):
            rejection = (
                "Хүсэлтийн эх үүсвэр зөвшөөрөгдөөгүй.",
                "CSRF_ORIGIN_INVALID" if request.headers.get("origin") or request.headers.get("referer")
                else "CSRF_ORIGIN_REQUIRED",
            )
        elif not request.cookies.get(CSRF_COOKIE_NAME) or not request.headers.get(CSRF_HEADER_NAME):
            rejection = ("CSRF хамгаалалтын token шаардлагатай.", "CSRF_TOKEN_REQUIRED")
        elif not valid_double_submit(
            request.cookies.get(CSRF_COOKIE_NAME),
            request.headers.get(CSRF_HEADER_NAME),
            settings,
        ):
            rejection = ("CSRF хамгаалалтын token буруу байна.", "CSRF_TOKEN_INVALID")
        if rejection is not None:
            detail, error_code = rejection
            response = JSONResponse(
                status_code=403,
                content={"detail": detail, "error_code": error_code, "request_id": request_id},
            )
            response.headers["X-Request-ID"] = request_id
            if request.url.path.startswith("/api/v1/"):
                response.headers["Cache-Control"] = "private, no-store"
            metrics_registry.record(request.method, "unmatched", response.status_code, time.perf_counter() - started)
            request_id_context.reset(context_token)
            return response
    try:
        response = await call_next(request)
    except Exception as error:  # noqa: BLE001 - final boundary keeps internals out of API responses.
        error_code, status_code = error_classification(error)
        logging.getLogger("guulingiinhan.api").error(
            "Unhandled request error",
            extra={"event": "request_failed", "error_code": error_code,
                   "error_type": type(error).__name__},
        )
        response = JSONResponse(
            status_code=status_code,
            content={
                "detail": "Уучлаарай, хүсэлтийг боловсруулахад алдаа гарлаа.",
                "request_id": request_id,
                "error_code": error_code,
            },
        )
    response.headers["X-Request-ID"] = request_id
    # Authenticated JSON, validation failures and revoked sessions must never
    # become reusable browser/shared-cache representations of a user's data.
    # Endpoints that declare their own cache policy (e.g. the CSRF cookie
    # response's `no-store`) keep it untouched; the Vary hardening still runs.
    if request.url.path.startswith("/api/v1/"):
        if "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "private, no-store"
        vary = [item.strip() for item in response.headers.get("Vary", "").split(",") if item.strip()]
        if "cookie" not in {item.lower() for item in vary}:
            vary.append("Cookie")
        response.headers["Vary"] = ", ".join(vary)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    route = getattr(request.scope.get("route"), "path", "unmatched")
    metrics_registry.record(request.method, route, response.status_code, duration_ms / 1000)
    rate_limit_namespace = None
    log_error_code: str | None
    log_level = logging.WARNING if (
        duration_ms >= settings.slow_request_threshold_ms or response.status_code >= 400
    ) else logging.INFO
    if response.status_code == 429:
        event = "rate_limit_hit"
        log_error_code = "RATE_LIMITED"
        rate_limit_namespace = route
    elif response.status_code >= 500:
        event = "request_failed"
        log_error_code = "SERVICE_UNAVAILABLE" if response.status_code == 503 else "INTERNAL_ERROR"
    elif duration_ms >= settings.slow_request_threshold_ms:
        event = "slow_request"
        log_error_code = None
    else:
        event = "request_completed"
        log_error_code = None
        rate_limit_namespace = None
    logging.getLogger("guulingiinhan.api").log(
        log_level,
        "Request completed",
        extra={
            "event": event,
            "request_id": request_id,
            "method": request.method,
            "route": route,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "error_code": log_error_code,
            "rate_limit_namespace": rate_limit_namespace,
        },
    )
    request_id_context.reset(context_token)
    return response


# CORS must wrap request_context so its early CSRF errors remain readable by
# allowlisted browser origins, while disallowed origins receive no CORS grant.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-File-Name", CSRF_HEADER_NAME],
    expose_headers=["X-Request-ID", CSRF_HEADER_NAME],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(account_photos_router, prefix="/api/v1")
app.include_router(phone_verification_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(admin_workspace_router, prefix="/api/v1")
app.include_router(admin_shared_ancestry_router, prefix="/api/v1")
app.include_router(shared_ancestry_router, prefix="/api/v1")
app.include_router(family_root_connection_router, prefix="/api/v1")
app.include_router(community_router, prefix="/api/v1")
app.include_router(announcements_router, prefix="/api/v1")
app.include_router(memory_photos_router, prefix="/api/v1")
app.include_router(memory_interactions_router, prefix="/api/v1")
app.include_router(profile_photos_router, prefix="/api/v1")
app.include_router(family_activities_router, prefix="/api/v1")
app.include_router(family_chat_router, prefix="/api/v1/families")
app.include_router(public_funds_router, prefix="/api/v1")
app.include_router(admin_ancestry_requests_router, prefix="/api/v1")
app.include_router(family_ancestry_requests_router, prefix="/api/v1")
app.include_router(onboarding_router, prefix="/api/v1")
app.include_router(families_router, prefix="/api/v1")
app.include_router(family_admin_router, prefix="/api/v1")
app.include_router(heritage_discovery_router, prefix="/api/v1")
app.include_router(heritage_links_router, prefix="/api/v1")
app.include_router(lineages_router, prefix="/api/v1")
app.include_router(invitations_router, prefix="/api/v1")
app.include_router(invitation_preview_router, prefix="/api/v1")


@app.get("/", tags=["system"])
def root() -> dict[str, str]:
    """Basic API landing endpoint for direct backend deployments."""
    return {"service": "guulingiinhan-api", "status": "ok"}


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness probe: the API process is running."""
    return {"status": "ok", "service": "guulingiinhan-api"}


@app.get("/metrics", include_in_schema=False)
def metrics(request: Request):
    """Expose process-local operational counters only with an operator bearer token."""
    expected = settings.metrics_token
    supplied = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(supplied.encode(), f"Bearer {expected}".encode()):
        raise HTTPException(status_code=404, detail="Not found")
    return PlainTextResponse(
        metrics_registry.render(),
        headers={"Cache-Control": "no-store", "Content-Type": "text/plain; version=0.0.4; charset=utf-8"},
    )


@app.get("/ready", tags=["system"])
@app.get("/health/ready", tags=["system"])
def readiness(request: Request):
    """Readiness probe: the required database is reachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logging.getLogger("guulingiinhan.api").error(
            "Database readiness check failed",
            extra={"event": "readiness_failed", "error_code": "DATABASE_UNAVAILABLE",
                   "error_type": type(error).__name__},
        )
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "service": "guulingiinhan-api",
                     "error_code": "DATABASE_UNAVAILABLE",
                     "request_id": request.state.request_id},
        )
    return {"status": "ok", "service": "guulingiinhan-api", "database": "ok"}
