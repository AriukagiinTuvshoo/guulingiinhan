# Гуулингийнхан

Монгол гэр бүлийн ургийн мод, хүмүүсийн намтар, түүх, дурсамжийг холбон хадгалах веб апп.

Frontend нь Next.js App Router, TypeScript, React дээр ажиллана. `backend/` нь FastAPI, SQLAlchemy, Alembic, PostgreSQL суурьтай API-г агуулна. Төслийн үе шат, өгөгдлийн загвар, аюулгүй байдлын төлөвийг `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `DEPLOYMENT.md`-д тэмдэглэсэн.

## Frontend

```bash
npm install
cp .env.example .env
npm run dev
```

## Backend ба PostgreSQL

Python 3.11+, uv хэрэгтэй.

```bash
cd backend
uv sync --dev
cp .env.example .env
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

API баримт: `http://localhost:8000/docs`; ажиллагааны шалгалт: `/health`. Frontend `http://localhost:3000` дээр асна.

Frontend-ийн `.env` дахь `NEXT_PUBLIC_API_BASE_URL` нь browser-оос хүрэх API URL байх ёстой. Auth, гэр бүл, хүн болон харилцааны API нь `/api/v1`-ээр эхэлнэ. Browser-оос API руу cookie явуулахад backend-ийн `CORS_ORIGINS` дотор frontend origin байх шаардлагатай.

Google OIDC нэвтрэлтийг асаахдаа backend-д `GOOGLE_OIDC_ENABLED=true`, Google OAuth client ID/secret болон API callback URI-г тохируулна. Callback URI нь `/api/v1/auth/google/callback`. Тохиргоо байхгүй үед Google товч нуугдана; email/password болон утасны OTP нэвтрэлт хэвээр ажиллана.

Эсвэл төслийн root дээр `docker compose up --build` ажиллуулж Postgres + API-г асаана.

## Шалгалт

```bash
cd backend
uv run pytest
uv run ruff check app tests migrations
uv run alembic check
```

Playwright baseline uses a disposable SQLite database and starts the frontend and API on ports 3100 and 8100. From the repository root (requires Node, uv and Python):

```bash
npm ci
(cd backend && uv sync --locked --dev)
npx playwright install --with-deps chromium
export DATABASE_URL="sqlite:////tmp/guulingiinhan-e2e-$(date +%s).sqlite" APP_ENV=test
(cd backend && uv run --locked alembic upgrade head && uv run --locked python scripts/seed_e2e_admin.py)
npm run test:e2e
```

Never point E2E tests or migration commands at a production database. The seed script refuses non-test environments and non-disposable SQLite paths and requires a fresh database. The suite checks invalid login, cross-origin CSRF, anonymous admin access, and one owner-to-delegate trash restore flow; it is not complete end-to-end auth or production HTTPS/third-party-cookie coverage.

Жинхэнэ MVP туршилтын урсгал: `/register` → `/onboarding` → `/families` → `/tree` → `/profile`. Email verification, нууц үг сэргээх, invitation хүргэлтэд local `EMAIL_PROVIDER=fake`, production-д TLS-тэй SMTP тохируулна. Email хүргэлт болон object storage production-д хараахан тохируулагдаагүй.
