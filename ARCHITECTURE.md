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
4. `Marriage`-ийн хоёр хүнийг canonical дарааллаар хадгалж, яг ижил хосын хоёр дахь marriage record-ийг одоогийн unique constraint хориглоно. Remarriage түүхийг дэмжихийн тулд энэ constraint-ийг өгөгдөл хадгалсан migration-аар дараагийн phase-д өөрчлөх шаардлагатай.
5. Амьд хүний нууцлалын анхны утга `family`; profile-д утас, email, гэрийн хаяг байхгүй.
6. `PersonGuardianship` нь тухайн Family доторх Person-д хандах хэрэглэгчид олгосон тусгай, буцаан цуцалж болох эрх. Parent-child холбоо нь удмын мэдээлэл болохоос зөвшөөрөл биш.
7. Төрсөн огноогоор 18 нас хүрээгүй нь мэдэгдэж байгаа хүний profile талбар, намтар, үйл явдал, дурсамжийг тус тусын guardian scope-оор хамгаална. Нас тодорхойлох төрсөн огноо байхгүй бол насанд хүрээгүй гэж автоматаар тооцохгүй; энэ тохиолдолд гэр бүлийн үндсэн дүрэм үйлчилнэ.
8. Guardian эрхийг зөвхөн Family owner тухайн гэр бүлийн гишүүнд олгож, хугацаа болон scope бүрээр удирдана. Account өөрийн Person-ийг parent relationship-оор холбосон байсан ч тусгай grant хийх хүртэл sensitive мэдээлэлд хандахгүй.

## Minor ба guardian эрхийн хэрэгжилт (P4.2)

- `Person` ба `User` тусдаа хэвээр. Хүүхэд account-гүй Person байдлаар хадгалагдана.
- `PersonGuardianship` нь нэг мөрөнд нэг scope хадгална. `view_profile`, `edit_profile`, `manage_biography`, `manage_events`, `manage_memories`, `manage_media` scope тусдаа.
- Guardian болон Person хоёулаа нэг Family-ийн гишүүн/context байхыг composite foreign key батална. Хандалт бүрд сервер active/revoked/expiry болон тухайн Family membership-ийг шалгана.
- Нууц profile scope байхгүй бол төрсөн/нас барсан огноо, газар, товч тайлбар API response-оос хасагдана. Search, жагсаалт, tree мөн адил projection хэрэглэнэ.
- `manage_media` нь хадгалалтын upload endpoint-үүдийг бий болгох хүртэл эрхийн schema foundation төдий.
- Одоогоор guardian grant-ийг Family owner удирдана. Parent relationship дангаараа grant үүсгэхгүй.

## Хөгжүүлэлтийн үе шат

- Phase 1: орчны тохиргоо, FastAPI/PostgreSQL/Docker/Alembic суурь.
- Phase 2: User, Family, Person болон холбооны schema, migration.
- Phase 3: auth, email verification/reset, дараа нь зөвшөөрлийн middleware.
- Phase 4–6: family/person CRUD, relationship үйлдлүүд.
- Phase 7–10: graph tree, biography/timeline, memory/photo.
- Phase 11+: invitation, privacy, тест, deployment.
- Phase 4.2: minor profile redaction болон Family-scoped, explicit guardian grants.

Authentication ба authorization бэлэн болтол user data-д CRUD API нээхгүй. Relationship cycle шалгалтыг service layer-д хийж байгаа; зэрэгцээ бичилтийн үед цикл үүсэх эрсдэлийг API transaction түвшинд шийдэх ажил мөн CRUD-тэй хамт хийнэ.
