# Архитектур — Гуулингийнхан MVP

## Одоогийн бүтэц

- `app/`: Next.js App Router layout болон одоогийн модны UI. Энэ үе шатанд UI-г Next client component-д шилжүүлэв; өгөгдөл нь одоогоор demo/localStorage.
- `backend/app`: FastAPI API, SQLAlchemy model, relationship domain logic.
- `backend/migrations`: Alembic schema migrations.
- PostgreSQL нь орчны `DATABASE_URL`-аар тохируулагдана; development-д SQLite ашиглаж болно.
- Зураг PostgreSQL-д бус object storage-д хадгалагдана; `photos.object_key` нь storage key байна.

## Өгөгдлийн зарчим

1. `Person` нь бүртгэлтэй `User` биш тусдаа entity. Нас барсан, accountгүй өвөг дээдсийг бүртгэж болно.
2. `FamilyPerson` олон-олон холбоосоор хүн олон гэр бүлийн хүрээнд оролцоно.
3. Эцэг эх-хүүхэд ба гэрлэлт тусдаа. Салалт parent-child холбоонд нөлөөлөхгүй.
4. `Marriage`-ийн хоёр хүнийг canonical дарааллаар хадгалж давхар холбоог хязгаарлана.
5. Амьд хүний нууцлалын анхны утга `family`; profile-д утас, email, гэрийн хаяг байхгүй.

## Хөгжүүлэлтийн үе шат

- Phase 1: орчны тохиргоо, FastAPI/PostgreSQL/Docker/Alembic суурь.
- Phase 2: User, Family, Person болон холбооны schema, migration.
- Phase 3: auth, email verification/reset, дараа нь зөвшөөрлийн middleware.
- Phase 4–6: family/person CRUD, relationship үйлдлүүд.
- Phase 7–10: graph tree, biography/timeline, memory/photo.
- Phase 11+: invitation, privacy, тест, deployment.

Authentication ба authorization бэлэн болтол user data-д CRUD API нээхгүй. Relationship cycle шалгалтыг service layer-д хийж байгаа; зэрэгцээ бичилтийн үед цикл үүсэх эрсдэлийг API transaction түвшинд шийдэх ажил мөн CRUD-тэй хамт хийнэ.
