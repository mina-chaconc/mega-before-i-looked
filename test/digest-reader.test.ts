import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
let directory: string;

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function writeEvents(events: unknown[]) {
  writeFileSync(join(directory, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
}

describe('readNight', () => {
  it('aggregates valid fixture events and retains errors after recovery', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows.find((row) => row.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503', hasFailure: false,
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows.find((row) => row.job === 'notes/backup')?.hasFailure).toBe(true);
    expect(digest?.rows.find((row) => row.job === 'digest/render')?.owner).toBeNull();
  });

  it('distinguishes missing files from empty nights and ignores blank lines', () => {
    expect(readNight(directory, night)).toBeNull();
    writeFileSync(join(directory, `${night}.jsonl`), '\n  \r\n\t');
    expect(readNight(directory, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and invalid event fields without losing valid events', () => {
    const file = join(directory, `${night}.jsonl`);
    writeFileSync(file, '\n{bad json\n' + [
      null, [], 7, 'event', {}, { ...event, at: 5 }, { ...event, at: 'not a date' },
      { ...event, job: null }, { ...event, job: '' }, { ...event, status: 'pending' },
      { ...event, owner: 5 }, { at: event.at, job: 'job', status: 'ok' },
      { ...event, error: false }, { ...event, error: null }, event,
    ].map((value) => JSON.stringify(value)).join('\n') + '\n  \n');
    const digest = readNight(directory, night);
    expect(digest?.badLines).toBe(15);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0]?.runs).toBe(1);
  });

  it('rejects coercible statuses and ambiguous or impossible timestamps', () => {
    writeEvents([
      { ...event, status: ['ok'] }, { ...event, status: { toString: 'ok' } },
      { ...event, at: '5' }, { ...event, at: '2026-10-28' },
      { ...event, at: '2026-10-28T23:00:00' }, { ...event, at: '2026-02-30T23:00:00Z' },
    ]);
    expect(readNight(directory, night)).toEqual({
      night, rows: [], badLines: 6, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns an empty digest for an all-invalid file', () => {
    writeEvents([null, {}]);
    expect(readNight(directory, night)).toEqual({
      night, rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('orders by instants, preserves offsets, and keeps historical failure and latest error', () => {
    writeEvents([
      { ...event, at: '2026-10-29T02:00:00+01:00', owner: null },
      { ...event, at: '2026-10-29T03:00:00+03:00', status: 'retry', error: 'latest error' },
      { ...event, at: '2026-10-28T22:30:00Z', status: 'fail', error: 'older error' },
    ]);
    expect(readNight(directory, night)?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-28T22:30:00Z', lastAt: '2026-10-29T02:00:00+01:00', hasFailure: true,
    }]);
  });

  it('breaks equal-instant ties by source order and preserves an empty error string', () => {
    writeEvents([
      { ...event, at: '2026-10-28T23:00:00+01:00', status: 'fail', error: 'first' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'retry', owner: 'next', error: '' },
      { ...event, at: '2026-10-28T17:00:00-05:00', owner: null },
    ]);
    expect(readNight(directory, night)?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: '',
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T17:00:00-05:00', hasFailure: true,
    });
  });

  it('sorts jobs lexically and handles object-property names as jobs', () => {
    writeEvents(['z', 'a', '__proto__', 'A', 'constructor'].map((job) => ({ ...event, job })));
    expect(readNight(directory, night)?.rows.map((row) => row.job)).toEqual([
      'A', '__proto__', 'a', 'constructor', 'z',
    ]);
  });

  it.each(['../2026-10-28', '2026-10-28/../../escape', '/2026-10-28', '..\\2026-10-28',
    '2026-1-28', '2026-10-28.jsonl', '2026-10-28\n', '2026-10-28\0', ''])('rejects invalid night %j', (invalidNight) => {
    const runs = join(directory, 'runs');
    mkdirSync(runs);
    writeEvents([event]);
    expect(readNight(runs, invalidNight)).toBeNull();
  });

  it('propagates filesystem errors other than missing files', () => {
    mkdirSync(join(directory, `${night}.jsonl`));
    expect(() => readNight(directory, night)).toThrow();
  });
});
