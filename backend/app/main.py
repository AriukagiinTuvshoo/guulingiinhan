import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.db import engine

settings = get_settings()
app = FastAPI(
    title="Гуулингийнхан API",
    version="0.1.0",
    description="Гэр бүлийн мод, хүмүүс болон удам угсааны түүхийн API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        logging.getLogger("guulingiinhan.api").exception(
            "Unhandled request error", extra={"request_id": request_id, "path": request.url.path}
        )
        response = JSONResponse(
            status_code=500,
            content={"detail": "Уучлаарай, хүсэлтийг боловсруулахад алдаа гарлаа.", "request_id": request_id},
        )
    response.headers["X-Request-ID"] = request_id
    return response


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
