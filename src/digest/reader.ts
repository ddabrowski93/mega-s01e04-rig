import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

type JobState = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  errorTime: number;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isNight(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string' || !isTimestamp(value.at)) return null;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return null;
  if (!('status' in value)
    || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (typeof value.owner !== 'string' && value.owner !== null)) return null;
  if ('error' in value && typeof value.error !== 'string') return null;
  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...('error' in value && typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }

  const digest: DigestNight = {
    night,
    rows: [],
    badLines: 0,
    statusCounts: { ok: 0, retry: 0, fail: 0 },
  };
  const jobs = new Map<string, JobState>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (event === null) {
      digest.badLines++;
      continue;
    }
    digest.statusCounts[event.status]++;
    const time = Date.parse(event.at);
    let state = jobs.get(event.job);
    if (!state) {
      state = {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 0,
          retries: 0,
          lastStatus: event.status,
          lastError: null,
          firstAt: event.at,
          lastAt: event.at,
        },
        firstTime: time,
        lastTime: time,
        errorTime: -Infinity,
      };
      jobs.set(event.job, state);
    }
    const { row } = state;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (time < state.firstTime) {
      row.firstAt = event.at;
      state.firstTime = time;
    }
    if (time >= state.lastTime) {
      row.lastAt = event.at;
      row.owner = event.owner;
      row.lastStatus = event.status;
      state.lastTime = time;
    }
    if (event.error !== undefined && time >= state.errorTime) {
      row.lastError = event.error;
      state.errorTime = time;
    }
  }
  digest.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
