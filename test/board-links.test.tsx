import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const directories: string[] = [];

function tempRuns(): string {
  const directory = mkdtempSync(join(process.cwd(), '.board-links-test-'));
  directories.push(directory);
  return directory;
}

function event(status: string): string {
  return JSON.stringify({
    at: '2026-10-29T01:00:00+01:00', job: 'lane/sync', status, owner: null,
  });
}

async function board(runsDir: string): Promise<string> {
  const response = await createApp({
    adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir,
  }).request('/');
  expect(response.status).toBe(200);
  return response.text();
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('status board digest links', () => {
  it('links both checked-in nights without changing their fixtures', async () => {
    const html = await board('runs');
    for (const night of ['2026-10-28', '2026-10-27']) {
      expect(html).toContain(`<a href="/digest/${night}">${night}</a>`);
    }
    expect(html).toContain('ok: 10 / retry: 4 / fail: 1');
  });

  it('links every night newest first with valid-event counts, not final job statuses', async () => {
    const directory = tempRuns();
    writeFileSync(join(directory, '2026-10-28.jsonl'), [
      event('retry'), event('retry'), event('fail'), event('ok'), event('ok'),
      '{broken', event('unknown'), '',
    ].join('\n'));
    writeFileSync(join(directory, '2026-10-27.jsonl'), event('ok'));
    writeFileSync(join(directory, 'notes.jsonl'), event('fail'));

    const html = await board(directory);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok: 2 / retry: 2 / fail: 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok: 1 / retry: 0 / fail: 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('/digest/notes');
  });

  it('keeps empty and entirely malformed nights linked with zero valid events', async () => {
    const directory = tempRuns();
    writeFileSync(join(directory, '2026-10-28.jsonl'), '');
    writeFileSync(join(directory, '2026-10-27.jsonl'), '{broken\nnull\n');

    const html = await board(directory);
    for (const night of ['2026-10-28', '2026-10-27']) {
      expect(html).toContain(`<a href="/digest/${night}">${night}</a> · ok: 0 / retry: 0 / fail: 0`);
    }
  });

  it('keeps unavailable counts visible without breaking other nights', async () => {
    const directory = tempRuns();
    // A directory in place of a file reliably exercises a read error, even as root.
    mkdirSync(join(directory, '2026-10-28.jsonl'));
    writeFileSync(join(directory, '2026-10-27.jsonl'), event('ok'));
    // The shared reader returns null for invalid calendar dates.
    writeFileSync(join(directory, '2026-02-30.jsonl'), event('ok'));

    const html = await board(directory);
    for (const night of ['2026-10-28', '2026-02-30']) {
      expect(html).toContain(`<a href="/digest/${night}">${night}</a> · ok: — / retry: — / fail: —`);
    }
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok: 1 / retry: 0 / fail: 0');
  });

  it('preserves the empty-board message when the runs directory is empty or missing', async () => {
    const directory = tempRuns();
    for (const runsDir of [directory, join(directory, 'missing')]) {
      const html = await board(runsDir);
      expect(html).toContain('nothing in runs/');
      expect(html).not.toContain('href="/digest/');
    }
  });
});
