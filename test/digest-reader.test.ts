import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';
import type { ReadNight } from '../src/digest/types.js';

const night = '2026-10-28';
const directories: string[] = [];

function tempRuns(contents?: string): string {
  const directory = mkdtempSync(join(process.cwd(), '.digest-reader-test-'));
  directories.push(directory);
  if (contents !== undefined) writeFileSync(join(directory, `${night}.jsonl`), contents);
  return directory;
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    at: '2026-10-29T01:00:00+01:00',
    job: 'lane/sync',
    status: 'ok',
    owner: 'rook',
    ...overrides,
  };
}

function jsonLines(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n');
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('readNight', () => {
  it('implements the shared synchronous contract and reads the real fixture without changing it', () => {
    const reader: ReadNight = readNight;
    const digest = reader('runs', night);
    expect(digest?.night).toBe(night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.statusCounts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(digest?.rows[1]).toMatchObject({
      runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes missing nights from empty or blank files', () => {
    expect(readNight(tempRuns(), night)).toBeNull();
    expect(readNight(join(tempRuns(), 'missing-directory'), night)).toBeNull();
    for (const contents of ['', '\n  \r\n\t\n']) {
      expect(readNight(tempRuns(contents), night)).toEqual({
        night, rows: [], badLines: 0, statusCounts: { ok: 0, retry: 0, fail: 0 },
      });
    }
  });

  it.each([
    '../2026-10-28', '2026-10-28/../2026-10-28', '/2026-10-28',
    '2026-10-28.jsonl', '2026-1-28', '2026-10-28\n', '2026-10-28\0',
    '', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01',
  ])('rejects invalid night %j before filesystem access', (invalidNight) => {
    expect(readNight(tempRuns(''), invalidNight)).toBeNull();
  });

  it('accepts leap days and rejects normalized invalid dates', () => {
    const directory = tempRuns();
    writeFileSync(join(directory, '2024-02-29.jsonl'), '');
    expect(readNight(directory, '2024-02-29')?.rows).toEqual([]);
    expect(readNight(directory, '2025-02-29')).toBeNull();
  });

  it('counts malformed and schema-invalid lines without losing valid null owners', () => {
    const invalid: unknown[] = [
      null, [], 42, 'text', {},
      event({ at: null }), event({ at: 'not a date' }),
      event({ at: '2026-02-30T01:00:00Z' }), event({ at: '2026-10-29T25:00:00Z' }),
      event({ at: '2026-10-29T01:00:00' }), event({ at: '2026-10-29' }),
      event({ at: '2026-10-29T01:00:00+24:00' }),
      event({ job: '' }), event({ job: '  ' }), event({ job: 7 }),
      event({ status: 'unknown' }), event({ status: null }), event({ status: ['ok'] }),
      event({ owner: 7 }), event({ error: null }), event({ error: 123 }),
      { at: '2026-10-29T01:00:00Z', job: 'missing-owner', status: 'ok' },
    ];
    const contents = `${jsonLines(invalid)}\n{broken\n\n${JSON.stringify(event({ owner: null }))}\n`;
    const digest = readNight(tempRuns(contents), night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.statusCounts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('orders by actual instants, preserves offsets, and retains the latest reported error', () => {
    const contents = jsonLines([
      event({ at: '2026-10-29T00:30:00-02:00', owner: null }),
      event({ at: '2026-10-29T02:00:00+01:00', status: 'fail', error: 'latest error' }),
      event({ at: '2026-10-29T03:00:00+03:00', status: 'retry', error: 'older error' }),
      event({ job: 'z', at: '2026-10-29T00:00:00.123Z' }),
      event({ job: '__proto__', at: '2026-10-29T00:00:00Z' }),
      event({ job: 'A', at: '2026-10-29T00:00:00Z' }),
    ]);
    const digest = readNight(tempRuns(contents), night);
    expect(digest?.rows.map((row) => row.job)).toEqual(['A', '__proto__', 'lane/sync', 'z']);
    expect(digest?.rows[2]).toEqual({
      job: 'lane/sync', owner: null, runs: 3, retries: 1,
      lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-29T03:00:00+03:00', lastAt: '2026-10-29T00:30:00-02:00',
    });
    expect(digest?.statusCounts).toEqual({ ok: 4, retry: 1, fail: 1 });
  });

  it('uses later lines to break equal-instant ties, including empty reported errors', () => {
    const digest = readNight(tempRuns(jsonLines([
      event({ at: '2026-10-29T01:00:00+01:00', status: 'retry', error: 'first error' }),
      event({ at: '2026-10-29T00:00:00Z', status: 'fail', owner: null, error: '' }),
      event({ at: '2026-10-29T02:00:00+02:00', owner: 'last owner' }),
    ])), night);
    expect(digest?.rows[0]).toMatchObject({
      firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T02:00:00+02:00',
      owner: 'last owner', lastStatus: 'ok', lastError: '', runs: 3, retries: 1,
    });
  });

  it('does not disguise filesystem errors other than missing paths as missing nights', () => {
    const directory = tempRuns();
    mkdirSync(join(directory, `${night}.jsonl`));
    expect(() => readNight(directory, night)).toThrow();
  });
});
