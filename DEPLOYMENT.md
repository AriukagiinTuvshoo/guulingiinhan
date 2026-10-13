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

API нь Python Workers/Pyodide-д шууд ажиллахгүй. backend/Dockerfile дотор Python 3.12, native psycopg/Pillow ажиллана. Container root бус хэрэглэгчтэй, access log унтраалттай. Wrapper нь анхны request/response/cookie-г дамжуулна. Browser Supabase Auth/Data API-д шууд хандахгүй.

Frontend: https://guulingiinhan-staging.tuvshoo0331.workers.dev

API: https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/api/v1

## Build ба шалгалт

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

Secret утгыг commit/chat/screenshot/build log/NEXT_PUBLIC_ хувьсагчид оруулахгүй. Runtime API role schema DDL хийдэггүй; migration-ийг хяналттай operator/CI процессоор түрүүлж гүйцэтгэнэ. /health нь liveness, /health/ready нь database readiness.

## Домэйн худалдаж авсны дараа

1. Яг нэр болон registrar эзэмшлийг батална; Cloudflare zone active болгоно.
2. Эхлээд staging.<domain> болон api-staging.<domain> Custom Domain холбоно.
3. Frontend API base, exact backend CORS origin, email public base-г хамтад нь шинэчилнэ. Google enabled бол exact callback-г мөн шинэчилнэ.
4. Шинэ HTTPS hosts дээр login/reload/logout, email links, private upload/read, ordinary/admin/family isolation, mobile/PWA-г дахин шалгана.
5. Production нээлтийн runtime, database/media destination, APP_ENV=production, backup/restore болон access policy-г тусад нь батална. Одоогийн wrapper APP_ENV=staging болон staging bucket-тай: Worker нэрийг солиод шууд production болгохгүй.

Exact mapping/checklist: [CLOUDFLARE_CUSTOM_DOMAIN.md](docs/CLOUDFLARE_CUSTOM_DOMAIN.md). Домэйн нэргүй үед DNS/custom domains/production тохиргоо өөрчлөхгүй.

## Backup, хяналт, rollback

Историк encrypted application snapshot restore drill бий. Үүнийг provider-native backup/PITR, өнөөгийн DB/media restore болон portable key custody-тэй адилтгахгүй. Native/provider backup, private media backup, key custody, retention/RPO/RTO, missed-backup alert-ийг production нээлтээс өмнө батална. Бодлого батлагдаагүй үед schedule эсвэл автомат устгал идэвхжүүлэхгүй.

[BACKUP_RECOVERY.md](docs/BACKUP_RECOVERY.md), [2026-10-13 recovery audit](docs/DOMAIN_RECOVERY_AUDIT_2026_10_13.md)-ийг ашиглана. Logs body/query/token/credential агуулахгүй; request_id, 5xx, 429, photo_cleanup_exhausted зэрэг aggregate дохиог operator хянана.

Кодын rollback-д өмнөх staging frontend/backend Worker versions болон matching API/CORS/email тохиргоог сэргээнэ. Cutover батлагдтал workers.dev хаягийг хадгална. Кодын rollback нь database downgrade эсвэл өгөгдөл устгах зөвшөөрөл биш.
