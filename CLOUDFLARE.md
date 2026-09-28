# Cloudflare frontend staging

The frontend is configured as a separate Cloudflare Worker named `guulingiinhan-staging` in `cloudflare.config.ts`. The existing `guulingiinhan` Worker must remain untouched. The FastAPI backend, PostgreSQL database, and object storage stay on their existing infrastructure.

## Build and deploy

Use Node.js 22, then run `npm ci`, `npm run typecheck`, and `npm run build:vinext`. Set `NEXT_PUBLIC_API_BASE_URL` to the verified HTTPS backend API base ending in `/api/v1` **before building**. This value is embedded in browser code. The build script rejects a missing or malformed value. Keep database, SMTP, SMS, Google OIDC, and storage secrets out of `NEXT_PUBLIC_*` variables.

Run `npm run start:vinext` for local Worker preview. Once the backend is healthy and staging access is configured, run `npm run deploy:vinext` with Cloudflare credentials for the intended account. Record the deployed staging URL; do not infer it from the Worker name. If a `workers.dev` route is disabled, configure an explicit staging route/domain in Cloudflare before browser testing.

The repository also retains the original `npm run build` Next.js build for comparison. The Cloudflare build uses Vinext's Vite/Workers adapter. A successful build and local preview establish packaging only; they do not verify deployed API, cookies, or private data behavior.

## Backend and auth gates

Before connecting staging, confirm `GET https://<backend>/health` and `/health/ready` both return 200, with `database=ok` from readiness. The backend must have a working PostgreSQL connection and its required production SMTP, SMS, OIDC, and S3-compatible storage configuration. Add the **actual** Cloudflare staging HTTPS origin to backend `CORS_ORIGINS` with credentials enabled. The session cookie's `Secure; HttpOnly; SameSite=None` attributes require HTTPS. Test registration, login, refresh with `/api/v1/auth/me`, logout, family isolation, and private media access in a browser. Do not use a Vercel preview URL that redirects to Vercel SSO as the API base.

Current backend discovery: the previously linked Vercel preview redirects to Vercel SSO; the candidate stable `guulingiinhan-a6te.vercel.app/health` returned HTTP 500 on 2026-09-29. Neither is a verified usable API endpoint. Replace this observation after the backend operator provides a healthy public HTTPS URL.

## Release and recovery

Deploy staging first. Leave `guulingiinhan` untouched until staging checks pass and the operator approves the production route. Cloudflare rollback can repoint the route to the prior Worker version; keep that version and its configuration recorded. Backend migrations require separate forward-fix or database restore planning. Managed PostgreSQL and object storage backups and an isolated restore test are still required before production data use. See `DEPLOYMENT.md` for the full backend checklist.
