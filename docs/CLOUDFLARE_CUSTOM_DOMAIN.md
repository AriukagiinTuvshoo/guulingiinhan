# Cloudflare custom-domain readiness

Audit date: 2026-10-02. This runbook describes the domain cutover after the domain owner confirms the exact domain and its Cloudflare zone is active. It does not modify DNS or Worker routes.

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
4. If Google OIDC is enabled, set `GOOGLE_OIDC_REDIRECT_URI=https://api-staging.<domain>/api/v1/auth/google/callback` and add that exact URI to the Google OAuth client's authorized redirect URIs. Do not copy staging values to production.
5. Retain the existing secure, HttpOnly session cookie. The API does not set a parent-domain cookie; the browser sends its API-host cookie to the API and CORS must allow the exact frontend origin with credentials.
6. Verify `/health`, `/health/ready`, registration/email verification, login/refresh/logout, CORS preflight, private photo access, and all key routes on the custom staging host before considering production.

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
