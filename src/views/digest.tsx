import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p class="mute">{digest.badLines} {digest.badLines === 1 ? 'bad line' : 'bad lines'}</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th>
              <th>last status</th><th>last error</th><th>first time</th><th>last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={row.retries >= 3 || row.hasFailure ? 'warn' : undefined}>
                <td>{row.job}</td><td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td><td>{row.retries}</td>
                <td>{row.lastStatus}</td><td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt}</td><td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
