FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
COPY app ./app
RUN uv sync --frozen --no-dev
COPY migrations ./migrations
COPY alembic.ini ./
EXPOSE 8000
RUN addgroup --system app && adduser --system --ingroup app app && chown -R app:app /app
USER app
# Apply migrations in the controlled staging deployment step before releasing
# this image. The runtime app role deliberately has no schema DDL privileges.
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
