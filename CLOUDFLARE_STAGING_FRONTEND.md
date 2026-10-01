# Cloudflare staging frontend

The frontend staging target is the existing `guulingiinhan-staging` Worker at:

`https://guulingiinhan-staging.tuvshoo0331.workers.dev`

`wrangler.staging.jsonc` is intentionally separate from production. It preserves the Worker's existing `ASSETS` binding and `nodejs_compat` setting. It does not declare backend bindings or secrets. The deploy script uses `--keep-vars` so dashboard-managed values remain intact.

## Build and deploy

From the repository root:

```bash
npm ci
npm run deploy:staging
```

The script runs the official OpenNext Cloudflare build and deploys only `guulingiinhan-staging`. It builds with the public staging API base `https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/api/v1`. No secret is needed in the frontend build. The backend's current staging CORS origin already includes the frontend Worker origin.

To preview in a local Workers runtime:

```bash
npm run cf:build:staging
npm run cf:preview:staging
```

The PR also receives builds from other Cloudflare Worker integrations. These are separate targets: the production `guulingiinhan` Preview command fails because its default Wrangler config has no `previews` block; `guulingiinhan-backend-staging` reports preview-worker creation failure even though the account API lists that Worker; and `guulingiinhanback` is a stale Worker name that does not exist. The staging frontend has preview builds disabled. Its own production trigger was manually run against the exact PR source commit and succeeded. Do not point the backend build at this config.

## Safety and rollback

- Do not use this config to deploy `guulingiinhan` or `guulingiinhan-backend-staging`.
- The dashboard UI change requires no backend migration and changes no staging backend secret.
- Latest successful Cloudflare Build ID: `1defb773-97b4-40aa-a6e9-f280a034f0a7` for source commit `1aa7a9602b1db0b30decf4ec44acae00ee00effc`.
- Active staging deployment: `ee89d129-fb17-4861-9f4d-840ffc6e332d`, version `5d46e30d-396e-41fb-80a7-e49240660c25` at 100% traffic. The public `/`, `/login`, `/register`, and backend `/health/ready` routes were checked.
- Before this update, the active staging frontend version was `773e1fcd-8658-4c7e-b151-9f57fecb4176`. If a regression appears, use Cloudflare Workers' deployment history to restore that version.
