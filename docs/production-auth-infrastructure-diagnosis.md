# Production Auth Infrastructure Diagnosis

Date: 2026-09-26

## Repository-side findings

- Frontend auth calls the API through `NEXT_PUBLIC_API_BASE_URL` in `lib/api.ts`. The repository default is the development URL `http://localhost:8000/api/v1`; there is no production API URL hardcoded in the repository.
- The backend is intentionally deployable on Vercel: `backend/pyproject.toml` declares `[tool.vercel] entrypoint = "index:app"`, and `backend/index.py` exports the FastAPI `app`.
- Backend public liveness endpoint: `GET /health`.
- Backend database readiness endpoint: `GET /health/ready`.
- Auth endpoints are mounted under `/api/v1/auth`.
- Frontend requests use `credentials: 'include'`.
- Production session cookies are `Secure`, `HttpOnly`, `SameSite=None`, and `Path=/`.
- Production CORS accepts only explicit HTTPS origins, allows credentials, and rejects non-allowed mutation origins. The code does not use wildcard credentialed CORS.
- Production backend startup validation requires PostgreSQL, explicit HTTPS CORS origins, a real SMTP email provider, Twilio SMS configuration, HTTPS email verification base URL, and S3-compatible storage.
- Email registration intentionally requires verification before password login. Phone registration uses OTP and creates the authenticated session only after OTP verification.
- The backend creates a database-backed session row and sets the session cookie on successful phone registration/login and password login.

## Deployment evidence available to this investigation

GitHub's Vercel status metadata identifies two Vercel projects associated with the repository. The Vercel bot metadata attached to PR #33 identifies:

- `guulingiinhan-jy19` as the frontend project.
- `guulingiinhan` with repository root directory `backend` as the backend project.

The final PR #33 commit also has successful GitHub Vercel status checks for both project contexts. Those checks prove deployment status only; they do not prove runtime authentication, database connectivity, cookies, or environment-variable correctness.

## External verification boundary

The connected Vercel account cannot currently expose the required production runtime/configuration:

- Vercel project listing returns zero projects for the connected team.
- Direct project/deployment inspection returns not-found for the known project/deployment identifiers.
- Vercel runtime-log access is therefore unavailable.
- Vercel environment-variable inspection is unavailable.
- Vercel URL fetches for the known/expected public hosts are reported as unavailable to this connection.
- No production database credentials or direct database connection are available from the repository connection.

Because of this boundary, the following production facts cannot be established from the available tooling:

- the actual value/presence of `NEXT_PUBLIC_API_BASE_URL` in production;
- the actual backend `CORS_ORIGINS` value;
- whether the backend process is healthy and reachable at its deployed public URL;
- whether the production backend can connect to PostgreSQL;
- whether production SMTP/Twilio/storage variables are present and valid;
- the actual HTTP status/error/request ID returned by a production `POST /api/v1/auth/register`;
- whether the production browser stores and returns the session cookie.

## Exact external access required

To finish the repair, the connected Vercel authorization must be extended to the team/project containing the two deployments so that project settings, production environment variable metadata, deployment details, and runtime logs can be inspected.

After that access is available, the minimum evidence required is:

1. production frontend `NEXT_PUBLIC_API_BASE_URL` presence/correctness (value should not be exposed in logs);
2. production backend `APP_ENV`, `DATABASE_URL` presence, `CORS_ORIGINS`, `EMAIL_PROVIDER`, `EMAIL_PUBLIC_BASE_URL`, SMS provider configuration, and required storage configuration (secret values must not be exposed);
3. backend `/health` and `/health/ready` responses;
4. one fresh test registration response for `POST /api/v1/auth/register`, recording only status, `error_code`, and `request_id`;
5. confirmation that the created test account receives and completes email verification, then logs in and persists the authenticated session;
6. a browser smoke test through Dashboard and protected routes, followed by refresh, logout, and login again.

No speculative backend, CORS, cookie, database, SMTP, SMS, storage, or Vercel configuration change was made in this diagnosis.
