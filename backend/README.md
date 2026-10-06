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

Email verification, email password reset, invitation delivery нь provider abstraction-тай. Хөгжүүлэлт/тестэд `EMAIL_PROVIDER=fake` хэрэглэж, production-д TLS-тэй SMTP тохируулна.

Email болон E.164 утасны дугаар хоёул `LoginIdentity` дээр хадгалагдана. Хэрэглэгч утас+нууц үгээр бүртгүүлж, баталгаажаагүй үед ч нэвтэрч болно; утасны эзэмшлийг Profile/Settings-ээс дараа нь Verify.MN-ийн гар утаснаас эхлүүлсэн баталгаагаар шалгана. Энгийн нэвтрэлтэд SMS огт илгээхгүй. Backend-д зөвхөн `VERIFY_MN_API_KEY` тохируулна; frontend-д дамжуулахгүй. Verify.MN-ийн SMS нь хэрэглэгчийн утаснаас дэлгэцэнд харуулсан зургаан оронтой текстийг 144773 руу илгээдэг бөгөөд нэг хүсэлт 150₮. Кодын текст дангаараа баталгаа биш: backend өөрийн account/утас/purpose-той challenge-г Verify.MN-ийн session төлөвтэй тулгана. Тусгай SMS тестийн дугааргүй тул бодит операторын хүргэлт release gate-д тусдаа шалгагдана.

Хуучин Twilio OTP endpoint-ууд API нийцтэй байдлын зорилгоор үлдсэн; үндсэн login болон шинэ account UI тэдгээрийг ашиглахгүй. `SMS_PROVIDER=fake` нь зөвхөн development/test-д зориулагдсан. Нууц үг сэргээх имэйл токен hash хэлбэртэй, хугацаатай, нэг удаагийн хэвээр. Урилга 7 хоног хүчинтэй бөгөөд API raw token буцаахгүй; owner илгээсэн урилгыг хүчингүй болгож болно.

Account portrait нь canonical Person portrait-оос тусдаа private R2 object байна. `/auth/me/photo` зөвхөн account эзэнд, admin endpoint зөвхөн SUPER_ADMIN-д нээлттэй; storage object key-г хариунд гаргахгүй. Утас солихдоо одоогийн password-оор дахин баталгаажуулж, шинэ дугаарыг provider дээр баталгаажуулсны дараа л хуучин identity-г солино.

Зураг local-д `STORAGE_PROVIDER=local` болон `STORAGE_LOCAL_PATH`-д хадгалагдана (Compose `family_uploads` volume). Production-д `STORAGE_PROVIDER=s3`, HTTPS `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` тохируулна. Bucket public биш, public access хаалттай байна. API upload JPEG/PNG/WebP-ийн бодит decoder MIME, өргөтгөлийг тулгаж шалгаж, `PHOTO_MAX_UPLOAD_BYTES`-аар хэмжээ хязгаарлан, JPEG thumbnail үүсгэнэ. `PHOTO_UPLOAD_USER_PER_MINUTE`, `PHOTO_UPLOAD_IP_PER_MINUTE`, `PHOTO_UPLOAD_FAMILY_PER_MINUTE` нь upload rate limit-ийг тохируулна. Thumbnail EXIF metadata-г арилгана; original файлын metadata хадгалагдана. `uploading`/`deletion_pending` төлөв нь storage тасалдахад хэсэгчилсэн upload/delete-г нууцалж, дараагийн хүсэлтээр retry хийн цэвэрлэнэ. Зургийн агуулгыг зөвшөөрөл шалгасан API endpoint дамжуулна; production URL эсвэл signed URL client-д тогтмол өгөхгүй.

Production тохиргоонд `APP_ENV=production`, PostgreSQL URL, зөвхөн `https://` CORS origin шаардана. Контейнер root бус `app` хэрэглэгчээр ажиллана.

## Тест

`uv run pytest` — auth/session, rate-limit, family isolation, CRUD, relationship integrity, biography/timeline/memory API тестүүд. GitHub Actions нь бодит PostgreSQL service дээр migration upgrade/check ажиллуулна.
