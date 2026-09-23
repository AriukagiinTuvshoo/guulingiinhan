# Гуулингийнхан

Монгол гэр бүлийн ургийн мод, хүмүүсийн намтар, түүх, дурсамжийг холбон хадгалах веб апп.

Frontend нь Next.js App Router, TypeScript, React дээр ажиллана. `backend/` нь FastAPI, SQLAlchemy, Alembic, PostgreSQL суурьтай API-г агуулна. Төслийн үе шат, өгөгдлийн загвар, аюулгүй байдлын төлөвийг `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `DEPLOYMENT.md`-д тэмдэглэсэн.

## Frontend

```bash
npm install
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

Эсвэл төслийн root дээр `docker compose up --build` ажиллуулж Postgres + API-г асаана.

## Шалгалт

```bash
cd backend
uv run pytest
uv run ruff check app tests migrations
uv run alembic check
```

Өгөгдөлд зориулсан CRUD болон authentication endpoint хараахан нээгдээгүй. Frontend demo өгөгдөл хөтчийн `localStorage`-д хадгалагдана. Бодит гэр бүлийн мэдээлэл оруулах систем гэж ашиглаж болохгүй.
