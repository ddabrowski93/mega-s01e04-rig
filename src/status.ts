import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { DigestNight } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

type NightStatus = {
  night: string;
  statusCounts: DigestNight['statusCounts'] | null;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightStatus[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => {
      try {
        return { night, statusCounts: readNight(config.runsDir, night)?.statusCounts ?? null };
      } catch {
        // Keep the night visible if its file cannot be read; unknown counts aren't zero.
        return { night, statusCounts: null };
      }
    }),
  };
}
