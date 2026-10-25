// Encadena la siguiente pasada: espera hasta completar 5 minutos desde el inicio y lanza el workflow otra vez.
// La programación de GitHub (cron) es poco fiable en repositorios nuevos; queda solo como respaldo.
// No lanza nada si ya hay otra pasada en cola o en marcha, para no duplicar cadenas.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, STARTED_AT } = process.env;
const api = (path, opts = {}) => fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
  ...opts,
  headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
});

(async () => {
  const wait = 300000 - (Date.now() - Number(STARTED_AT) * 1000);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  for (const status of ['queued', 'in_progress', 'waiting', 'pending']) {
    const res = await api(`/actions/workflows/vigilante.yml/runs?status=${status}&per_page=20`);
    const { workflow_runs: runs = [] } = await res.json();
    if (runs.some((r) => String(r.id) !== GITHUB_RUN_ID)) {
      console.log(`Ya hay otra pasada (${status}); no encadeno.`);
      return;
    }
  }
  const res = await api('/actions/workflows/vigilante.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  console.log(res.ok ? 'Siguiente pasada lanzada.' : `No se pudo lanzar la siguiente pasada: HTTP ${res.status} ${await res.text()}`);
})();
