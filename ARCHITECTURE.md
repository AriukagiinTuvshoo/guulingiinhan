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

## Нэвтрэх identity бүртгэл (P4.3)

- `LoginIdentity` нь нэвтрэх арга/таних тэмдгийг `User` account-тай холбоно. `UserPersonLink` нь account-ыг удамд байгаа `Person`-той холбодог тул эдгээр хоёр холбоо хоорондоо солигдохгүй.
- Бүртгэлээр үүссэн имэйл identity болон одоогийн email/password нэвтрэлт нэг `User`-ийг ашиглана. `users.email`, `password_hash`, `email_verified_at`, session хүснэгт хэвээр; legacy account-ын ID, password, verification төлөв болон session-ийг өөрчлөхгүй.
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
- Нууц үг сэргээх одоогоор verified phone-р хийгдэнэ: `POST /auth/password-reset/phone/request`, дараа нь OTP + шинэ нууц үгийг `POST /auth/password-reset/phone/confirm` руу илгээнэ. Амжилттай үед өмнөх бүх session цуцлагдаж, автоматаар шинэ session нээхгүй. Email delivery provider холбогдоогүй тул email recovery хийгдээгүй.
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
