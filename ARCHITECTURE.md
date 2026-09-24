# Архитектур — Гуулингийнхан MVP

## Google identity (P4.5)

Google OIDC нь authorization-code flow ашиглана. Provider-ийн `issuer + subject` нь `LoginIdentity`-ийн тогтвортой түлхүүр бөгөөд access/ID token хадгалахгүй. Богино хугацааны signed state cookie-д state, nonce, flow болон account link үед user ID байна; callback state marker-ийг `login_throttles`-оос нэг удаа хэрэглэнэ. Google email нь account холбох түлхүүр биш: ижил email-тай account байвал хэрэглэгч эхлээд тухайн account-аар нэвтэрч Security хуудаснаас identity-г холбоно. Шинэ Google account-д Person автоматаар үүсэхгүй.

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
4. `Marriage`-ийн хоёр хүнийг canonical дарааллаар хадгална. P4.7-ийн `a71d3f0c92b4` migration-аас хойш нэг хос олон historical marriage occurrence хадгалж болно; зөвхөн ижил хосын давхар active occurrence-ийг partial unique index хориглоно.
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

## Нэвтрэх identity бүртгэл (P4.3)

- `LoginIdentity` нь нэвтрэх арга/таних тэмдгийг `User` account-тай холбоно. `UserPersonLink` нь account-ыг удамд байгаа `Person`-той холбодог тул эдгээр хоёр холбоо хоорондоо солигдохгүй.
- Бүртгэлээр үүссэн имэйл identity болон одоогийн email/password нэвтрэлт нэг `User`-ийг ашиглана. `users.email`, `password_hash`, `email_verified_at`, session хүснэгт хэвээр; legacy account-ын ID, password, verification төлөв болон session-ийг өөрчлөхгүй.
- Имэйл баталгаажуулалт/reset-д зориулсан random token-ийг hash-лан тусдаа хүснэгтэд хадгална. SMTP adapter production-д, fake adapter local болон тестэд хэрэглэгдэнэ. Урилга 7 хоногийн хүчинтэй, raw token API-аас гарахгүй бөгөөд эзэмшигч revoke хийж болно.
- Шинэ email/password account баталгаажуулах холбоосоор verified болохоос өмнө session авдаггүй; password login зөвхөн verified email identity-д зөвшөөрөгдөнө.
- Имэйлийг захын whitespace-гүй болгож бүх хаягт `casefold()` хэрэглэнэ. Gmail dot арилгах, `+tag` хасах зэрэг provider-specific хувиргалт хийхгүй. Нэвтрэхэд identity lookup indexed; хуучин бичлэгт fallback хийнэ.
- Утасны identity нь E.164 `+` улсын кодтой canonical дугаар ашиглах загвартай. Google identity нь имэйл бус issuer + subject-аар ялгагдана.
- Email/phone uniqueness нь provider + normalized identifier; Google uniqueness нь provider + issuer + subject. Нэг normalized утга өөр provider-д байж болно.
`identity_link_requests` нь баталгаажаагүй, 24 цагийн хүсэлтийн тэмдэглэл л хадгална. Энэ хүсэлт identity эзэмшүүлэхгүй, login-д ашиглагдахгүй; одоогоор хүсэлтийг дуусгаж identity холбох endpoint байхгүй. OTP/OIDC баталгаажуулалт P4.4/P4.5-д хийгдсэний дараа л consume урсгал нэмнэ.
- Backfill normalized имэйл нь ганцхан legacy account-д харгалзах үед identity үүсгэнэ. Case-fold хийсний дараа хэд хэдэн account давхцвал аль нэгийг сонгохгүй; хуучин account хэвээр үлдэх ба хоёрдмол login fail-closed, шинэ бүртгэл тухайн хаягийг нөөцлөгдсөн гэж үзнэ.
- Одоогоор guardian grant-ийг Family owner удирдана. Parent relationship дангаараа grant үүсгэхгүй.

## Утасны OTP, нэвтрэлт ба recovery (P4.4)

- `PhoneOtpChallenge` нь утас + зориулалт + хугацаатай, 6 оронтой OTP-ийн HMAC-SHA256 digest хадгална. Түүхий код DB, API response, application log-д орохгүй. HMAC pepper development-д process эхлэхэд түр үүсэж restart-аар солигдоно; production `OTP_HASH_SECRET`-ийг нууцын сангаас өгнө.
- Нэг хэрэглэгч phone OTP-оор login хийхийн өмнө `/auth/me/phone/request` ба `/auth/me/phone/verify`-ээр утсаа баталгаажуулж account-даа холбоно. Энэ нь бүртгэлтэй User-ийг Person-той холбох өөрчлөлт биш.
- `/auth/phone/login/request` нь account байгаа эсэхийг response-оор ялгахгүй; зөвхөн идэвхтэй, баталгаажсан утас login үүсгэж чадна. Challenge 5 минут, 60 секундийн resend cooldown, утас/IP-н нэг минутын rate limit, нэг кодод 5 буруу оролдлоготой.
- Нууц үг сэргээх verified phone OTP эсвэл verified email token-оор хийгдэнэ. Амжилттай үед өмнөх бүх session цуцлагдаж, автоматаар шинэ session нээхгүй.
- `SMS_PROVIDER=twilio` нь Twilio Messages API руу TLS холболтоор OTP илгээнэ. Production startup-д PostgreSQL, HTTPS CORS-ийн дээр `SMS_PROVIDER=twilio`, `OTP_HASH_SECRET` (32+ тэмдэгт), Twilio account SID/token/from number бүгд шаардлагатай. Development-ийн `fake` provider бодит SMS илгээхгүй.
- Account-ийн нэвтрэх identity-г `/account/security` хуудсаас шалгаж, SMS баталгаажуулах замаар утас холбож болно. Phone identity салгах UI/API одоогоор байхгүй.

## Хөгжүүлэлтийн үе шат

- Phase 1: орчны тохиргоо, FastAPI/PostgreSQL/Docker/Alembic суурь.
- Phase 2: User, Family, Person болон холбооны schema, migration.
- Phase 3: auth, email verification/reset, дараа нь зөвшөөрлийн middleware.
- Phase 4–6: family/person CRUD, relationship үйлдлүүд.
- Phase 7–10: graph tree, biography/timeline, memory/photo.
- Phase 11+: invitation, privacy, тест, deployment.
- Phase 4.2: minor profile redaction болон Family-scoped, explicit guardian grants.

Authentication ба authorization бэлэн болтол user data-д CRUD API нээхгүй. Relationship cycle шалгалтыг service layer-д хийж байгаа; зэрэгцээ бичилтийн үед цикл үүсэх эрсдэлийг API transaction түвшинд шийдэх ажил мөн CRUD-тэй хамт хийнэ.

## Хайлтын хуудаслалт ба хязгаартай tree (P4.8)

- `GET /families/{family_id}/persons/search?q=...&page=1&page_size=25&birth_year=...` нь зөвхөн тухайн гэр бүлийн эрхтэй гишүүний нэрээр хайна. Хайлтын үг Unicode NFKC/casefold нормчилолтой, нэрийн эхлэлээр таарна; бүх талбар SQL параметрээр дамжина. Хариу нь `items`, `page`, `page_size`, `total`, `has_next` бүхий хөнгөн хуудас; `page_size` 100-аас их байж болохгүй.
- `persons.search_first_name`, `search_last_name`, `search_middle_name` нь canonical нэрийг өөрчлөхгүй хайлтын түлхүүр. `b51c9e7a60f4` migration хуучин мөрүүдийг нормчилж backfill хийгээд PostgreSQL `text_pattern_ops`-той btree болон birth-date index нэмнэ. Шинэ/зассан хүний түлхүүрүүд API write үед шинэчлэгдэнэ.
- Хайлтын хариу нэр, зөвшөөрөгдсөн төрсөн оноор хязгаарлагдана; хувийн мэдээлэл, зураг, намтар буцаахгүй. Private Person зөвхөн үүсгэсэн эсвэл холбосон хэрэглэгчид харагдана. Насанд хүрээгүй хүний төрсөн он хариунд нууцлагдаж, minor жилээр `birth_year` filter өгөхөд тоон мэдээлэл задруулахгүй.
- `GET /families/{family_id}/tree?person_id=...&depth=2` нь сонгосон хүнээс эцэг-эх/хүүхэд болон гэрлэлтийн холбоогоор өргөжинө. Default depth 2, дээд тал нь 5; нэг хариу 300 хүн, 1,200 ирмэгээр хязгаарлагдана. `meta.truncated` нь хязгаарт хүрснийг илтгэнэ. Бүх гэр бүлийн хүмүүсийг нэг дор татахгүй, давтагдсан хүн/цикл traversal-ийг зогсооно.
- Tree холбоосууд family membership, private visibility, guardian-ийн `view_profile` эрхийг сервер талд шалгана. Хайлтын, tree-ийн хуудаслалт болон том графын хязгаарыг `backend/tests/test_search_tree_scale.py`-д 1,001 хүний нэрийн хайлт, олон салаа tree, cycle болон query-count шалгалтаар батална.
