# FastAPI backend staging on Cloudflare Containers

This configuration creates a **separate** `guulingiinhan-backend-staging` Worker and Container. It does not change the existing `guulingiinhan` Worker. The Worker forwards the original request to the existing FastAPI app and returns its response without changing authentication, cookies, CORS, or API routes.

## Isolated resources

- R2 bucket: `guulingiinhan-staging-media` (private; public `r2.dev` domain disabled).
- Staging PostgreSQL: Supabase project `gzwekdfuxngtukskzelp` (`guulingiinhan-staging`, `ap-northeast-1`). Do not connect a production database.
- Worker and Container: defined by `wrangler.backend-staging.jsonc`; neither should use the name `guulingiinhan`.

## Runtime configuration

The Container receives configuration from Worker secrets. Set the following **staging-only** values in the Cloudflare Worker, without committing their values: `DATABASE_URL`, `CORS_ORIGINS`, `OTP_HASH_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `EMAIL_FROM`, `EMAIL_PUBLIC_BASE_URL`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`. Optional: `EMAIL_SMTP_PORT` (defaults to `587`), `GOOGLE_OIDC_ENABLED` (defaults to `false`) and, when enabled, `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `GOOGLE_OIDC_REDIRECT_URI`, `GOOGLE_OIDC_STATE_SECRET`.

The Worker fixes `APP_ENV=production`, `SMS_PROVIDER=twilio`, `EMAIL_PROVIDER=smtp`, `STORAGE_PROVIDER=s3`, `STORAGE_REGION=auto`, and the staging R2 bucket name. FastAPI therefore keeps its existing production settings validation. There is no `SESSION_SECRET` setting in this app: sessions use random tokens whose hashes are stored in PostgreSQL. Set `CORS_ORIGINS` to the actual staging frontend HTTPS origin, not `*`. The backend API base is `https://<actual-backend-staging-host>/api/v1` after deployment.

The Supabase database needs a connection string with the correct password and TLS setting. Keep it outside Git. Its default table, sequence, and function grants to `anon`, `authenticated`, and `service_role` were revoked for future objects created by `postgres`; this was verified through `pg_default_acl`. Verify that Alembic's database role has equivalent restricted defaults and that the Data API cannot read application tables. Disabling the Data API in the Supabase dashboard is preferred because FastAPI is the only intended data access layer.

## Controlled migrations and release

The Dockerfile now starts Uvicorn only. Migrations are a **separate** operator step against the dedicated staging database:

1. Verify the connection points to Supabase project `gzwekdfuxngtukskzelp`, confirm a staging backup, then run `alembic heads` and inspect pending migrations.
2. Run `alembic upgrade head` once from a controlled environment with that staging `DATABASE_URL`.
3. Run `alembic current` and `alembic check`; record the revision. Do not run migrations from every Container startup.
4. Set Worker secrets, then from `backend/` run `npm ci` and `npm run deploy:staging`. A Docker-compatible builder is required for local deployment from the Dockerfile. Workers Builds may build the image remotely if configured for this staging Worker.
5. Record the **actual** public Worker HTTPS URL and check `/health` = 200 and `/health/ready` = 200 (`database=ok`). A 503 from the Worker means mandatory staging configuration has not been supplied; it is not a successful health check.
6. Test unauthenticated and authenticated `/api/v1/auth/me` and `/api/v1/families`, login/refresh/logout, family isolation and IDOR, minor/guardian rules, R2 upload/read/unauthorized read/delete, browser cookie/CORS behavior, and the staging frontend. Measure cold start and request latency before production promotion.

No production Worker, database, bucket, or frontend API URL should be changed by this staging workflow.
