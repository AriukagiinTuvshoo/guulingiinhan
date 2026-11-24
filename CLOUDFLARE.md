# Cloudflare frontend staging

Custom-domain readiness and hostname cutover steps are documented in [`docs/CLOUDFLARE_CUSTOM_DOMAIN.md`](docs/CLOUDFLARE_CUSTOM_DOMAIN.md). Do not replace staging or production hostnames until the domain owner confirms the exact domain and its Cloudflare zone is active.

The frontend is configured as a separate Cloudflare Worker named `guulingiinhan-staging` in `cloudflare.config.ts`. The existing `guulingiinhan` Worker must remain untouched. Staging uses the separate Cloudflare FastAPI Container, Supabase PostgreSQL project, and private R2 bucket.

## Build and deploy

Use Node.js 22, then run `npm ci`, `npm run typecheck`, and `npm run build:vinext`. Set `NEXT_PUBLIC_API_BASE_URL` to the verified HTTPS backend API base ending in `/api/v1` **before building**. This value is embedded in browser code. The build script rejects a missing or malformed value. Keep database, SMTP, SMS, Google OIDC, and storage secrets out of `NEXT_PUBLIC_*` variables.

Run `npm run start:vinext` for local Worker preview. Once the backend is healthy and staging access is configured, run `npm run deploy:vinext` with Cloudflare credentials for the intended account. Record the deployed staging URL; do not infer it from the Worker name. If a `workers.dev` route is disabled, configure an explicit staging route/domain in Cloudflare before browser testing.

The repository also retains the original `npm run build` Next.js build for comparison. The Cloudflare build uses Vinext's Vite/Workers adapter. A successful build and local preview establish packaging only; they do not verify deployed API, cookies, or private data behavior.

## Backend and auth gates

Before connecting staging, confirm `GET https://<backend>/health` and `/health/ready` both return 200, with `database=ok` from readiness. The backend needs working staging PostgreSQL and S3-compatible storage. Email, SMS, and OIDC may remain disabled until real providers are configured; routes that need them will be unavailable. Add the **actual** Cloudflare staging HTTPS origin to backend `CORS_ORIGINS` with credentials enabled. The session cookie's `Secure; HttpOnly; SameSite=None` attributes require HTTPS. Test registration, login, refresh with `/api/v1/auth/me`, logout, family isolation, and private media access in a browser. Do not use a Vercel preview URL that redirects to Vercel SSO as the API base.

Current staging URLs: frontend `https://guulingiinhan-staging.tuvshoo0331.workers.dev` and backend API `https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/api/v1`. The frontend build variable `NEXT_PUBLIC_API_BASE_URL` points to that backend. Backend `CORS_ORIGINS` lists the exact frontend origin.

Email registration and password reset require a real delivery provider. The staging backend currently supports SMTP: configure `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `EMAIL_PUBLIC_BASE_URL` (the staging frontend origin), `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USERNAME`, and `EMAIL_SMTP_PASSWORD` on the **backend staging Worker only**. `EMAIL_SMTP_PORT` defaults to `587`. Phone registration and login already use OTP endpoints; to activate them, configure `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` on the same Worker. Put credentials in Cloudflare secrets, not source files or frontend variables. The registration and login UI displays provider availability; it must not claim that a code or email was sent when delivery is disabled. Verify live delivery, browser login, family isolation, and private media before treating staging as fully functional.

## Release and recovery

Deploy staging first. Leave `guulingiinhan` untouched until staging checks pass and the operator approves the production route. Cloudflare rollback can repoint the route to the prior Worker version; keep that version and its configuration recorded. Backend migrations require separate forward-fix or database restore planning. Managed PostgreSQL and object storage backups and an isolated restore test are still required before production data use. See `DEPLOYMENT.md` for the full backend checklist.
