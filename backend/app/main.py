import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.admin import bootstrap_admin_roles
from app.admin import router as admin_router
from app.admin_workspace import public_router as announcements_router
from app.admin_workspace import router as admin_workspace_router
from app.auth import router as auth_router
from app.community import router as community_router
from app.config import get_settings
from app.db import engine
from app.families import invitations_router, lineages_router
from app.families import router as families_router
from app.family_activities import router as family_activities_router
from app.memory_photos import router as memory_photos_router
from app.observability import configure_logging, error_classification, request_id_context
from app.profile_photos import router as profile_photos_router
from app.shared_ancestry import admin_router as admin_shared_ancestry_router
from app.shared_ancestry import router as shared_ancestry_router

settings = get_settings()
configure_logging(settings.log_level, settings.app_env)


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap_admin_roles()
    yield
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-File-Name"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    started = time.perf_counter()
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    context_token = request_id_context.set(request_id)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin not in settings.cors_origin_list:
            response = JSONResponse(
                status_code=403,
                content={"detail": "Origin зөвшөөрөгдөөгүй.", "error_code": "FORBIDDEN",
                         "request_id": request_id},
            )
            response.headers["X-Request-ID"] = request_id
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
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    route = getattr(request.scope.get("route"), "path", "unmatched")
    rate_limit_namespace = None
    log_level = logging.WARNING if (
        duration_ms >= settings.slow_request_threshold_ms or response.status_code >= 400
    ) else logging.INFO
    if response.status_code == 429:
        event = "rate_limit_hit"
        error_code = "RATE_LIMITED"
        rate_limit_namespace = route
    elif response.status_code >= 500:
        event = "request_failed"
        error_code = "SERVICE_UNAVAILABLE" if response.status_code == 503 else "INTERNAL_ERROR"
    elif duration_ms >= settings.slow_request_threshold_ms:
        event = "slow_request"
        error_code = None
    else:
        event = "request_completed"
        error_code = None
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
            "error_code": error_code,
            "rate_limit_namespace": rate_limit_namespace,
        },
    )
    request_id_context.reset(context_token)
    return response


app.include_router(auth_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(admin_workspace_router, prefix="/api/v1")
app.include_router(admin_shared_ancestry_router, prefix="/api/v1")
app.include_router(shared_ancestry_router, prefix="/api/v1")
app.include_router(community_router, prefix="/api/v1")
app.include_router(announcements_router, prefix="/api/v1")
app.include_router(memory_photos_router, prefix="/api/v1")
app.include_router(profile_photos_router, prefix="/api/v1")
app.include_router(family_activities_router, prefix="/api/v1")
app.include_router(families_router, prefix="/api/v1")
app.include_router(lineages_router, prefix="/api/v1")
app.include_router(invitations_router, prefix="/api/v1")


@app.get("/", tags=["system"])
def root() -> dict[str, str]:
    """Basic API landing endpoint for direct backend deployments."""
    return {"service": "guulingiinhan-api", "status": "ok"}


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness probe: the API process is running."""
    return {"status": "ok", "service": "guulingiinhan-api"}


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
