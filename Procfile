# AidoLab (Heroku-style) process definitions for the Guulingiinhan backend API.
#
# web: apply pending migrations, then serve the FastAPI ASGI app.
#   - `cd backend` puts alembic.ini / migrations / app package on the paths
#     the commands expect (same layout CI and the Docker image use).
#   - The ASGI entry point is `app.main:app` (verified: backend/app/main.py
#     exports `app`; backend/index.py re-exports it for serverless hosts).
#   - $PORT is provided by the platform; 8000 is the local fallback.
#   - --no-access-log matches the Docker CMD: the app emits its own
#     structured request logs.
#   - Migrations run in the web process because release-phase support on
#     AidoLab is unverified; see docs/AIDOLAB-DEPLOYMENT-REQUIREMENTS.md
#     for the release-phase alternative and the single-instance caveat.
web: cd backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log
