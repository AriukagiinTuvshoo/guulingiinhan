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

Үндсэн урсгал: `/register` → имэйл баталгаажуулалт → `/onboarding` → `/tree` → `/profile`. Урилгаар нэгдсэн хүн шинэ гэр бүл үүсгэхийн оронд байгаа гэр бүлдээ `/people` хэсгээс өөрийн бүртгэлээ холбоно. Local орчинд `EMAIL_PROVIDER=fake`; hosted орчинд TLS-тэй SMTP ашиглана.

## Одоогийн hosted орчин

Frontend нь Cloudflare Workers дээр vinext, backend нь Cloudflare Containers дотор FastAPI-аар ажиллана. Backend-ийн managed PostgreSQL нь Supabase staging; зураг private R2-д хадгалагдаж, эрх шалгасан API-аар дамжина. Supabase Auth/Data API-г browser шууд ашиглахгүй.

Одоогийн ажиллах хаяг: [staging](https://guulingiinhan-staging.tuvshoo0331.workers.dev). Домэйн худалдаж аваагүй; production DNS/cutover хийгдээгүй. Одоогийн тохиргоо, release gates, rollback-ийг [DEPLOYMENT.md](DEPLOYMENT.md), [домэйн холбох заавар](docs/CLOUDFLARE_CUSTOM_DOMAIN.md), [backup/restore](docs/BACKUP_RECOVERY.md)-оос шалгана. Өмнөх огноотой тайлан нь тухайн үеийн нотолгоо бөгөөд шинэ release-ийн шалгалтыг орлохгүй.

Windows Application Control native SWC-г хаасан үед `npm run build -- --webpack` гэсэн Next-ийн дэмждэг хувилбар ашиглаж болно. Native binary ажиллуулахын тулд OS хамгаалалтыг сулруулахгүй.
