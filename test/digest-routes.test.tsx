import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T23:00:00-06:00';
const lastAt = '2026-10-29T05:05:00Z';
const job = '<script>alert("job")</script>';
const owner = 'ops <team> & "oncall"';
const error = '<img src=x onerror="alert(1)"> & unavailable';
const event = { at: firstAt, job: 'zeta', owner: null, status: 'ok' };
const singleRow = {
  job: 'zeta', owner: null, runs: 1, retries: 0, lastStatus: 'ok' as const,
  lastError: null, firstAt, lastAt: firstAt, hasFailure: false,
};
const emptyDigest: NightDigest = {
  night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
};

// Decode text cells from the actual response, without involving the view or reader.
function htmlRows(html: string): string[][] {
  const entities: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  };
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) =>
      cell[1].replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => entities[entity]),
    ),
  );
}

describe('digest route regression coverage', () => {
  let directory: string;
  let runsDir: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    runsDir = join(directory, 'runs');
    mkdirSync(runsDir);
    vi.stubEnv('LANE_ID', 'route-test');
    vi.stubEnv('LANE_MARKER', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  function app() {
    return createApp({ adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir });
  }

  const scenarios: { name: string; contents: string; expected: NightDigest }[] = [
    {
      name: 'normal night with recovered failure, null owner and HTML metacharacters',
      contents: [
        event,
        { at: lastAt, job, owner, status: 'ok' },
        { at: firstAt, job, owner, status: 'fail', error },
        { at: '2026-10-29T05:01:00Z', job, owner, status: 'retry' },
      ].map((value) => JSON.stringify(value)).join('\n'),
      expected: {
        night, badLines: 0, counts: { ok: 2, retry: 1, fail: 1 },
        rows: [
          { job, owner, runs: 3, retries: 1, lastStatus: 'ok', lastError: error, firstAt, lastAt, hasFailure: true },
          singleRow,
        ],
      },
    },
    { name: 'empty night', contents: '', expected: emptyDigest },
    { name: 'blank night', contents: ' \t\n\n ', expected: emptyDigest },
    {
      name: 'malformed and structurally invalid lines alongside a valid job',
      contents: `${JSON.stringify(event)}\nnot json\n${JSON.stringify({ ...event, status: 'unknown' })}\n\n`,
      expected: { night, rows: [singleRow], badLines: 2, counts: { ok: 1, retry: 0, fail: 0 } },
    },
    {
      name: 'all-invalid night', contents: 'not json\n{}\n\n',
      expected: { ...emptyDigest, badLines: 2 },
    },
  ];

  it.each(scenarios)('keeps HTML and JSON consistent for $name', async ({ contents, expected }) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    const server = app();
    const [page, api] = await Promise.all([
      server.request(`/digest/${night}`),
      server.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(api.headers.get('content-type')).toContain('application/json');
    const html = await page.text();
    const digest = await api.json() as NightDigest;
    expect(digest).toEqual(expected);
    expect(html).toContain(`digest · ${digest.night}`);
    expect(html).toContain(`${digest.badLines} bad line`);
    expect(htmlRows(html)).toEqual(digest.rows.map((row) => [
      row.job, row.owner ?? '—', String(row.runs), String(row.retries),
      row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
    ]));
    if (digest.rows.length === 0) {
      const message = expected.badLines > 0 ? 'no valid runs' : 'nothing ran';
      const otherMessage = expected.badLines > 0 ? 'nothing ran' : 'no valid runs';
      expect(html).toContain(`>${message}</p>`);
      expect(html).not.toContain(`>${otherMessage}</p>`);
      expect(html).not.toContain('<table');
    }
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<team>');
  });

  it('returns 404 in both representations for a missing night', async () => {
    const server = app();
    for (const prefix of ['/digest', '/api/digest']) {
      const response = await server.request(`${prefix}/${night}`);
      expect(response.status).toBe(404);
    }
  });

  it.each(['', ' \t\n '])('displays blank owner and error as dashes while preserving source value %j', async (blank) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), JSON.stringify({ ...event, owner: blank, error: blank }));
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const api = await server.request(`/api/digest/${night}`);

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ ...singleRow, owner: blank, lastError: blank }],
    });
    expect(htmlRows(await page.text())).toEqual([
      ['zeta', '—', '1', '0', 'ok', '—', firstAt, firstAt],
    ]);
  });

  it('preserves surrounding whitespace in nonblank owner and error display', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), JSON.stringify({ ...event, owner: ' ops ', error: ' failure ' }));
    const response = await app().request(`/digest/${night}`);

    expect(htmlRows(await response.text())).toEqual([
      ['zeta', ' ops ', '1', '0', 'ok', ' failure ', firstAt, firstAt],
    ]);
  });

  it.each([
    'not-a-night', '2026-1-02', '2026-10-28.jsonl',
    '../2026-10-28', '..\\2026-10-28', '2026-10-28/../../2026-10-28',
  ])('rejects invalid or traversal night %s in both representations', async (invalidNight) => {
    // A real outside file makes traversal rejection meaningful even if lookup changes.
    writeFileSync(join(directory, `${night}.jsonl`), JSON.stringify(event));
    writeFileSync(join(runsDir, 'not-a-night.jsonl'), JSON.stringify(event));
    const server = app();
    for (const prefix of ['/digest', '/api/digest']) {
      const response = await server.request(`${prefix}/${encodeURIComponent(invalidNight)}`);
      expect(response.status).toBe(404);
    }
  });
});
