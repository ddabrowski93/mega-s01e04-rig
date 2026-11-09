import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const directories: string[] = [];

function appWithRuns(contents?: string) {
  const runsDir = mkdtempSync(join(process.cwd(), '.digest-json-test-'));
  directories.push(runsDir);
  if (contents !== undefined) writeFileSync(join(runsDir, `${night}.jsonl`), contents);
  return createApp({
    adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir,
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('digest JSON', () => {
  it('returns the full digest with job-sorted rows and bad-line counts from the configured directory', async () => {
    const firstAt = '2026-10-28T01:00:00+01:00';
    const lastAt = '2026-10-28T02:00:00+01:00';
    const app = appWithRuns([
      JSON.stringify({ at: firstAt, job: 'z/job', owner: 'rook', status: 'retry', error: 'busy' }),
      'not JSON',
      JSON.stringify({ at: firstAt, job: 'a/job', owner: null, status: 'fail' }),
      JSON.stringify({ at: lastAt, job: 'z/job', owner: 'rook', status: 'ok' }),
    ].join('\n'));

    const res = await app.request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      night,
      rows: [
        {
          job: 'a/job', owner: null, runs: 1, retries: 0,
          lastStatus: 'fail', lastError: null, firstAt, lastAt: firstAt,
        },
        {
          job: 'z/job', owner: 'rook', runs: 2, retries: 1,
          lastStatus: 'ok', lastError: 'busy', firstAt, lastAt,
        },
      ],
      badLines: 1,
      statusCounts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('returns a normal empty digest for an empty file', async () => {
    const res = await appWithRuns('').request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night, rows: [], badLines: 0, statusCounts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each([night, 'not-a-night', '2026-02-30'])('returns JSON 404 for missing or invalid night %s', async (requestedNight) => {
    const res = await appWithRuns().request(`/api/digest/${requestedNight}`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Night not found' });
  });
});
