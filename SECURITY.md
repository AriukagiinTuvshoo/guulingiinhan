# Аюулгүй байдлын төлөв

## Google OpenID Connect

- `google-auth`-аар ID token-ийн signature, audience, хугацаа, issuer шалгаж, апп nonce болон `email_verified`-ийг давхар батална. Callback нь зөвхөн Google authorization/token endpoint болон тохируулсан redirect URI ашиглана.
- OAuth state санамсаргүй, 10 минутын хугацаатай, HMAC гарын үсэгтэй HttpOnly cookie-д байна. Database throttle marker callback дээр атомоор нэг удаа хэрэглэгдэнэ; cookie-г callback бүрт устгана.
- Google identity нь `issuer + subject` unique түлхүүртэй. Verified email таарсан ч existing account-т автоматаар link хийхгүй. Link нь authenticated session-оос эхэлж, callback дээр ижил account session шаарддаг; өөр account-д холбогдсон subject-ийг шилжүүлэхгүй.
- Token, authorization code болон provider error body-г log/DB-д хадгалахгүй. Google OIDC default-оор унтраалттай. Production-д client credentials, HTTPS callback болон 32+ тэмдэгтийн `GOOGLE_OIDC_STATE_SECRET` secret manager-аас тохируулна.

## Хэрэгжсэн суурь хамгаалалт

- DB талд foreign key, unique, check constraint тавьсан.
- Амьд хүний visibility анх `family`; нууц холбоо барих талбарууд person schema-д байхгүй.
- Зураг зөвхөн object key хадгална; файл DB-д оруулахгүй.
- Фото upload нь decoder-оор бодит JPEG/PNG/WebP формат, өргөтгөл болон MIME-г шалгаж, pixel/byte хязгаар хэрэглэнэ. API хариунд storage key, файл metadata болон original filename гарахгүй.
- Зургийн upload/delete lifecycle `uploading` → `ready` эсвэл `deletion_pending` төлөвөөр илэрхийлэгдэнэ. Хэсэгчилсэн object амжилтгүй болсон үед зургийг шууд нууж, retry цэвэрлэгээний tombstone үлдээнэ. Thumbnail EXIF metadata-г дахин кодлохдоо арилгана; original EXIF хэвээр үлдэнэ.
- S3/R2 bucket public биш, public access блоклогдсон байх ёстой. API object storage-д шууд URL өгөхгүй, зөвшөөрөл шалгасны дараа proxy binary дамжуулна; `private, no-store`, `nosniff`, sandbox CSP ба same-site CORP header ашиглана.
- Зургийн storage key-г API үүсгэсэн UUID замтай тулгаж шалгана; adapter path traversal ба absolute key-г зөвшөөрөхгүй. Upload rate limit user/family/IP хэмжээнд минутын тохируулгатай.
- CORS origin environment-оос уншигдана.
- Production тохиргоо PostgreSQL URL болон ил тод HTTPS CORS origin-уудыг шаардана.
- Liveness ба database readiness endpoint тусдаа; хүсэлт бүр серверийн үүсгэсэн request ID авна.
- Backend контейнер root бус хэрэглэгчээр ажиллана.
- Бодит endpoint бүр session болон family membership шалгана; Role-г write дээр хэрэглэнэ.
- Нууц үг scrypt-ээр hash-лагдана. Session cookie-ийн raw token DB-д хадгалагдахгүй; 7 хоногийн хугацаатай session logout үед хүчингүй болно.
- Login error ерөнхий; account/IP хосоор DB-д суурилсан нэг минутын rate limit ажиллана.
- Private person жагсаалт, профайл, tree болон relationship output-оос эрхгүй хэрэглэгчид хасагдана.
- Origin шалгалт browser-ийн POST/PUT/PATCH/DELETE хүсэлтэд CSRF эрсдэлийг бууруулна.
- Audit log нь account, family, person, relationship, marriage, biography, life event, memory үйлдлийн actor болон ID-г хадгална; password/content-ийг логлохгүй.
- Parent-child өөрчлөлтийг PostgreSQL дээр family мөрөөр түгжиж, зэрэгцээ inverse edge-ээс хамгаална.
- Урилгын token database-д hash-лагдаж, 7 хоногийн дараа дуусна; зөвхөн урьсан имэйлээр нэвтэрсэн user нэг удаа ашиглана.
- Git-д `.env` хадгалахгүй.

## Ажиглалтын лог ба алдааны хариу (P4.11)

- API log JSON хэлбэртэй бөгөөд зөвхөн зөвшөөрсөн талбаруудыг хэвлэнэ. Raw message, exception текст/traceback, хүсэлтийн body/query, token, password, OTP, database URL, storage key/credential зэргийг formatter гаргахгүй. Uvicorn access log Docker command-д унтарсан тул URL query бүртгэгдэхгүй.
- `X-Request-ID` серверээс үүснэ; client утга ignored. Лог, алдааны response болон response header ижил correlation ID хэрэглэнэ. Request log route template, method, статус, хугацаа л агуулна; IP болон person нэр логдохгүй.
- Validation error нь хэрэглэгчийн өгсөн утгыг хариунд буцаахгүй. Бусад HTTP error-д `detail` хэвээр, `error_code` болон request ID нэмэгдэнэ. Ерөнхий unhandled error нь SQLAlchemy exception-т 503 `DATABASE_UNAVAILABLE`, бусад алдаанд 500 `INTERNAL_ERROR` буцаах бөгөөд exception internals response/log-д бичигдэхгүй.
- Фото цэвэрлэгээний storage retry нь row бүрд дээд хязгаартай, `cleanup_attempts` хадгална. Retry limit хүрвэл автоматаар дахин оролдохоо зогсоож, photo hidden хэвээр үлдэнэ. Энэ нь operator-оор хянуулах шаардлагатай; автомат alert/queue байхгүй.
- Email/OTP/Google/S3 client timeout ба S3 SDK retry нь кодонд тус тус тохирсон. Database pool/connect утгууд environment-аар override хийнэ. Managed production-д энэ тохиргоо хийгдсэн гэж үзэхгүй.
- Managed database backup, object storage backup болон restore дадлага одоогоор тохируулаагүй/туршаагүй. Их хэмжээний эсвэл насанд хүрээгүй хүний гэр бүлийн өгөгдөл оруулахын өмнө backup retention, object versioning болон сэргээх туршилтыг infra талд тохируулах шаардлагатай.

## Minor profile ба guardian grant (P4.2)

- Төрсөн огноогоор нас 18 хүрээгүй нь мэдэгдэж байгаа Person-д family-only profile response хүртэл төрсөн/нас барсан огноо, газар болон товч тайлбарыг redacted хэлбэрээр буцаана. `view_profile`-гүй хэрэглэгч biography, life event, minor-тэй tag хийсэн memory-д нэвтрэхгүй.
- Minor-д зориулсан scope бүр тусдаа шалгагдана; owner/editor дүр нь guardian scope-ийг тойрохгүй. `ParentChildRelationship` нь genealogy data бөгөөд access grant биш.
- Зөвхөн тухайн Family owner grant олгох/цуцлах боломжтой. Guardian User болон Person тухайн нэг Family-д байхыг DB composite FK батална. API хүсэлт бүр membership, grant-ийн active/revoked төлөв болон хугацааг сервер дээр шалгана.
- `birth_date = NULL` үед нас тодорхойгүй гэж үзэж minor хамгаалалтыг автоматаар асаах боломжгүй. Ийм Person-ийн privacy-г тогтоох өгөгдөл бүртгэлийн бодлого, цаашдын manual minor flag-аар сайжруулах шаардлагатай.
- Нийтийн profile/search endpoint одоогоор байхгүй. Ирээдүйн public endpoint нь minor-ийн нэр болон бусад sensitive талбарыг сервер талд шүүх ёстой; UI дээр талбар нуух нь access control биш.
- `manage_media` scope schema-д бэлэн боловч файл upload, signed URL, malware/image processing хараахан холбогдоогүй.

## Нэвтрэх identity-ийн хамгаалалт (P4.3)

- Имэйл identity нь `User`-ийг заана. `Person` руу шууд холбогдохгүй; зөвхөн тусдаа `UserPersonLink` account–Person холбоог илэрхийлнэ.
- Нэвтрэлт normalized email-г index-тэй registry-гээс хайж, legacy compatibility fallback дээр таарах хэрэглэгч яг нэг биш бол нэвтрүүлэхгүй. Давхардсан case variant-ийг migration аль нэг эзэмшигчид оноохгүй, шинээр бүртгүүлэхэд ч тухайн normalized имэйлийг эзэлсэнд тооцно.
- Email normalization: trim + casefold. Gmail цэг, `+tag` арилгахгүй. Phone бэлтгэл нь зөвхөн E.164 (`+` улсын код); улс орныг таамаглахгүй.
- Google identity-г ирээдүйд issuer + subject-аар ялгана; имэйлээр account автоматаар нэгтгэхгүй. OAuth/OIDC одоо байхгүй.
`GET /api/v1/auth/me/identities` нь зөвхөн баталгаажсан session-ийн эзний identity-ийн аюулгүй талбаруудыг үзүүлнэ. Link request API нь account ID-г client-ээс авахгүй, зөвхөн хүсэлтийг үүсгэсэн account-д харуулж/цуцлуулна.
- Link хүсэлт нь 24 цагийн дотор `pending` байна, эзэмшил болон нэвтрэх эрх олгохгүй. OTP/OIDC баталгаажуулалт хийгдээгүй тул consume/unlink API байхгүй. Өөр хэрэглэгчийн хүсэлтэд ID мэдсэнээр хүрэхгүй.
- API response-д normalized identifier, Google issuer/subject, password hash, session hash/token орохгүй. Identity linking хүсэлтийн audit зөвхөн action ба request ID-г хадгална; имэйл, утасны утгыг логлохгүй.

## Нэвтрэх ба зөвшөөрлийн ажлууд

Имэйл баталгаажуулалт болон нууц үг сэргээх нь хугацаатай, нэг удаагийн random token ашиглаж; зөвхөн SHA-256 hash DB-д хадгална. Хариу нь бүртгэлтэй эсэхийг ил гаргахгүй, IP болон имэйлээр хүсэлтийн давтамж хязгаарлана. Баталгаажуулах/reset холбоос token-ийг URL fragment-д байрлуулж серверийн access log-д орохоос хамгаална. Шинээр бүртгүүлсэн account-д баталгаажуулах хүртэл session үүсгэхгүй; email/password login мөн verified identity шаардана. Invitation acceptance баталгаатай email шаардана.

## Утасны OTP (P4.4)

- Phone identity-г зөвхөн SMS код шалгасны дараа одоогийн account-д холбоно. OTP нь 6 оронтой, 5 минутын хүчинтэй, нэг удаа хэрэглэгдэнэ; 5 буруу оролдлогын дараа challenge түгжинэ. Нэг утсанд нэг минутын resend cooldown болон phone/IP rate limit үйлчилнэ.
- Challenge хүснэгтэд raw OTP бус зориулалт, утас, challenge ID-тэй холбосон HMAC-SHA256 хадгална. `OTP_HASH_SECRET` нь 32+ тэмдэгт random нууц; production secret manager ашиглана. Кодыг API response болон application log-д бичихгүй.
- `SMS_PROVIDER=fake` нь зөвхөн development/test-д no-op. Production тохиргоо Twilio-г credential-уудтай шаардаж startup validation хийнэ; credentials эх код, `.env.example`, log-д тавихгүй. SMS хүргэлт provider-оос хамаарах тул delivery receipt болон telecom fraud monitoring тусдаа нэмж хэрэгтэй.
- Phone болон email recovery амжилттай дуусмагц password шинэчилж тухайн account-ын бүх session-ийг устгана. Account байгаа эсэх response-оор ил гарахгүй. Email request-ууд shared throttle registry-д имэйл/IP/account түвшний хязгаартай.
- OTP request audit-д challenge ID, action хадгална; дугаар болон кодыг audit-аар хадгалахгүй. SMS provider-ийн payload/response body application log руу дамжуулахгүй.

Development-д `SMS_PROVIDER=fake` ямар ч мессеж хүргэхгүй; automated tests provider dependency override ашиглан code-ийг зөвхөн тестийн memory-д шалгана.

Production email-д TLS ашигласан SMTP provider заавал; fake provider production тохиргоонд хүчингүй. PostgreSQL руу орохын өмнө managed backup ба restore шалгалт, TLS, production домэйн cookie/CORS болон SMTP хүргэлтийн шалгалт хийнэ. CI migration-ийг PostgreSQL дээр шалгана; managed restore болон production SMTP шалгалт хараахан хийгдээгүй тул API-г нээлттэй production хэрэглээнд бэлэн гэж үзэхгүй.
