# Гуулингийнхан — байршуулалт ба домэйн бэлтгэл

Сүүлд шалгасан: 2026-10-13, Asia/Tokyo. Өмнөх тайлангууд тухайн үеийн нотолгоо бөгөөд шинэ release-ийн шалгалтыг орлохгүй.

## Бодит staging архитектур

| Хэсэг | Хэрэгжүүлэлт |
| --- | --- |
| Frontend | Next.js/React → vinext → Cloudflare Worker guulingiinhan-staging |
| API | FastAPI/SQLAlchemy → Linux Container → Worker guulingiinhan-backend-staging |
| Database | Supabase managed PostgreSQL 17, API-ийн private connection |
| Media | Private R2 guulingiinhan-staging-media; API session/family эрх шалгана |
| Email | Authenticated SMTP + STARTTLS; secret frontend-д өгөхгүй |
| Phone | Verify.MN; бодит утасны шалгалтыг эзэмшигч хийнэ |

Root `.env` дахь `POSTGRES_PASSWORD`-ийг өөрчилсний дараа `docker compose up --build` ажиллуулна. Compose эхлээд нэг удаагийн `migrate` service-ээр schema-г шинэчилж, амжилттай дууссаны дараа API-г асаана. API: `http://localhost:8000`; OpenAPI: `/docs`; health: `/health`.

Frontend: https://guulingiinhan-staging.tuvshoo0331.workers.dev

1. Managed PostgreSQL үүсгэж нууц үг, TLS connection string тохируулна.
2. API болон frontend-ийн origin тус бүрийг CORS-д заана; `CSRF_SECRET`-ийг `openssl rand -hex 32`-оор тусад нь үүсгэж secret manager-д хадгална. Production эхлэхэд энэ утга заавал байна.
3. `EMAIL_PROVIDER=smtp`, HTTPS `EMAIL_PUBLIC_BASE_URL`, `EMAIL_FROM`, SMTP host/username/password болон STARTTLS тохируулна. Fake provider production-д эхлүүлэх үед configuration error өгнө.
4. Private object storage, хугацаатай signed URL, upload хэмжээ/төрлийн шалгалт нэмнэ.
5. CI дээр tests, migrations, build ажиллуулна.
6. Managed PostgreSQL болон object storage backup/versioning тохируулж, тусгаарласан staging орчинд restore туршилт хийж бүртгэнэ. Одоогийн repository-д backup job тохируулаагүй тул production өгөгдөл нэмэхээс өмнө энэ ажил заавал хийгдэнэ.
7. Vercel-ийн `NEXT_PUBLIC_API_BASE_URL` болон backend-ийн `CORS_ORIGINS`-ийг preview/staging домэйнээр тохируулж шалгана.
8. Email verification, password reset, invitation SMTP хүргэлт болон bounce/error мониторингийг staging-д баталгаажуулна.
9. Migration-ийг эхлээд CI/staging PostgreSQL дээр upgrade, downgrade, дахин upgrade-аар шалгана. Одоогийн downgrade нь auth/session/invitation/throttle/audit өгөгдлийг устгадаг тул production rollback-д ашиглахгүй; forward-fix migration ба backup/restore төлөвлөгөө хэрэглэнэ.

### Production migration sequence

API container өөрөө Alembic migration ажиллуулахгүй. Release pipeline-д тухайн хувилбарын backend image болон production-той ижил нууц/DB тохиргоог ашигласан **нэг удаагийн migration task** ажиллуулж, `uv run alembic upgrade head` амжилттай дууссаны дараа л API instance-үүдийг rollout хийнэ. Migration ажиллаж байх үед олон API instance зэрэг migration эхлүүлэхгүй. Үйлдлийн өмнө backup, migration preflight болон app/schema compatibility баталгаажуул; алдаа гарвал API rollout-ийг зогсоож, migration-г автоматаар downgrade хийхгүй. Vercel/бусад hosted deployment-д энэ task-ийг тусдаа release job/command хэлбэрээр тохируулах шаардлагатай; энэ repository өөрөө production provider job-ийг үүсгэхгүй.

Локал `docker compose up --build` нь нэг `migrate` service-ийг API-аас өмнө ажиллуулах хэвээр. Тусдаа compose migration ажиллуулах үед `docker compose run --rm migrate` ашиглана.

### Утасны OTP тохиргоо (P4.4)

Local browser QA-д NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8840/api/v1 болгож npm run build ажиллуулна. Windows Application Control native SWC-г хаавал npm run build -- --webpack ашиглана; OS хамгаалалтыг сулруулахгүй. Core gates: npm run regression:routes, npm run test:root-linking, npm run test:heritage, npm run test:pwa.

Cloudflare build-д NEXT_PUBLIC_API_BASE_URL=https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/api/v1 болгож npm run build:vinext ажиллуулна. GitHub CI locked dependency install, TypeScript, Next/Vinext build, core regressions болон recovery helper tests ажиллуулна.

Backend: uv run pytest; uv run ruff check app tests migrations ops; uv run mypy. Ердийн API fixture SQLite тул PASS-ийг PostgreSQL concurrency гэж тайлагнахгүй. CI-ийн DOMAIN_POSTGRES_TEST_URL тусдаа шинэ loopback-only guulingiinhan_domain_test_... database-д бодит concurrent transaction/lock тест ажиллуулна. Дараа нь Alembic upgrade → downgrade нэг revision → upgrade → check хийнэ. Downgrade зөвхөн disposable CI database-д; бодит орчинд forward-fix эсвэл approved restore хэрэглэнэ.

## Орчин ба secret нэрс

- Frontend build: NEXT_PUBLIC_API_BASE_URL — нууц биш; HTTPS, /api/v1 suffix.
- Backend: DATABASE_URL, OTP_HASH_SECRET, CORS_ORIGINS.
- Email: EMAIL_PROVIDER=smtp, EMAIL_FROM, EMAIL_PUBLIC_BASE_URL, EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USERNAME, EMAIL_SMTP_PASSWORD.
- Storage: STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY. Одоогийн staging wrapper bucket/region-ийг өөрөө тогтооно.
- Phone: VERIFY_MN_API_KEY backend-only; production configuration хамгаалалтыг тойрч гарахгүй. Live phone test энэ аудитын эзэмшигчийн тусдаа gate.
- Google default off. Асаавал client ID/secret, HTTPS redirect URI, GOOGLE_OIDC_STATE_SECRET болон Google console exact callback шаардлагатай.

`/ready` нь `/health/ready`-ийн ижил database readiness probe. `/metrics` нь process-local Prometheus text counters бөгөөд default-аар хаалттай; `METRICS_TOKEN` (32+ тэмдэгт, secret manager) тохируулсан үед зөвхөн `Authorization: Bearer <token>`-той scraper уншина. Endpoint-ийг trusted network/proxy-оор хязгаарла; token-ийг URL, frontend эсвэл log-д бүү оруул. Метрик replica бүр дээр тусдаа бөгөөд restart-д reset болно. 60 секундэд 10 ширхэг 5xx гарвал `http_5xx_spike` structured warning (5 минутын cooldown) бичнэ. Сонголтоор `ALERT_WEBHOOK_URL` нь trusted HTTPS endpoint-д минимал JSON-г best-effort илгээнэ (3 секундын timeout, redirect үгүй); delivery баталгаатай биш, aggregation болон threshold тохиргоог оператор тусад нь хийх шаардлагатай.

`docker-compose.prod.yml` нь операторын хянах reference; `backend/.env.production` дахь `DATABASE_URL` нь compose DB-тэй таарах ёстой. Migration service амжилттай болохоос өмнө API эхлэхгүй. TLS proxy, нууцын удирдлага, backup/restore болон давхардсан release job-уудын serialization-ийг оператор тохируулна. `uv run python scripts/run_maintenance.py` нь хугацаа дууссан auth artifact болон 30 хоногоос хуучин trash restore record-ийг тоолно; устгахын тулд ил тод `--apply` шаардлагатай, `--trash-days`-аар хугацаа өөрчилж болно. Trash цэвэрлэгээ зөвхөн сэргээх metadata-г устгаж, хүн, зураг, холбоог устгахгүй. Фото object cleanup энэ командын хүрээнд байхгүй. `c7a4e8d901b2`, `d2f7183c604e`, `e8b32f901a6d` downgrade нь trash эсвэл эрхийн өгөгдлийг устгах тул production-д автоматаар downgrade бүү хий; backup ба forward-fix ашигла.

API JSON log гаргаж, серверийн `X-Request-ID` хүсэлтийн response/log хооронд хадгална. Log aggregation-д зөвхөн stdout-г ав; request body болон URL query-г proxy/APM талд бүртгэхгүй. `LOG_LEVEL`, `SLOW_REQUEST_THRESHOLD_MS` тохируулж болно. HTTP 429, удаан хүсэлт, DB/storage алдааны event-үүдийг `event`/`error_code` талбараар alert-д холбо.

## Домэйн худалдаж авсны дараа

1. Яг нэр болон registrar эзэмшлийг батална; Cloudflare zone active болгоно.
2. Эхлээд staging.<domain> болон api-staging.<domain> Custom Domain холбоно.
3. Frontend API base, exact backend CORS origin, email public base-г хамтад нь шинэчилнэ. Google enabled бол exact callback-г мөн шинэчилнэ.
4. Шинэ HTTPS hosts дээр login/reload/logout, email links, private upload/read, ordinary/admin/family isolation, mobile/PWA-г дахин шалгана.
5. Production нээлтийн runtime, database/media destination, APP_ENV=production, backup/restore болон access policy-г тусад нь батална. Одоогийн wrapper APP_ENV=staging болон staging bucket-тай: Worker нэрийг солиод шууд production болгохгүй.

Exact mapping/checklist: [CLOUDFLARE_CUSTOM_DOMAIN.md](docs/CLOUDFLARE_CUSTOM_DOMAIN.md). Домэйн нэргүй үед DNS/custom domains/production тохиргоо өөрчлөхгүй.

## Backup, хяналт, rollback

2026-10-13-нд бодит staging application DB (47 хүснэгт/729 мөр) болон private R2-ийн 6 объектыг шифрлэн нөөцөлж, тусгаарласан орчинд сэргээсэн. Бүх мөр, FK, binary SHA-256 болон protected original/thumbnail API шалгалт давсан. Энэ нь provider-native backup/PITR, atomic DB/R2 snapshot эсвэл portable key custody-ийн баталгаа биш. Native/provider backup, зөөврийн key custody, retention/RPO/RTO, missed-backup alert-ийг production нээлтээс өмнө батална. Бодлого батлагдаагүй үед schedule эсвэл автомат устгал идэвхжүүлэхгүй.

[BACKUP_RECOVERY.md](docs/BACKUP_RECOVERY.md), [2026-10-13 бодит restore](docs/DOMAIN_ACTUAL_RESTORE_2026_10_13.md)-ийг ашиглана. Logs body/query/token/credential агуулахгүй; request_id, 5xx, 429, photo_cleanup_exhausted зэрэг aggregate дохиог operator хянана.

## Production auth deployment gate

Frontend and backend are separate Vercel projects in this repository's current GitHub integration:
- frontend project: `guulingiinhan-jy19`
- backend project: `guulingiinhan` with root directory `backend`

Before a production frontend deployment, `NEXT_PUBLIC_API_BASE_URL` is mandatory. The frontend now fails the production build when it is missing instead of silently defaulting browser auth requests to `localhost:8000`.

The frontend's `NEXT_PUBLIC_API_BASE_URL` must point to the deployed backend API base ending in `/api/v1`. The backend `CORS_ORIGINS` must explicitly include the actual HTTPS frontend origin. Backend production settings must also satisfy the existing PostgreSQL, OTP/Twilio, SMTP, HTTPS email-base, and S3-compatible storage validation.

After configuration, verify:
1. frontend build succeeds without a localhost fallback;
2. `GET /health` returns 200;
3. `GET /health/ready` returns 200 with `database=ok`;
4. email registration returns 201 and sends verification mail;
5. verified email login returns 200 and `GET /api/v1/auth/me` remains authenticated after refresh;
6. phone registration/login returns 200 after OTP and persists the session;
7. logout returns 204 and protected routes return 401 afterward.

Do not put API secrets, SMTP credentials, Twilio credentials, database credentials, or auth secrets in `NEXT_PUBLIC_*` variables.

### PostgreSQL client compatibility and isolated restore drill

A PostgreSQL 17 `pg_restore` can emit `SET transaction_timeout = 0`, which PostgreSQL 16 rejects. Use PostgreSQL **16** `pg_dump` and `pg_restore` for the PostgreSQL 16 CI server, not an unversioned runner client. CI runs `scripts/pg-restore-drill.sh` inside `postgres:16-alpine`: the script checks client and server major versions, creates a test marker, takes a custom-format dump, restores with `--exit-on-error --single-transaction` into a new local disposable database, and verifies both marker and Alembic revision. It refuses non-local hosts and source database names outside `guulingiinhan_restore_source_*`; it is **not** a production backup script. A local PG 16.16 client/server drill passed; a PG 17.12 dump/restore against PG 16.16 reproduced the `transaction_timeout` error. CI's container execution is not proof of any deployed environment.

For production, use the managed provider's documented version-compatible backup/snapshot and isolated restore process, protect credentials and encrypted backups, separately back up and verify the object storage, and perform real recovery and application smoke tests before launch. The synthetic local drill does not establish that production backup, storage restoration, or provider delivery is configured or working.
