import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth import router as auth_router
from app.config import get_settings
from app.db import engine
from app.families import invitations_router
from app.families import router as families_router

settings = get_settings()
app = FastAPI(
    title="Гуулингийнхан API",
    version="0.1.0",
    description="Гэр бүлийн мод, хүмүүс болон удам угсааны түүхийн API.",
    docs_url=None if settings.app_env.lower() == "production" else "/docs",
    redoc_url=None if settings.app_env.lower() == "production" else "/redoc",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin not in settings.cors_origin_list:
            response = JSONResponse(status_code=403, content={"detail": "Origin зөвшөөрөгдөөгүй."})
            response.headers["X-Request-ID"] = request_id
            return response
    try:
        response = await call_next(request)
    except Exception:
        logging.getLogger("guulingiinhan.api").exception(
            "Unhandled request error", extra={"request_id": request_id, "path": request.url.path}
        )
        response = JSONResponse(
            status_code=500,
            content={
                "detail": "Уучлаарай, хүсэлтийг боловсруулахад алдаа гарлаа.",
                "request_id": request_id,
            },
        )
    response.headers["X-Request-ID"] = request_id
    return response


app.include_router(auth_router, prefix="/api/v1")
app.include_router(families_router, prefix="/api/v1")
app.include_router(invitations_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness probe: the API process is running."""
    return {"status": "ok", "service": "guulingiinhan-api"}


@app.get("/health/ready", tags=["system"])
def readiness():
    """Readiness probe: the required database is reachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logging.getLogger("guulingiinhan.api").exception("Database readiness check failed")
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "service": "guulingiinhan-api"},
        )
    return {"status": "ok", "service": "guulingiinhan-api", "database": "ok"}
