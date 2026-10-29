import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  instant: number;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string') return null;
  if (!('job' in value) || typeof value.job !== 'string' || !value.job.trim()) return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  if ('error' in value && typeof value.error !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)) return null;
  const instant = Date.parse(value.at);
  if (!Number.isFinite(instant)) return null;
  // Date.parse normalizes impossible days such as February 30; reject those at the boundary.
  const day = value.at.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return {
    at: value.at,
    instant,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...('error' in value ? { error: value.error as string } : {}),
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const events: RunEvent[] = [];
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (event) events.push(event);
    else digest.badLines++;
  }

  // Stable sorting keeps source order for equal instants and preserves original timestamp strings.
  events.sort((a, b) => a.instant - b.instant);
  const rows = new Map<string, DigestRow>();
  for (const event of events) {
    digest.counts[event.status]++;
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null,
        firstAt: event.at, lastAt: event.at, hasFailure: false,
      };
      rows.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    if (event.error !== undefined) row.lastError = event.error;
  }
  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
