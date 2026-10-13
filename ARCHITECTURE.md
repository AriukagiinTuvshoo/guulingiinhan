# Архитектур — Гуулингийнхан

## Google identity (P4.5)

Google OIDC нь authorization-code flow ашиглана. Provider-ийн `issuer + subject` нь `LoginIdentity`-ийн тогтвортой түлхүүр бөгөөд access/ID token хадгалахгүй. Богино хугацааны signed state cookie-д state, nonce, flow болон account link үед user ID байна; callback state marker-ийг `login_throttles`-оос нэг удаа хэрэглэнэ. Google email нь account холбох түлхүүр биш: ижил email-тай account байвал хэрэглэгч эхлээд тухайн account-аар нэвтэрч Security хуудаснаас identity-г холбоно. Шинэ Google account-д Person автоматаар үүсэхгүй.

## Одоогийн бүтэц

Үндсэн өгөгдлийн урсгал:

```text
Next.js App Router (`app/`, `components/`, `lib/api.ts`)
        ↓ JSON/HTTP
FastAPI (`backend/app/`)
        ↓ SQLAlchemy
PostgreSQL (ажиллуулах орчноос `DATABASE_URL` авна; SQLite нь локал тестэд)

Зургийн binary → эрх шалгадаг API → private object storage (local эсвэл S3-compatible adapter)
```

Frontend нь family, account, content болон ancestry өгөгдлийг API-аас авна. Браузерын `sessionStorage` зөвхөн хэрэглэгчийн хаасан хандивын баннерыг тухайн session-д нуух UI тохиргоонд ашиглагддаг; үндсэн өгөгдөл тэнд хадгалагддаггүй. Энэ баримт Cloudflare production тохиргоо эсвэл production storage-ийг шалгасан гэсэн үг биш.

`backend/app/` нь auth ба session, family/person, зөвшөөрөл, удмын холбоо, Root Ancestry, Story, Memories, Archive, Events, media, Admin болон audit домэйнуудыг агуулна. API router-уудыг `backend/app/main.py`-д `/api/v1` дор бүртгэдэг; schema-ийн өөрчлөлтийг `backend/migrations/`-ийн Alembic удирдана.

## Удмын өгөгдлийн давхарга

- `User`, `LoginIdentity`, `UserSession` нь нэвтрэх account-ыг тодорхойлно. `UserPersonLink` account-ыг бодит `Person`-той холбодог; энэ нь эцэг-эх, гэрлэлт эсвэл үеийн байрлалыг тодорхойлохгүй.
- `Family`, `FamilyMember`, `FamilyPerson` нь гэр бүл доторх хандалт болон тухайн гэр бүлд бүртгэлтэй хүмүүсийг төлөөлнө. `Person` нь account-аас тусдаа бөгөөд нас барсан эсвэл account-гүй хүнийг бүртгэж болно.
- `ParentChildRelationship`, `Marriage` нь гэр бүлийн бодит, canonical холбоонууд. Салалт нь өмнөх гэрлэлтийн түүхийг хадгална.
- Root Ancestry (`SharedAncestry`, ил тод нийтлэх/зөвшөөрөх бүртгэлүүд, `RootConnection`) нь гэр бүлийн модыг орлохгүй: гэр бүлийн хүмүүс болон canonical холбооноос зөвшөөрөгдсөн хэсгийг нийтлэг харагдацад гаргана. `SharedAncestryRelationship` нь хуучин projection холбоосыг унших, салгахад нийцтэй хэвээр; шинэ гэр бүлийн холбоо `ParentChildRelationship`-д хадгалагдана.
- `Lineage`, `Branch`, `PersonLineageAssignment` нь гэр бүлийн доторх удмын нэр, салааны ангилал; тусдаа genealogy graph биш.

Story, Memories, Archive, Events нь API-ийн family-scoped домэйнууд. Зурагт хамаарах metadata DB-д байж болох ч binary-г private object storage-д хадгалж, API хүсэлт бүрд хандалтыг шалгана. Archive binary upload/preview бүрэн хэрэгжсэн гэж эндээс дүгнэхгүй.

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
- `manage_media` scope нь profile болон Memory photo upload/update/tag/delete урсгалд хэрэглэгдэнэ. Зургийн хандалтыг family болон тухайн хүний guardian/privacy scope-оор шалгана.

## Нэвтрэх identity бүртгэл (P4.3)

- `LoginIdentity` нь нэвтрэх арга/таних тэмдгийг `User` account-тай холбоно. `UserPersonLink` нь account-ыг удамд байгаа `Person`-той холбодог тул эдгээр хоёр холбоо хоорондоо солигдохгүй.
- Бүртгэлээр үүссэн имэйл identity болон одоогийн email/password нэвтрэлт нэг `User`-ийг ашиглана. `users.email`, `password_hash`, `email_verified_at`, session хүснэгт хэвээр; legacy account-ын ID, password, verification төлөв болон session-ийг өөрчлөхгүй.
- Имэйл баталгаажуулалт/reset-д зориулсан random token-ийг hash-лан тусдаа хүснэгтэд хадгална. SMTP adapter production-д, fake adapter local болон тестэд хэрэглэгдэнэ. Урилга 7 хоногийн хүчинтэй, raw token API-аас гарахгүй бөгөөд эзэмшигч revoke хийж болно.
- Шинэ email/password account баталгаажуулах холбоосоор verified болохоос өмнө session авдаггүй; password login зөвхөн verified email identity-д зөвшөөрөгдөнө.
- Имэйлийг захын whitespace-гүй болгож бүх хаягт `casefold()` хэрэглэнэ. Gmail dot арилгах, `+tag` хасах зэрэг provider-specific хувиргалт хийхгүй. Нэвтрэхэд identity lookup indexed; хуучин бичлэгт fallback хийнэ.
- Утасны identity нь E.164 `+` улсын кодтой canonical дугаар ашиглах загвартай. Google identity нь имэйл бус issuer + subject-аар ялгагдана.
- Email/phone uniqueness нь provider + normalized identifier; Google uniqueness нь provider + issuer + subject. Нэг normalized утга өөр provider-д байж болно.
`identity_link_requests` нь баталгаажаагүй, хугацаатай хүсэлтийн тэмдэглэл хадгална. Одоогийн API хүсэлт үүсгэх, өөрийн хүсэлтийг жагсаах, цуцлах үйлдэлтэй; хүсэлт нь өөрөө identity-г эзэмшүүлэхгүй, login-д ашиглагдахгүй. Баталгаажсан утасны OTP болон Google OIDC нь тус тусын account-scoped урсгалаар identity-г холбодог.
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
- `GET /families/{family_id}/tree?person_id=...&depth=2` нь сонгосон хүнээс эцэг-эх/хүүхэд болон гэрлэлтийн холбоогоор өргөжинө. Default depth 2, дээд тал нь 5; нэг хариунд анхдагч 300, тохируулж болох дээд 1,000 хүн, 1,200 ирмэгийн хязгаар үйлчилнэ. `meta.truncated` нь хязгаарт хүрснийг илтгэнэ. Бүх гэр бүлийн хүмүүсийг нэг дор татахгүй, давтагдсан хүн/цикл traversal-ийг зогсооно.
- Tree холбоосууд family membership, private visibility, guardian-ийн `view_profile` эрхийг сервер талд шалгана. Хайлтын, tree-ийн хуудаслалт болон том графын хязгаарыг `backend/tests/test_search_tree_scale.py`-д 1,001 хүний нэрийн хайлт, олон салаа tree, cycle болон query-count шалгалтаар батална.

## Дурсамжийн зураг ба объект хадгалалт (P4.9)

- `photos` хүснэгтэд storage key, MIME төрөл, байт хэмжээ, хэмжээстэй thumbnail metadata хадгална. Зургийн binary PostgreSQL-д хадгалагдахгүй; `ObjectStorage` интерфейсийг local filesystem болон S3-compatible (AWS S3/R2) adapter хэрэгжүүлнэ.
- Local хөгжүүлэлтэд `STORAGE_PROVIDER=local`, Docker Compose named volume ашиглана. Production startup-д HTTPS S3-compatible endpoint, private bucket болон credentials шаардлагатай. Production-д raw object URL гаргахгүй; зөвшөөрөл шалгасан API proxy нь `private, no-store` header-тай binary буцаана.
- Upload raw JPEG/PNG/WebP body авна. Сервер MIME-г бодит image decoder-оор шалгаж, extension-ийг тохируулна, configured byte cap (1–50 MiB), 40MP хязгаар тавина, JPEG thumbnail үүсгэнэ. Зураг хандалт family membership, memory visibility, тухайн memory-ийн minor guardian scopes болон photo tag-ийн profile scopes шалгана.
- `GET /families/{id}/memories?page=1&page_size=25` хуудаслалттай бөгөөд нэг memory-д 12 хүртэл thumbnail summary буцаана. Зургийн gallery болон хүний зураг тусдаа хязгаартай endpoint-тэй. `X-File-Name` CORS header зөвшөөрнө.
- `d4a9f73b8210` нь хуучин фото мөрийг өөрчлөхгүйгээр metadata болон index нэмнэ. Downgrade нь metadata-тай upload илэрвэл устгал хийхээс татгалзана; production rollback-д forward-fix ашиглана. Memory устгах үед object устгал амжилттай болсны дараа metadata-г цэвэрлэнэ.

## Хувийн зургийн хадгалалтын хамгаалалт (P4.10)

- `e8b0a6c14d29` migration нь `photos.storage_status` нэмнэ: `uploading`, `ready`, `deletion_pending`. Өмнөх мөрүүд `ready` болж backfill хийгдэнэ. Зөвхөн `ready` зураг API-д харагдана. Downgrade нь цэвэрлэгдээгүй upload/delete төлөв байвал мэдээлэл алдахаас сэргийлж зогсоно.
- Upload-ын дараалал: эрх шалгах → хэмжээний хязгаартай body унших → decoder/MIME/өргөтгөл шалгах → `uploading` metadata хадгалах → original ба thumbnail object үүсгэх → `ready` болгох. Алдаа гарвал зураг шууд нуугдаж `deletion_pending` болно. Устгалын алдаа гарсан tombstone болон 15 минутаас хуучин дутуу upload-ыг дараагийн эрхтэй list/upload хүсэлтүүд дахин цэвэрлэнэ.
- Нэг минутын rate limit нь user, family, IP түвшинд DB throttle ашиглана (`PHOTO_UPLOAD_USER_PER_MINUTE=20`, `PHOTO_UPLOAD_FAMILY_PER_MINUTE=100`, `PHOTO_UPLOAD_IP_PER_MINUTE=60`). Body-н `Content-Length` эхэнд шалгагдаж, chunk-ийг мөн хязгаартай уншина.
- Storage key нь зөвхөн UUID-ээр үүссэн family/memory/photo замтай яг тэнцүү эсэхийг API шалгана. Adapter нь absolute path, `..`, хоосон сегмент, Windows drive болон null byte-г татгалзана. S3-compatible bucket-ийг оператор private байлгаж, public access-ийг хаана; код bucket-ийн бодлогыг өөрөө нотолж чадахгүй.
- API response нь storage key, object metadata болон эх файлын нэрийг ил гаргахгүй. Фото зөвшөөрлийн дараа proxy-оор уншигдаж `private, no-store`, `nosniff`, sandbox CSP, same-site CORP ашиглана. Client-с ирсэн content type нь decoder-ийн форматын MIME-тэй яг таарах ёстой.
- Original binary-г metadata-г хадгалсан хэвээр байршуулна. Thumbnail-д EXIF чиглэлийг зөв болгож, metadata-г арилган JPEG болгон дахин кодолно. Хадгалсан зурагт нэвтрэхдээ family, memory privacy, guardian scope, Person tag бүрийн харагдацыг сервер шалгана.
- Delete хүсэлт object-уудыг арилгахаас өмнө мөрийг `deletion_pending` болгож commit хийнэ. Storage тасарсан тохиолдолд файл API-аас нуугдмал үлдэж, retry цэвэрлэгээ дахин оролдоно. Энэ нь retryable lifecycle боловч object storage ба SQL DB хооронд distributed transaction биш.

## Ажиглалт ба найдвартай ажиллагаа (P4.11)

- `X-Request-ID`-г API сервер хүсэлт бүрд шинээр UUID болгож олгоно; client-ээс ирсэн утгыг итгэмжлэхгүй. Тэр ID response header/body болон request log-д ижил байна. Лог нь JSON, allowlist талбар ашиглана; хүсэлтийн body/query, exception текст/stack trace, хувийн мэдээлэл, token, нууц үг, object URL-г бичихгүй.
- Request log-д route template, method, status, үргэлжилсэн хугацаа байна. Удаан хүсэлтийн босгыг `SLOW_REQUEST_THRESHOLD_MS`; 429 хүсэлт, server/storage/database алдааг тогтвортой `error_code`-оор ялгана. Алдааны response хуучин `detail`-ээ хадгалж, `error_code`, `request_id`-г нэмнэ. Validation error нь оруулсан талбарын утгыг хариунд цуурайтуулахгүй.
- `/health` зөвхөн процесс амьд эсэхийг, `/health/ready` PostgreSQL хүрэх боломжийг шалгана. DB unavailable үед readiness 503 буцаах ч нууц/connection мэдээлэл харуулахгүй. FastAPI lifespan дуусахад engine pool dispose хийнэ.
- PostgreSQL pool нь SQLAlchemy connection pool ашиглана; `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS`, `DB_POOL_RECYCLE_SECONDS`, `DB_CONNECT_TIMEOUT_SECONDS` орчноос тохирно. Анхны pool хэмжээ нь SQLAlchemy-ийн default-той ижил; бодит managed DB connection limit-д тааруулж deployment дээр тохируулах шаардлагатай. Non-idempotent write хүсэлтүүдийг автоматаар дахин ажиллуулахгүй.
- SMTP, SMS, Google OIDC client хүсэлтэд 8 секунд; S3 adapter-д connect 3 секунд, read 10 секунд, SDK standard retry дээд 3 оролдлого байна. DB connect timeout тохируулгатай; SQL statement timeout энэ хувилбарт тохируулаагүй. `POSTGRES_PASSWORD` болон production deployment-ийн pool/timeout утгууд production-д тохируулагдаагүй.
- P4.10 cleanup retry нь нэг удаагийн хүсэлтэд 20 хүртэл мөр авч, мөр бүрд `PHOTO_CLEANUP_MAX_ATTEMPTS` (анхдагч 8, дээд 20) удаа оролдоно. `c441b2f3a805` migration оролдлогын тоог хадгална. Хязгаар дууссан object автоматаар дахин оролдохгүй; operator шалгалт болон гар аргаар сэргээх ажилбар шаардлагатай. Эх файл DB-д хэзээ ч буцаан ил гарахгүй.
- **Configured:** application JSON logs, health/readiness endpoint, per-request correlation, database pool/connect timeouts, and S3 connect/read timeouts. **Tested:** local SQLite; PostgreSQL CI (P4.10 baseline-аар). **Not configured:** production log aggregation/alerting, managed DB/object backups. **Not tested:** production restore, real S3/R2 failure recovery.
