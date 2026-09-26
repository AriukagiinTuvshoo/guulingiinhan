const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

if (process.env.VERCEL === '1' && !apiBase) {
  console.error(
    'Production Vercel build requires NEXT_PUBLIC_API_BASE_URL. Configure it on the frontend Vercel project before deploying.',
  );
  process.exit(1);
}

if (apiBase && !/^https?:\/\//.test(apiBase) && !apiBase.startsWith('/')) {
  console.error('NEXT_PUBLIC_API_BASE_URL must be an absolute http(s) URL or a root-relative path.');
  process.exit(1);
}
