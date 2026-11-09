import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';

const directory = resolve(process.argv[2] ?? process.env.PREVIEW_DIR ?? 'var/preview');
const night = process.env.PREVIEW_NIGHT ?? '2026-10-28';

if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) {
  throw new Error('PREVIEW_NIGHT must have the form YYYY-MM-DD');
}

// Do not import server.ts: exporting needs neither a heartbeat nor a public listener.
const server = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 });

try {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port assigned');

  const response = await fetch(`http://127.0.0.1:${address.port}/digest/${night}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Digest export failed: HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Digest export did not return HTML');
  }

  // The server-rendered layout includes its stylesheet and lane banner; no browser needed.
  const html = await response.text();
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.html'), html, 'utf8');
  console.log(`Preview saved to ${resolve(directory, 'index.html')}`);
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
