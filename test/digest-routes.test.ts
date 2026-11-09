import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';
import type { DigestNight } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(process.cwd(), '.digest-routes-test-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runsDir, { recursive: true });
});

function app() {
  return createApp({
    adapter: 'shim', installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60, runsDir,
  });
}

function writeNight(contents: string, filename = night) {
  writeFileSync(join(runsDir, `${filename}.jsonl`), contents);
}

function event(job: string, status: 'ok' | 'retry' | 'fail', minute: number,
  owner: string | null = 'rook', error?: string) {
  return JSON.stringify({
    at: `2026-10-29T01:${String(minute).padStart(2, '0')}:00+01:00`,
    job, status, owner, ...(error === undefined ? {} : { error }),
  });
}

function populatedNight() {
  // Deliberately not job-sorted; the last successful attempt retains the retry error.
  writeNight([
    event('z/fail', 'fail', 9, 'night crew', 'quota exceeded'),
    event('b/three-retries', 'retry', 1, 'rook', 'upstream 503'),
    event('a/no-owner', 'ok', 0, null),
    event('c/two-retries', 'retry', 2),
    event('b/three-retries', 'retry', 3),
    event('c/two-retries', 'retry', 4),
    event('b/three-retries', 'retry', 5),
    event('b/three-retries', 'ok', 6),
    '{broken json',
    '',
  ].join('\n'));
}

function text(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((row) => ({
      html: row[1],
      cells: [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)]
        .map((cell) => cell[1]),
    }))
    .filter((row) => row.cells.length > 0);
}

describe('digest routes', () => {
  it('serves the complete shared DigestNight shape as JSON, sorted by job', async () => {
    populatedNight();
    const response = await app().request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const digest = await response.json();
    expect(digest).toEqual(readNight(runsDir, night));
    expect(digest).toEqual({
      night, badLines: 1, statusCounts: { ok: 2, retry: 5, fail: 1 },
      rows: [
        {
          job: 'a/no-owner', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T01:00:00+01:00',
        },
        {
          job: 'b/three-retries', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:01:00+01:00', lastAt: '2026-10-29T01:06:00+01:00',
        },
        {
          job: 'c/two-retries', owner: 'rook', runs: 2, retries: 2,
          lastStatus: 'retry', lastError: null,
          firstAt: '2026-10-29T01:02:00+01:00', lastAt: '2026-10-29T01:04:00+01:00',
        },
        {
          job: 'z/fail', owner: 'night crew', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T01:09:00+01:00', lastAt: '2026-10-29T01:09:00+01:00',
        },
      ],
    } satisfies DigestNight);
  });

  it('renders one table with every row field, missing values, and the same job order as JSON', async () => {
    populatedNight();
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    const digest: DigestNight = await json.json();
    expect(html.match(/<table\b/g)).toHaveLength(1);
    const rows = tableRows(html);
    expect(rows.map((row) => text(row.cells[0]))).toEqual(digest.rows.map((row) => row.job));
    expect(rows).toHaveLength(4);
    for (const [index, row] of digest.rows.entries()) {
      const cells = rows[index].cells.map(text);
      expect(cells).toHaveLength(8);
      for (const value of [row.job, row.owner ?? '—', String(row.runs), String(row.retries),
        row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt]) {
        expect(cells.some((cell) => cell === value || cell.startsWith(`${value} `))).toBe(true);
      }
      expect(cells.every((cell) => cell.length > 0)).toBe(true);
    }
    // A null owner and a missing error are two separate, visible missing values.
    expect(rows[0].cells.map(text).filter((cell) => cell === '—')).toHaveLength(2);
  });

  it('marks three retries and failures, without marking a retry count of two', async () => {
    populatedNight();
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = tableRows(await response.text());
    const three = rows.find((row) => text(row.cells[0]) === 'b/three-retries')!;
    const two = rows.find((row) => text(row.cells[0]) === 'c/two-retries')!;
    const failed = rows.find((row) => text(row.cells[0]) === 'z/fail')!;
    const warning = /class="[^"]*\bwarn\b[^"]*"/;
    expect(three.cells.find((cell) => /^3(?:\s|$)/.test(text(cell)))).toMatch(warning);
    const twoCounts = two.cells.filter((cell) => /^2(?:\s|$)/.test(text(cell)));
    expect(twoCounts.length).toBeGreaterThan(0);
    for (const cell of twoCounts) expect(cell).not.toMatch(warning);
    expect(failed.cells.find((cell) => text(cell).includes('fail'))).toMatch(warning);
  });

  it('keeps original timestamp offsets in both representations', async () => {
    const firstAt = '2026-10-29T03:00:00+03:00';
    const lastAt = '2026-10-29T00:30:00-02:00';
    writeNight([
      JSON.stringify({ at: lastAt, job: 'offsets', status: 'ok', owner: null }),
      JSON.stringify({ at: firstAt, job: 'offsets', status: 'retry', owner: 'rook' }),
    ].join('\n'));
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(firstAt);
    expect(html).toContain(lastAt);
    expect(await json.json()).toMatchObject({ rows: [{ firstAt, lastAt }] });
  });

  for (const route of ['/digest', '/api/digest']) {
    describe(route, () => {
      it('returns 404 for a missing night', async () => {
        expect((await app().request(`${route}/${night}`)).status).toBe(404);
      });

      it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-28', 'not-a-night', '2026-10-28.jsonl'])
      ('returns 404 for invalid night %s even if a matching file exists', async (invalid) => {
        writeNight(event('must-not-render', 'ok', 0), invalid);
        expect((await app().request(`${route}/${invalid}`)).status).toBe(404);
      });

      it('returns 200 for an empty night', async () => {
        writeNight('');
        const response = await app().request(`${route}/${night}`);
        expect(response.status).toBe(200);
        if (route === '/api/digest') {
          expect(await response.json()).toEqual({
            night, rows: [], badLines: 0, statusCounts: { ok: 0, retry: 0, fail: 0 },
          });
        } else {
          expect(await response.text()).toContain('nothing ran');
        }
      });

      it('still succeeds when every nonblank line is bad', async () => {
        writeNight('{broken\nnull\n  \n');
        const response = await app().request(`${route}/${night}`);
        expect(response.status).toBe(200);
        if (route === '/api/digest') {
          expect(await response.json()).toEqual({
            night, rows: [], badLines: 2, statusCounts: { ok: 0, retry: 0, fail: 0 },
          });
        } else {
          const html = await response.text();
          expect(html).toContain('nothing ran');
          expect(text(html)).toMatch(/(?:2\s+bad\s+lines|bad\s+lines\s*:?\s*2)/i);
        }
      });
    });
  }

  it('reports bad lines on the populated page without dropping good jobs', async () => {
    populatedNight();
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(tableRows(html)).toHaveLength(4);
    expect(text(html)).toMatch(/(?:1\s+bad\s+line|bad\s+lines?\s*:?\s*1)/i);
  });

  it('escapes log fields and the lane marker while preserving original JSON strings', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="alert(1)">';
    const error = '<svg onload="alert(2)">& failed';
    const marker = '<script>alert("marker")</script>';
    vi.stubEnv('LANE_MARKER', marker);
    writeNight(event(job, 'fail', 0, owner, error));
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    for (const raw of [job, owner, error, marker]) expect(html).not.toContain(raw);
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;svg');
    expect(html).toContain('&amp; failed');
    expect(html).toMatch(/<header>[\s\S]*class="marker"[\s\S]*marker[\s\S]*<\/header>/);
    expect(await json.json()).toMatchObject({ rows: [{ job, owner, lastError: error }] });
  });
});
