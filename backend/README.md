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

## API

`/api/v1/auth`: register, login, logout, me.
`/api/v1/families`: гэр бүл үүсгэх/жагсаах/засах/архивлах, гишүүд/урилга, хүн CRUD, өөрийн account-ыг хүнтэй холбох, хайлт, tree, parent-child, marriage/divorce, biography, life events, memories, audit log. `/api/v1/invitations/accept` урилгыг зөв имэйлтэй нэг удаа ашиглуулна.

API нь санамсаргүй, DB-д hash хэлбэрээр хадгалсан 7 хоногийн session cookie ашиглана. Cookie нь HttpOnly, SameSite=Lax (production cross-site frontend үед Secure + SameSite=None) байна; production дээр state өөрчлөх хүсэлтийн Origin-ийг CORS жагсаалттай тулгана. Нэвтрэлтийн оролдлогын хязгаар нэг минутын window-оор DB-д тоологдоно. Данс үүсгэхэд Owner membership атомоор нэмэгдэнэ.

`Person` устгах endpoint нь тухайн family-н холбоосыг салгаж, Person болон харилцааны түүхийг хадгална. Family устгах нь бодит устгал биш archive. Private Person-г зөвхөн үүсгэсэн эсвэл өөрийн account-тай холбосон хүн харна.

Email verification болон password reset email үйлчилгээ холбогдоогүй тул шинэ бүртгэлийн `email_verified_at` хоосон хэвээр. Урилга API нь 7 хоног хүчинтэй нэг удаагийн token гаргадаг; email хүргэлт автоматаар хийгдэхгүй, owner кодыг өөрөө дамжуулна. Photo upload/storage signed URL одоогоор байхгүй. Эдгээрийг хийхээс өмнө production нээлт хийхгүй.

Production тохиргоонд `APP_ENV=production`, PostgreSQL URL, зөвхөн `https://` CORS origin шаардана. Контейнер root бус `app` хэрэглэгчээр ажиллана.

## Тест

`uv run pytest` — auth/session, rate-limit, family isolation, CRUD, relationship integrity, biography/timeline/memory API тестүүд. GitHub Actions нь бодит PostgreSQL service дээр migration upgrade/check ажиллуулна.
