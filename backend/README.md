# Гуулингийнхан API — суурь шат

FastAPI, SQLAlchemy 2, Alembic, PostgreSQL-д зориулсан API болон өгөгдлийн сангийн эхлэл.

## Орон нутагт ажиллуулах

1. `cp .env.example .env` гэж backend хавтсанд хуулна.
2. Python 3.11+ орчинд `uv sync --dev` ажиллуулна.
3. PostgreSQL асаагаад `uv run alembic upgrade head` ажиллуулна.
4. `uv run uvicorn app.main:app --reload` ажиллуулна.
5. `/docs` дээр API баримт, `/health` дээр процесс, `/health/ready` дээр database холболтыг шалгана.

Frontend-ийн local origin нь `http://localhost:3000`.

Docker ашиглах бол төслийн root-д `docker compose up --build` ажиллуулна.

## Өгөгдлийн загвар

`Person` нь `Family`-аас тусдаа; `family_persons` холбоос нэг хүнийг олон family context-д дахин ашиглах боломжтой. Parent-child болон spouse холбоонууд тусдаа хүснэгтэд хадгалагдана. Иймээс гэр бүл салсан ч эцэг эх-хүүхдийн холбоо хадгалагдана.

Одоогийн migrations нь хэрэглээний анхны schema болон account-person холбоо үүсгэнэ. Relationship domain шалгалтууд `app/relationships.py` дотор байна. CRUD болон auth endpoint-ууд дараагийн алхам; `/health`-ээс өөр өгөгдөл буцаах endpoint одоогоор нээлттэй биш.

Production тохиргоонд `APP_ENV=production`, PostgreSQL URL, зөвхөн `https://` CORS origin шаардана. Контейнер root бус `app` хэрэглэгчээр ажиллана.

## Тест

`uv run pytest` — relationship invariants, тохиргооны хамгаалалт, API health тестүүд. GitHub Actions нь бодит PostgreSQL service дээр migration upgrade/check ажиллуулна.
