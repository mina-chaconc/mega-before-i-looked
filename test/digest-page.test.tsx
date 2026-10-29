import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';

const digest: NightDigest = {
  night: '2026-10-28',
  badLines: 2,
  counts: { ok: 4, retry: 5, fail: 1 },
  rows: [
    {
      job: '<script>alert("job")</script>', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: '<img src=x onerror="alert(1)"> & failed',
      firstAt: '2026-10-28T23:01:02.123-06:00', lastAt: '2026-10-29T01:02:03.456+01:00',
      hasFailure: false,
    },
    {
      job: 'fixtures/refresh', owner: 'carlos', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-28T01:00:00-06:00', lastAt: '2026-10-28T01:03:00-06:00',
      hasFailure: false,
    },
    {
      job: 'notes/backup', owner: 'lee', runs: 2, retries: 0,
      lastStatus: 'ok', lastError: 'disk full',
      firstAt: '2026-10-28T02:00:00-06:00', lastAt: '2026-10-28T02:01:00-06:00',
      hasFailure: true,
    },
    {
      job: 'status/check', owner: 'sam', runs: 3, retries: 2,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-28T03:00:00-06:00', lastAt: '2026-10-28T03:02:00-06:00',
      hasFailure: false,
    },
  ],
};

function render(value = digest) {
  return (<DigestPage digest={value} />).toString();
}

describe('digest page view', () => {
  it('shows every job in reader order in one table, with counts and last state', () => {
    const html = render();
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.indexOf('&lt;script&gt;')).toBeLessThan(html.indexOf('fixtures/refresh'));
    expect(html.indexOf('fixtures/refresh')).toBeLessThan(html.indexOf('notes/backup'));
    expect(html.indexOf('notes/backup')).toBeLessThan(html.indexOf('status/check'));
    expect(html).toContain('<td>carlos</td><td>4</td><td>3</td><td>ok</td><td>upstream 503</td>');
    expect(html).toContain('2 bad lines');
  });

  it('renders missing owner and error as visible dashes', () => {
    const html = render();
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>ok</td><td>—</td>');
  });

  it('escapes job and error text without creating executable markup', () => {
    const html = render();
    expect(html).toContain('&lt;script&gt;alert(&quot;job&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; failed');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
  });

  it('preserves complete first and last timestamps including offsets and fractions', () => {
    const html = render();
    expect(html).toContain('2026-10-28T23:01:02.123-06:00');
    expect(html).toContain('2026-10-29T01:02:03.456+01:00');
  });

  it('warns at three retries and for a historical failure after recovery', () => {
    const rows = render().match(/<tr\b[^>]*>.*?<\/tr>/g) ?? [];
    expect(rows.find((row) => row.includes('fixtures/refresh'))).toContain('class="warn"');
    expect(rows.find((row) => row.includes('notes/backup'))).toContain('class="warn"');
    expect(rows.find((row) => row.includes('status/check'))).not.toContain('class="warn"');
  });

  it('renders the exact empty state and readable bad-line count', () => {
    const html = render({ night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(html).toContain('>nothing ran</p>');
    expect(html).toContain('0 bad lines');
    expect(html).not.toContain('<table>');
  });
});

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('digest HTML route', () => {
  it('serves the sample digest inside the shared layout', async () => {
    const response = await createApp(config).request('/digest/2026-10-28');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    expect(html).toContain('lane-07');
    expect(html).toContain('2026-10-28');
    expect(html).toContain('fixtures/refresh');
    expect(html).toContain('upstream 503');
    expect(html).toContain('1 bad line');
    expect(html).toContain('<td>digest/render</td><td>—</td>');
    expect(html).toContain('<td>fixtures/refresh</td><td>rook</td><td>4</td><td>3</td><td>ok</td><td>upstream 503</td>');
    expect(html).toContain('2026-10-29T01:30:00+01:00');
    expect(html).toContain('2026-10-29T01:37:00+01:00');
    expect(html.indexOf('digest/render')).toBeLessThan(html.indexOf('fixtures/refresh'));
    expect(html.indexOf('fixtures/refresh')).toBeLessThan(html.indexOf('lane/sync'));
    expect(html.indexOf('lane/sync')).toBeLessThan(html.indexOf('notes/backup'));
    expect(html.indexOf('notes/backup')).toBeLessThan(html.indexOf('rig/rotate-logs'));
    expect(html).not.toContain('<script');
  });

  it('returns 404 for missing and invalid nights', async () => {
    const app = createApp(config);
    for (const night of ['1900-01-01', 'invalid', '2026-10-28%2F..%2Fprivate']) {
      expect((await app.request(`/digest/${night}`)).status).toBe(404);
    }
  });

  it('renders empty and all-invalid files as successful empty digests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rig-digest-page-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, '2026-10-28.jsonl'), '');
    writeFileSync(join(directory, '2026-10-27.jsonl'), 'not json\n');
    const app = createApp({ ...config, runsDir: directory });
    for (const [night, count] of [['2026-10-28', 0], ['2026-10-27', 1]] as const) {
      const response = await app.request(`/digest/${night}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('>nothing ran</p>');
      expect(html).toContain(`${count} bad line`);
    }
  });
});
