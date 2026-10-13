// A maintenance Worker, separate from the app and its API/authentication.
// Configure private SOURCE/BACKUP R2 bindings and an RSA-OAEP public key.
// HTTP execution requires an operator secret and expires after the one-off
// recovery drill. No private objects or credentials are returned over HTTP.
const FORMAT = 'guulingiinhan-media-v1';
const bytesToBase64 = bytes => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
};
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function backupMedia(env) {
  if (env.BACKUP_ENVIRONMENT !== 'staging' || !env.SOURCE || !env.BACKUP) throw new Error('Invalid recovery environment');
  const expires = Number(env.BACKUP_EXPIRES_AT);
  if (!Number.isFinite(expires) || Date.now() > expires) throw new Error('Recovery authorization expired');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(env.BACKUP_RUN_ID || '')) throw new Error('Invalid recovery run ID');
  const encoder = new TextEncoder();
  const publicDer = Uint8Array.from(atob(env.RECOVERY_PUBLIC_KEY.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const publicKey = await crypto.subtle.importKey('spki', publicDer, {name:'RSA-OAEP',hash:'SHA-256'}, false, ['encrypt']);
  const runId = env.BACKUP_RUN_ID;
  const prefix = `staging/${runId}/`;
  if (await env.BACKUP.head(`${prefix}media-manifest.json`)) throw new Error('Recovery run already completed');
  const records = [];
  const sourceVersions = new Map();
  let cursor, totalBytes = 0;
  do {
    const page = await env.SOURCE.list({limit: 1000, cursor});
    for (const listed of page.objects) {
      if (sourceVersions.has(listed.key)) throw new Error('Duplicate source object');
      sourceVersions.set(listed.key, listed.etag);
      const object = await env.SOURCE.get(listed.key);
      if (!object || object.etag !== listed.etag) throw new Error('Source changed during backup; retry after writes stop');
      if (object.size > 10 * 1024 * 1024 || (totalBytes += object.size) > 50 * 1024 * 1024) throw new Error('Backup size limit exceeded; use the operator bulk procedure');
      const bytes = new Uint8Array(await object.arrayBuffer());
      const checksum = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
      const payload = encoder.encode(JSON.stringify({key: listed.key, body: bytesToBase64(bytes), sha256: checksum,
        http_metadata: object.httpMetadata || {}, custom_metadata: object.customMetadata || {}}));
      const aes = await crypto.subtle.generateKey({name:'AES-GCM',length:256}, true, ['encrypt']);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode(FORMAT)}, aes, payload);
      const wrappedKey = await crypto.subtle.encrypt('RSA-OAEP', publicKey, await crypto.subtle.exportKey('raw', aes));
      const opaqueName = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(listed.key))));
      const backupKey = `${prefix}objects/${opaqueName}.json`;
      await env.BACKUP.put(backupKey, JSON.stringify({format:FORMAT,wrapped_key:bytesToBase64(new Uint8Array(wrappedKey)),
        nonce:bytesToBase64(nonce),ciphertext:bytesToBase64(new Uint8Array(ciphertext))}), {httpMetadata:{contentType:'application/octet-stream'}});
      records.push({backup_key:backupKey,bytes:bytes.length});
    }
    if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new Error('Invalid source pagination');
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // Detect additions, removals or replacement while encrypting. This is a
  // bounded consistency check, not an atomic snapshot across database/R2.
  const remaining = new Map(sourceVersions);
  do {
    const page = await env.SOURCE.list({limit: 1000, cursor});
    for (const listed of page.objects) {
      if (!remaining.has(listed.key) || remaining.get(listed.key) !== listed.etag) throw new Error('Source changed during backup; no completed manifest written');
      remaining.delete(listed.key);
    }
    if (page.truncated && (!page.cursor || page.cursor === cursor)) throw new Error('Invalid source pagination');
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (remaining.size) throw new Error('Source changed during backup; no completed manifest written');
  const manifest = {format:FORMAT,environment:'staging',run_id:runId,object_count:records.length,total_bytes:totalBytes,objects:records};
  await env.BACKUP.put(`${prefix}media-manifest.json`, JSON.stringify(manifest), {httpMetadata:{contentType:'application/octet-stream'}});
  return manifest;
}

export default {
  async fetch(request, env) {
    const expected = env.BACKUP_TRIGGER_SECRET || '';
    const actual = request.headers.get('X-Recovery-Trigger') || '';
    let mismatch = expected.length ^ actual.length;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
    if (!env.BACKUP_TRIGGER_SECRET || request.method !== 'POST' || mismatch) return new Response('Forbidden', {status:403});
    const expiresAt = Number(env.BACKUP_EXPIRES_AT);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return new Response('Expired', {status:410});
    if (await env.BACKUP.head(`staging/${env.BACKUP_RUN_ID}/media-manifest.json`)) return new Response('Already completed', {status:409});
    const manifest = await backupMedia(env);
    return Response.json({object_count:manifest.object_count,total_bytes:manifest.total_bytes}, {headers:{'Cache-Control':'no-store'}});
  },
};
