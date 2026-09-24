# Байршуулалтын суурь

Google login асаахдаа backend-д `GOOGLE_OIDC_ENABLED=true`, `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `GOOGLE_OIDC_REDIRECT_URI`, `GOOGLE_OIDC_STATE_SECRET` тохируул. Google Cloud OAuth client-ийн authorized redirect URI нь яг `https://<api-host>/api/v1/auth/google/callback` байна. State secret-ийг `openssl rand -hex 32`-оор үүсгэж secret manager-д хадгал; frontend-д client secret/state secret дамжуулахгүй. Google credentials байхгүй CI болон development-д OIDC унтраалттай байж болно.

## Орон нутаг

Root `.env` дахь `POSTGRES_PASSWORD`-ийг өөрчилсний дараа `docker compose up --build` ажиллуулна. API: `http://localhost:8000`; OpenAPI: `/docs`; health: `/health`.

## Production-д бэлэн болохын өмнө

1. Managed PostgreSQL үүсгэж нууц үг, TLS connection string тохируулна.
2. API болон frontend-ийн origin тус бүрийг CORS-д заана.
3. `EMAIL_PROVIDER=smtp`, HTTPS `EMAIL_PUBLIC_BASE_URL`, `EMAIL_FROM`, SMTP host/username/password болон STARTTLS тохируулна. Fake provider production-д эхлүүлэх үед configuration error өгнө.
4. Private object storage, хугацаатай signed URL, upload хэмжээ/төрлийн шалгалт нэмнэ.
5. CI дээр tests, migrations, build ажиллуулна.
6. Managed PostgreSQL болон object storage backup/versioning тохируулж, тусгаарласан staging орчинд restore туршилт хийж бүртгэнэ. Одоогийн repository-д backup job тохируулаагүй тул production өгөгдөл нэмэхээс өмнө энэ ажил заавал хийгдэнэ.
7. Vercel-ийн `NEXT_PUBLIC_API_BASE_URL` болон backend-ийн `CORS_ORIGINS`-ийг preview/staging домэйнээр тохируулж шалгана.
8. Email verification, password reset, invitation SMTP хүргэлт болон bounce/error мониторингийг staging-д баталгаажуулна.
9. Migration-ийг эхлээд CI/staging PostgreSQL дээр upgrade, downgrade, дахин upgrade-аар шалгана. Одоогийн downgrade нь auth/session/invitation/throttle/audit өгөгдлийг устгадаг тул production rollback-д ашиглахгүй; forward-fix migration ба backup/restore төлөвлөгөө хэрэглэнэ.

### Утасны OTP тохиргоо (P4.4)

Backend орчинд `OTP_HASH_SECRET`-ийг `openssl rand -hex 32`-оор үүсгээд secret manager-д хадгал. Production-д `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` тохируулах шаардлагатай; нэг утгыг frontend env рүү бүү дамжуул. OTP secret болон Twilio credential дутуу үед production тохиргоо API-г эхлүүлэхгүй. Development-ийн `SMS_PROVIDER=fake` мессеж илгээхгүй.

Email verification болон password recovery нь SMTP тохируулсан үед идэвхжинэ. Локал development-д `EMAIL_PROVIDER=fake` нь хүргэлтийг network-д гаргахгүй. Invitation raw token response-д гарахгүй тул бодит хүргэлтэд SMTP provider шаардлагатай.

`docker-compose.yml` нь development-д зориулагдсан бөгөөд API/DB портууд зөвхөн localhost дээр нээгдэнэ; production нууц үг, network, backup бодлого орлоход зориулагдаагүй.

Backend-ийн container root бус хэрэглэгчээр ажиллана. `/health` нь liveness, `/health/ready` нь PostgreSQL холболтын readiness шалгалт. Production deployment нь readiness probe-оо `/health/ready` рүү чиглүүлнэ.

### Ажиглалт ба холбоосын найдвартай байдал (P4.11)

API JSON log гаргаж, серверийн `X-Request-ID` хүсэлтийн response/log хооронд хадгална. Log aggregation-д зөвхөн stdout-г ав; request body болон URL query-г proxy/APM талд бүртгэхгүй. `LOG_LEVEL`, `SLOW_REQUEST_THRESHOLD_MS` тохируулж болно. HTTP 429, удаан хүсэлт, DB/storage алдааны event-үүдийг `event`/`error_code` талбараар alert-д холбо.

Managed PostgreSQL-ийн connection limit-ийг мэдсэний дараа `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS`, `DB_POOL_RECYCLE_SECONDS`, `DB_CONNECT_TIMEOUT_SECONDS`-г тухайн үйлчилгээний replica тоотой хамт тохируул. Эхний утгууд тохируулгын эхлэл болохоос production орчинд туршсан тоо биш. SQL query-д автомат дахин оролдлого хийхгүй.

SMTP, SMS болон Google OIDC timeout 8 секунд; S3 connection/read timeout 3/10 секунд, SDK retry хязгаарлагдсан. Database connect timeout нь env-ээр тохирно. Query/statement timeout идэвхжүүлээгүй тул шаардлагатай бол managed DB болон driver дээр workload-д тааруулж тохируул.

Фото cleanup нь анхдагчаар 8 хүртэл оролдлого хийдэг (`PHOTO_CLEANUP_MAX_ATTEMPTS`, дээд 20). Limit хүрсэн tombstone автоматаар арилгахгүй, hidden үлдэнэ; лог дахь `photo_cleanup_exhausted`-ээр олж operator runbook-аар гараар оношлоно. Production alert, log aggregation болон гар ажиллагааны сэргээх алхмууд одоогоор тохируулаагүй.

**Backup төлөв:** Managed PostgreSQL backup — NOT CONFIGURED; object storage backup/versioning — NOT CONFIGURED; restore test — NOT TESTED. Production нээлтээс өмнө тус бүрийг тохируулж, сэргээх туршилтын үр дүнг бүртгэ.

Restore runbook: (1) managed PostgreSQL snapshot-ийг тусгаарласан instance руу сэргээ; (2) `alembic current` болон `alembic upgrade head`-ээр schema-г шалга; (3) object storage-ийн versioned backup-ийг тусгаарласан bucket руу сэргээ; (4) DB-ийн `photos.object_key` болон `thumbnail_object_key`-г сэргэсэн объектуудтай тулган, алга болсон/илүү object-ийг тайлагна; (5) `/health/ready`, нэвтрэлт, family access, private photo upload/read smoke test ажиллуул; (6) үр дүн, хугацаа, зөрүүг бүртгэ. Энэ runbook нь одоогоор төлөвлөгөө бөгөөд бодит restore туршигдаагүй.

Auth cookie production-д `Secure; HttpOnly; SameSite=None` тул HTTPS frontend/backend болон зөв CORS origin шаардлагатай. Vercel-ийн бодит deployment энэ phase-д хийгдээгүй; provider project/environment variables шалгах эрх ба тохиргоо баталгаажаагүй.
