import { serve } from '@hono/node-server';
import { afterEach, expect, it, vi } from 'vitest';

// Keep bootstrap real while preventing network listeners and heartbeat writes/timers.
vi.mock('@hono/node-server', () => ({ serve: vi.fn() }));
vi.mock('../src/heartbeat.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/heartbeat.js')>(),
  startBeating: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

it('starts the unauthenticated server on an explicit loopback host', async () => {
  vi.stubEnv('PORT', '9876');
  await import('../src/server.js');

  expect(serve).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ hostname: '127.0.0.1', port: 9876, fetch: expect.any(Function) }),
    expect.any(Function),
  );
});
