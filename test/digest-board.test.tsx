import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};

describe('digest links on the status board', () => {
  it('links both fixture nights newest first with their valid event counts', async () => {
    const response = await createApp(config).request('/');
    const html = await response.text();
    const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1]);

    expect(response.status).toBe(200);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(items[0]).toContain('ok 10 · retry 4 · fail 1');
    expect(items[1]).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(items[1]).toContain('ok 7 · retry 0 · fail 0');
    expect(html).toContain('<th>adapter</th><td>shim</td>');
    expect(html).toContain('<th>installed</th><td>2026-10-29T14:06:00+01:00</td>');
    expect(html).toContain('<th>last beat</th>');
  });

  it('keeps the empty runs message without digest links', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    try {
      const response = await createApp({ ...config, runsDir }).request('/');
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('nothing in runs/');
      expect(html).not.toContain('href="/digest/');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});
