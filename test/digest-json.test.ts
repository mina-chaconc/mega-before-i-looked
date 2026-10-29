import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('digest JSON', () => {
  it('returns the complete sample digest including retained error history and counts', async () => {
    const response = await createApp(config).request('/api/digest/2026-10-28');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      night: '2026-10-28',
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00', hasFailure: false },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', hasFailure: false },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00', hasFailure: false },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00', hasFailure: true },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00', hasFailure: false },
      ],
    });
  });

  it('returns 404 for a missing night', async () => {
    const response = await createApp(config).request('/api/digest/1900-01-01');
    expect(response.status).toBe(404);
  });

  it('returns an empty digest with 200 for an existing empty night', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-json-'));
    temporaryDirectories.push(runsDir);
    writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');

    const response = await createApp({ ...config, runsDir }).request('/api/digest/2026-10-29');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ night: '2026-10-29', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('preserves the real reader row ordering', async () => {
    const response = await createApp(config).request('/api/digest/2026-10-28');
    expect(response.status).toBe(200);
    const digest = await response.json() as NightDigest;
    const { readNight } = await import('../src/digest/read-night.js');

    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest).toEqual(readNight(config.runsDir, '2026-10-28'));
  });

  it('returns 404 for traversal-like night identifiers', async () => {
    const response = await createApp(config).request('/api/digest/..%2F2026-10-28');
    expect(response.status).toBe(404);
  });
});
