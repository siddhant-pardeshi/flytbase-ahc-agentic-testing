import { createServer } from 'node:http';

/**
 * A minimal local "probe console" page: the security checks run as real
 * in-browser fetches and each result appears on screen, so the recorded video
 * shows the API surface being probed live.
 */
const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Security probe console</title>
<style>
  body { background: #111113; color: #fff; font: 14px/1.5 Inter, system-ui, sans-serif; margin: 0; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p.sub { color: #ffffff8a; margin: 0 0 18px; }
  button { background: #496dc8; color: #fff; border: 0; border-radius: 6px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
  table { border-collapse: collapse; margin-top: 18px; min-width: 720px; }
  td, th { border: 1px solid #ffffff1f; padding: 8px 12px; text-align: left; font-size: 13px; }
  th { color: #ffffff8a; font-weight: 500; }
  .pass { color: #78cea7; font-weight: 600; }
  .fail { color: #fb9189; font-weight: 600; }
  .pending { color: #ffffff3d; }
  code { background: #262627; padding: 1px 6px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>API security probe console</h1>
  <p class="sub">Each check below is a live HTTP request against the running product. Expected: every probe is refused exactly as designed.</p>
  <button id="run">Run probes</button>
  <table>
    <thead><tr><th>#</th><th>Probe</th><th>Expected</th><th>Actual</th><th>Verdict</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
<script>
  const api = 'http://localhost:4000/api';
  const q = new URLSearchParams(location.search);
  const commanderToken = q.get('commander') ?? '';
  const responderToken = q.get('responder') ?? '';
  const incidentId = q.get('incident') ?? '';
  const endedIncident = q.get('ended') ?? '';

  const PROBES = [
    { name: 'GET /incidents without a session', expect: 401, run: () => fetch(api + '/incidents') },
    { name: 'GET /incidents/:id/history without a session', expect: 401, run: () => fetch(api + '/incidents/x/history') },
    { name: 'GET /incidents with a forged token', expect: 401, run: () => fetch(api + '/incidents', { headers: { authorization: 'Bearer not-a-real-token' } }) },
    { name: 'Resolve a fabricated joining link', expect: 404, run: () => fetch(api + '/join/0000000000000000ffffffff', { headers: { authorization: 'Bearer ' + responderToken } }) },
    { name: 'Responder ends someone else\\u2019s incident', expect: 403, run: () => fetch(api + '/incidents/' + incidentId + '/end', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + responderToken }, body: '{}' }) },
    { name: 'Chat into an ended incident', expect: 409, run: () => fetch(api + '/incidents/' + endedIncident + '/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + commanderToken }, body: JSON.stringify({ text: 'write after end' }) }) },
    { name: 'Use a revoked session', expect: 401, run: async () => {
        await fetch(api + '/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + responderToken } });
        return fetch(api + '/incidents', { headers: { authorization: 'Bearer ' + responderToken } });
      } },
  ];

  const rows = document.getElementById('rows');
  for (let i = 0; i < PROBES.length; i++) {
    rows.insertAdjacentHTML('beforeend',
      '<tr id="row' + i + '"><td>' + (i + 1) + '</td><td>' + PROBES[i].name + '</td><td>' + PROBES[i].expect + '</td><td class="pending">–</td><td class="pending">pending</td></tr>');
  }

  document.getElementById('run').addEventListener('click', async () => {
    window.__probesDone = false;
    window.__probeResults = [];
    for (let i = 0; i < PROBES.length; i++) {
      const row = document.getElementById('row' + i);
      const actual = row.children[3];
      const verdict = row.children[4];
      try {
        const res = await PROBES[i].run();
        actual.textContent = res.status;
        const ok = res.status === PROBES[i].expect;
        verdict.textContent = ok ? 'REFUSED CORRECTLY' : 'NOT REFUSED';
        verdict.className = ok ? 'pass' : 'fail';
        window.__probeResults.push({ name: PROBES[i].name, expect: PROBES[i].expect, actual: res.status, ok });
      } catch (e) {
        actual.textContent = 'network error';
        verdict.textContent = 'ERROR';
        verdict.className = 'fail';
        window.__probeResults.push({ name: PROBES[i].name, error: String(e), ok: false });
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    window.__probesDone = true;
  });
</script>
</body>
</html>`;

export function startProbeServer(port = 4173): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ url: `http://localhost:${port}/`, stop: () => new Promise((r) => server.close(() => r())) }));
  });
}
