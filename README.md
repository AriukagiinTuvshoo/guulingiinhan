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

Нэвтрэхдээ email эсвэл утасны дугаар болон нууц үгээ ашиглана. Утасны баталгаажуулалтыг нэвтэрсний дараа Profile/Settings хэсгээс хийдэг тул энгийн login SMS шаардахгүй. Verify.MN тохиргоо backend-only `VERIFY_MN_API_KEY` secret ашиглана. Google OIDC-г асаахдаа backend-д `GOOGLE_OIDC_ENABLED=true`, Google OAuth client ID/secret болон API callback URI-г тохируулна. Callback URI нь `/api/v1/auth/google/callback`; тохиргоо байхгүй үед Google товч нуугдана.

Эсвэл төслийн root дээр `docker compose up --build` ажиллуулж Postgres + API-г асаана.

## Шалгалт

```bash
cd backend
uv run pytest
uv run ruff check app tests migrations
uv run alembic check
```

Жинхэнэ MVP туршилтын урсгал: `/register` → `/onboarding` → `/families` → `/tree` → `/profile`. Email verification, нууц үг сэргээх, invitation хүргэлтэд local `EMAIL_PROVIDER=fake`, production-д TLS-тэй SMTP тохируулна. Email хүргэлт болон object storage production-д хараахан тохируулагдаагүй.

## Хөгжүүлэлтийн дүрэм

- Нэг ажил = нэг богино наслах branch + Pull Request. Merge хийсний дараа branch-ийг устгана; олон долоо хоног тогтдог `codex/*`, `claude/*` branch үлдээхгүй.
- PR бүр `verify` workflow-г давах ёстой. PR template-ийн жагсаалтыг бөглөнө.
- Schema өөрчлөх бол `DATABASE.md`-г хамт шинэчилнэ. `uv run alembic heads` нэг head харуулах ёстой.
- Dependency нэмэхдээ хувилбарыг тогтооно (`latest` ашиглахгүй). Dependabot долоо хоног бүр шинэчлэлтийн PR нээнэ. Хугацаат `security-audit` workflow нэмэгдвэл долоо хоног бүр `npm audit` болон `pip-audit` ажиллуулна.
- Давхцсан ажил, merge-ийн дараалал, deploy adapter-ийн шийдвэрийг `INTEGRATION_BASELINE.md`-д тэмдэглэнэ.
