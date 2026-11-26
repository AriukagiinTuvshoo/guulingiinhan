export const dynamic = 'force-dynamic';

const FORWARDED_REQUEST_HEADERS = [
  'cookie',
  'x-csrf-token',
  'content-type',
  'accept',
  'accept-language',
  'origin',
  'referer',
  'user-agent',
  'last-event-id',
  'range',
  'if-none-match',
  'if-modified-since',
];

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-encoding',
  'content-length',
  'set-cookie',
]);

function resolveUpstreamBase(): string | null {
  const raw = (
    process.env.BACKEND_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const isLocal =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (
      (parsed.protocol !== 'https:' && !isLocal) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    if (parsed.pathname.replace(/\/+$/, '') !== '/api/v1') {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

async function handleProxy(request: Request): Promise<Response> {
  const upstreamBase = resolveUpstreamBase();
  if (!upstreamBase) {
    return new Response(
      JSON.stringify({
        detail: 'Серверийн API тохиргоо дутуу байна.',
        error_code: 'API_CONFIGURATION_MISSING',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const reqUrl = new URL(request.url);
  if (new URL(upstreamBase).origin === reqUrl.origin) {
    return new Response(
      JSON.stringify({
        detail: 'API proxy цикл тохиргоо илэрлээ.',
        error_code: 'API_CONFIGURATION_INVALID',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const suffix = reqUrl.pathname.replace(/^\/api\/v1/, '') + reqUrl.search;
  const targetUrl = `${upstreamBase}${suffix}`;

  const forwardHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const val = request.headers.get(name);
    if (val !== null) {
      forwardHeaders.set(name, val);
    }
  }
  if (!forwardHeaders.has('origin') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    forwardHeaders.set('origin', reqUrl.origin);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 0) {
      body = buf;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body,
      redirect: 'manual',
    });
  } catch {
    return new Response(
      JSON.stringify({
        detail: 'Үндсэн сервертэй холбогдож чадсангүй.',
        error_code: 'UPSTREAM_UNAVAILABLE',
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  const upstreamContentType = (upstream.headers.get('content-type') || '').toLowerCase();
  const isRenderColdStart =
    (upstream.status === 502 || upstream.status === 503 || upstream.status === 504) &&
    (upstream.headers.get('x-render-routing') === 'no-deploy' ||
      !upstreamContentType.includes('application/json'));
  if (isRenderColdStart) {
    return new Response(
      JSON.stringify({
        detail: 'Сервер дөнгөж асаж байна. Түр хүлээнэ үү.',
        error_code: 'BACKEND_WAKING',
      }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'retry-after': '5',
          'cache-control': 'no-store',
        },
      },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.append(key, value);
    }
  });

  const headersWithGetSetCookie = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof headersWithGetSetCookie.getSetCookie === 'function'
      ? headersWithGetSetCookie.getSetCookie()
      : (() => {
          const single = upstream.headers.get('set-cookie');
          return single ? [single] : [];
        })();

  for (const cookie of setCookies) {
    const rewritten = cookie
      .replace(/;\s*Domain=[^;]+/gi, '')
      .replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
    responseHeaders.append('set-cookie', rewritten);
  }

  const nullBody =
    upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(nullBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export {
  handleProxy as GET,
  handleProxy as POST,
  handleProxy as PUT,
  handleProxy as PATCH,
  handleProxy as DELETE,
  handleProxy as HEAD,
  handleProxy as OPTIONS,
};
