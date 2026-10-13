# Cloudflare custom-domain readiness

Current verification: 2026-10-13 (Asia/Tokyo). The owner confirms the project domain has not been purchased. This runbook prepares cutover after purchase and active-zone verification; it does not modify DNS or Worker routes.

Current API readiness/CORS/anonymous gate: 18/18 PASS. Staging PostgreSQL is healthy; all 47 application tables have RLS enabled and anon/authenticated direct table privileges are absent. Actual SMTP verification/reset links and session revocation were checked with an authorized disposable mailbox alias. These observations do not prove DNS/TLS, email links, cookies or PWA installation on a future hostname.

The existing backend wrapper explicitly sets APP_ENV=staging and a staging media bucket. A production launch must select and verify separate runtime/provider configuration rather than copy a staging Worker under a different name. Earlier release/version entries below are historical, not the current deployed revision.

## Current account state

- The Cloudflare account has a `site.app` zone in `initializing` state. `activated_on` is empty, so Cloudflare has not confirmed the assigned nameservers are active. Verify that this is the domain actually owned by the project before changing registrar nameservers.
- No custom Worker domains are attached to `guulingiinhan-staging`, `guulingiinhan-backend-staging`, or the production Worker.
- Current staging remains available on its `workers.dev` hosts. Its backend API base is `https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/api/v1`.
- The frontend build embeds `NEXT_PUBLIC_API_BASE_URL`; the backend requires exact HTTPS origins in `CORS_ORIGINS`. Email links and Google OAuth callbacks also use configured hostnames. A hostname change is incomplete until all four point to the same intended environment.

## Recommended host layout

Use separate hostnames for browser and API traffic, under one confirmed Cloudflare zone:

| Environment | Frontend Worker | Backend Worker/API |
| --- | --- | --- |
| Staging | `staging.<confirmed-domain>` → `guulingiinhan-staging` | `api-staging.<confirmed-domain>` → `guulingiinhan-backend-staging` |
| Production | `<confirmed-domain>` and optionally `www.<confirmed-domain>` → the explicitly selected production frontend | `api.<confirmed-domain>` → the explicitly selected production API |

Custom Domains are appropriate when a Worker is the origin. Cloudflare's [Custom Domains guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) requires an active zone and creates the DNS record and TLS certificate. Use **Workers & Pages → Worker → Settings → Domains & Routes → Add → Custom Domain**. Do not use a Route unless there is an existing origin server behind it. The requested hostname must not already have a conflicting CNAME.

## Hostname-dependent settings

For staging, substitute the confirmed domain only after the staging custom domains have been attached:

1. Attach `staging.<domain>` to `guulingiinhan-staging` and `api-staging.<domain>` to `guulingiinhan-backend-staging`.
2. In the frontend staging build trigger, set non-secret `NEXT_PUBLIC_API_BASE_URL=https://api-staging.<domain>/api/v1`, then build and deploy the staging Worker. The build guard requires HTTPS and the `/api/v1` suffix.
3. In backend staging Worker secrets/variables, set `CORS_ORIGINS=https://staging.<domain>` and `EMAIL_PUBLIC_BASE_URL=https://staging.<domain>`. Keep the CORS value as an origin only: no path or trailing slash.
4. Google OIDC remains intentionally disabled (`GOOGLE_OIDC_ENABLED=false`). Only after separate owner authorization to enable it, set `GOOGLE_OIDC_REDIRECT_URI=https://api-staging.<domain>/api/v1/auth/google/callback` and add that exact URI to the Google OAuth client's authorized redirect URIs. Do not copy staging values to production.
5. Retain the existing secure, HttpOnly session cookie. The API does not set a parent-domain cookie; the browser sends its API-host cookie to the API and CORS must allow the exact frontend origin with credentials.
6. Verify `/health`, `/health/ready`, registration/email verification, login/refresh/logout, CORS preflight, private photo access, and all key routes on the custom staging host before considering production.
7. Hosted session cookies currently use `Secure; HttpOnly; SameSite=None; Path=/` with no `Domain` attribute. Keep cookies bound to the API hostname. Test browsers with third-party-cookie restrictions; related HTTPS frontend/API hosts on the confirmed domain are preferable to unrelated hosts. The exact frontend origin must pass the existing Origin/CSRF checks. Do not broaden CORS or remove secure flags to fix a failed cutover.
8. Verification and reset emails use `EMAIL_PUBLIC_BASE_URL`; their tokens remain URL fragments (`/email-verification#token=...` and `/password-reset#token=...`). Test the exact generated links and prevent their capture in screenshots/logs. No actual mailbox delivery was tested in this gate because the owner deferred it.
9. Private R2 remains behind the authenticated API; there is no public `media.<domain>` or bucket custom domain to add. Verify allowed profile photo and Memory/Story photo requests on the new API host, with foreign-Family and anonymous requests denied. Recovery backups must also have no public/custom bucket domain.

Production requires a separately verified production API and its own exact `NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGINS`, `EMAIL_PUBLIC_BASE_URL`, and optional Google callback. `DEPLOYMENT.md` records outstanding production provider and backup gates. Do not attach a production hostname or change production environment values as part of staging validation.

## Cutover acceptance checklist

- The domain owner confirms the registered domain and controls its registrar account.
- The domain is an active Cloudflare zone with assigned nameservers activated; DNSSEC and any registrar-side nameserver setup are verified.
- No conflicting records occupy the selected hostnames.
- Both Workers show the intended Custom Domain and a healthy TLS certificate.
- Frontend bundle points to the matching API host; backend CORS allows only the matching frontend origin.
- Email links return to the correct environment; OAuth callback matches exactly if OIDC is enabled.
- Browser checks confirm session persistence after refresh and that private family content remains protected.
- The prior `workers.dev` route and prior Worker version remain available for rollback until cutover is accepted.

The current account evidence is not enough to identify `site.app` as the production domain or to prove its registrar nameserver change is complete. No DNS, Worker domain, production secret, or production deployment was changed during this audit.

## Verified staging release before domain purchase

- Application commit: `736dd58411c64829566c195b0bd6b4ed14d81a9b`, integration branch `codex/integration-regression-2026-10-02`.
- Both staging Workers automatically build from this branch. Frontend and backend builds completed successfully and their versions reached 100% traffic. Pushing this branch does not deploy the production Worker.
- Frontend version: `9653e842-a2e0-48b2-9817-d7cea5d968ea`; backend version: `80031606-6a0a-4888-9c04-eecc024ef5b3`.
- Health and readiness return HTTP 200, database `ok`. Anonymous requests to Admin, shared ancestry, community, and private People APIs return HTTP 401.
- Real email configuration is enabled. Phone and Google configuration are disabled. Configuration availability does not prove delivery; live email verification/reset delivery and SMS OTP still need provider checks before production.
- Supabase staging is healthy, on PostgreSQL 17, with schema revision `b10c8e621f4a`. The connected organization is on the free plan. Automatic paid-plan backups must not be assumed; configure a protected database export and private R2 backup, then run an isolated restore drill.
- Cloudflare still reports `site.app` as initializing, no Worker custom domains. Media bucket: `guulingiinhan-staging-media`. Do not infer ownership of `site.app` from its presence in the account.

## Go-live order and rollback

1. Buy and confirm the exact domain; activate its Cloudflare zone.
2. Verify SMTP delivery, production-required Twilio OTP configuration, database backup, private media backup, and an isolated restore. Keep credentials in provider secret settings.
3. Attach only the two staging Custom Domains first and apply the hostname settings above together.
4. Test registration/verification, reset, login/reload/logout, private media, cross-family denial, root Admin, and new Memory form on those staging hosts.
5. Record the accepted commit, Worker version IDs, configuration names, and backup/restore evidence. Obtain approval for the concrete production cutover.
6. For a staging hostname rollback, restore the previous frontend API base and exact backend CORS/email origins, then deploy the previous staging versions. Keep `workers.dev` reachable during the transition. Never use a destructive database downgrade to roll back a frontend release.
