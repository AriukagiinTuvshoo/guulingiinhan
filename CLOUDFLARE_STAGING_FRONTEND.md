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

The branch's Cloudflare Git checks for `guulingiinhan` and `guulingiinhan-backend-staging` target other Worker names and report that their preview Workers do not exist. They are not the staging frontend Worker. The staging frontend is deployed explicitly with the root config above; do not point the backend build at this config.

## Safety and rollback

- Do not use this config to deploy `guulingiinhan` or `guulingiinhan-backend-staging`.
- The dashboard UI change requires no backend migration and changes no staging backend secret.
- Before this update, the active staging frontend version was `773e1fcd-8658-4c7e-b151-9f57fecb4176`. If a regression appears, use Cloudflare Workers' deployment history to restore that version.
