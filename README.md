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

Жинхэнэ MVP туршилтын урсгал: `/register` → `/onboarding` → `/families` → `/tree` → `/profile`. Owner урилгын нэг удаагийн код үүсгэж гараар дамжуулж болно. Үндсэн demo нүүр sample өгөгдөл харуулсаар байна. Email баталгаажуулалт, нууц үг сэргээх email, автоматаар урилга илгээх, зураг хадгалах үйлчилгээ тохируулаагүй; энэ хувилбарыг нээлттэй хэрэглэгчдэд production болгон гаргах боломжгүй.
