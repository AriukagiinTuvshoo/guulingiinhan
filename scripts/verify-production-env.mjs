const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

if (!apiBase) {
  console.error('Production build requires NEXT_PUBLIC_API_BASE_URL. Configure the frontend build environment.');
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(apiBase);
} catch {
  console.error('NEXT_PUBLIC_API_BASE_URL must be an absolute URL.');
  process.exit(1);
}

if (
  (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) ||
  parsed.username || parsed.password || parsed.search || parsed.hash ||
  parsed.pathname.replace(/\/+$/, '') !== '/api/v1'
) {
  console.error('NEXT_PUBLIC_API_BASE_URL must be an HTTPS API URL ending in /api/v1 (localhost HTTP is allowed for local builds).');
  process.exit(1);
}
