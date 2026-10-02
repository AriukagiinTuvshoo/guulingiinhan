import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const routes = ['/', '/login', '/dashboard', '/admin', '/tree', '/people', '/profile', '/stories', '/memories', '/archives', '/settings', '/activities'];
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production' },
});
let output = '';
child.stdout.on('data', (chunk) => { output += String(chunk); });
child.stderr.on('data', (chunk) => { output += String(chunk); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next server stopped: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`);
      if (response.ok) { ready = true; break; }
    } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Next server did not start: ${output}`);
  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    const html = await response.text();
    assert.equal(response.status, 200, `${route} returned ${response.status}`);
    assert.match(html, /<html[^>]+lang="mn"/, `${route} did not render the Mongolian app shell`);
    assert.ok(html.length > 1000, `${route} rendered an empty page`);
    process.stdout.write(`PASS ${route}\n`);
  }
} finally {
  child.kill();
}
