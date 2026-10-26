// Respaldo en GitHub: comprueba si el vigilante de Nexus sigue publicando.
// Escribe fresh=true|false en GITHUB_OUTPUT y avisa a Slack cuando Nexus deja de publicar o vuelve.
const fs = require('fs');
const STALE_MIN = 15;

const read = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const status = read('site/status.json', null);
const WD = 'watch/watchdog.json'; // propio del respaldo, en la caché de GitHub
const wd = read(WD, { nexusDown: false });
const ageMin = status ? (Date.now() - Date.parse(status.checkedAt)) / 60000 : Infinity;
const fresh = !!status && status.source === 'nexus' && ageMin < STALE_MIN;

async function notify(text) {
  console.log(`AVISO: ${text}`);
  if (!process.env.SLACK_WEBHOOK_URL) return;
  await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
}

(async () => {
  console.log(status ? `Última pasada: ${status.checkedAt} desde ${status.source} (hace ${Math.round(ageMin)} min)` : 'Sin datos de Nexus todavía');
  // Solo se avisa si Nexus llegó a publicar alguna vez y luego se paró.
  const nexusEverRan = !!status && (status.source === 'nexus' || wd.nexusSeen);
  if (fresh) wd.nexusSeen = true;
  if (!fresh && nexusEverRan && !wd.nexusDown) {
    wd.nexusDown = true;
    await notify(`:warning: El vigilante de Nexus no publica desde hace ${Math.round(ageMin)} min. GitHub hace las pasadas mientras tanto (las landings italianas pueden salir como bloqueadas).`);
  } else if (fresh && wd.nexusDown) {
    wd.nexusDown = false;
    await notify(':white_check_mark: El vigilante de Nexus vuelve a publicar.');
  }
  fs.mkdirSync('watch', { recursive: true });
  fs.writeFileSync(WD, JSON.stringify(wd, null, 2));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `fresh=${fresh}\n`);
})();
