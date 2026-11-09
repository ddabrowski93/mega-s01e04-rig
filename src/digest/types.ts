export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  statusCounts: Record<DigestStatus, number>;
};

/**
 * Synchronously read runsDir/<night>.jsonl without modifying files.
 * Implemented and exported as readNight in ./reader.js.
 *
 * Return null for a missing file or an invalid night (a real YYYY-MM-DD date).
 * Other filesystem errors propagate. Empty files return a digest with no rows.
 * Count malformed JSON and schema-invalid nonblank lines in badLines; ignore
 * blank lines. Count every valid event in statusCounts and its job's runs;
 * retries counts only retry events. Rows sort ascending by job (code units).
 *
 * firstAt/lastAt compare actual instants but retain the original offset strings.
 * owner/lastStatus come from the latest event; lastError retains the latest
 * reported error even if a later event has none. Equal timestamps use the later
 * line for last-event/error selection. Missing errors are represented as null.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
