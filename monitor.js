// Vigilante de landings de Feel The City.
// Todas las landings comparten motor: calendario jQuery UI (#datepicker), disponibilidad por POST /check
// y formulario #form_reserva que envía a /pagar. Esta comprobación no pulsa «Reservar»: no crea prerreservas.
// Avisa a Slack solo cuando una landing cae o se recupera.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const LANDINGS = JSON.parse(fs.readFileSync(path.join(__dirname, 'landings.json'), 'utf8'));
// Estado entre pasadas (se conserva con la caché de Actions) y web pública con el dashboard.
const DATA = path.join(__dirname, 'data');
const SITE = path.join(__dirname, 'site');
const STATE = path.join(DATA, 'state.json');
const HISTORY = path.join(DATA, 'history.json');
const INCIDENTS = path.join(DATA, 'incidents.json');
const HISTORY_DAYS = 7;
const TIMEOUT = 25000;
const SLOW_MS = 10000;
// Pocas a la vez: varias landings comparten servidor y muchas peticiones seguidas disparan su bloqueo anti-bots.
const PARALLEL = Number(process.env.PARALLEL) || 3;
// Palabras de webs de apuestas o spam: una landing suplantada (como pasó con Prado) las muestra.
const SPAM = /\b(casinos?|poker|betting|apuestas|scommesse|sportsbook|judi|togel|gacor|jackpot|viagra|cialis)\b/i;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 FeelVigilante/1.0';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function fail(step, detail) {
  return Object.assign(new Error(detail), { step });
}

async function checkLanding(browser, landing) {
  // Navegador con identidad normal: algunos servidores bloquean «HeadlessChrome».
  // Cabecera secreta para que el cortafuegos de las landings deje pasar al vigilante (secreto VIGILANTE_KEY).
  const extraHTTPHeaders = process.env.VIGILANTE_KEY ? { 'X-Vigilante': process.env.VIGILANTE_KEY } : {};
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1280, height: 900 }, userAgent: UA, extraHTTPHeaders });
  const checks = [];
  page.on('response', async (res) => {
    if (new URL(res.url()).pathname !== '/check' || res.request().method() !== 'POST') return;
    const body = await res.text().catch(() => '');
    if (body.trim().startsWith('<svg')) return; // /check sin parámetros devuelve un icono, no disponibilidad
    checks.push({ status: res.status(), body });
  });
  const started = Date.now();
  try {
    const res = await page.goto(landing.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
      .catch((e) => { throw fail('carga', e.message.split('\n')[0]); });
    if (!res) throw fail('carga', 'sin respuesta');
    if (res.status() === 403) {
      // Suele ser el cortafuegos del servidor bloqueando IPs de centros de datos, no a los clientes.
      const server = res.headers()['server'] || 'desconocido';
      throw fail('bloqueo', `HTTP 403: el servidor (${server}) bloquea al vigilante; comprobar si también a clientes`);
    }
    if (res.status() >= 400) throw fail('carga', `HTTP ${res.status()}`);
    const loadMs = Date.now() - started;

    // Integridad: que siga en su dominio y no muestre contenido ajeno (suplantación o hackeo).
    const host = (u) => new URL(u).hostname.replace(/^www\./, '');
    if (host(page.url()) !== host(landing.url)) throw fail('suplantación', `redirige a otro dominio: ${host(page.url())}`);
    const text = await page.evaluate(() => `${document.title}\n${document.body ? document.body.innerText.slice(0, 30000) : ''}`).catch(() => '');
    const spam = text.match(SPAM);
    if (spam) throw fail('suplantación', `la página contiene «${spam[0]}»: posible web hackeada`);

    await page.locator('#datepicker .ui-datepicker-calendar').waitFor({ state: 'visible', timeout: TIMEOUT })
      .catch(() => { throw fail('calendario', 'no aparece el calendario'); });

    // Disponibilidad: la landing consulta /check al cargar con la primera fecha libre.
    const deadline = Date.now() + TIMEOUT;
    while (!checks.length && Date.now() < deadline) await page.waitForTimeout(500);
    if (!checks.length) throw fail('disponibilidad', 'la landing no consulta la disponibilidad (/check)');
    const last = checks[checks.length - 1];
    if (last.status >= 400) throw fail('disponibilidad', `/check responde HTTP ${last.status}`);
    let slots;
    try { slots = JSON.parse(last.body).data.availabilities; } catch { throw fail('disponibilidad', `/check no devuelve datos: ${last.body.slice(0, 80)}`); }
    const selectableDays = await page.locator('#datepicker td[data-handler="selectDay"]').count();
    if (!selectableDays) throw fail('calendario', 'el calendario no tiene ningún día disponible');
    if (!Array.isArray(slots) || !slots.length) throw fail('disponibilidad', 'sin horarios para la primera fecha del calendario');

    const price = parseFloat(await page.locator('#precio_total_calculado').inputValue().catch(() => '0'));
    if (!(price > 0)) throw fail('precio', 'no calcula el precio');
    const action = await page.locator('#form_reserva').getAttribute('action').catch(() => null);
    if (!action) throw fail('pago', 'no está el formulario de reserva');

    const firstDate = await page.locator('#fecha').inputValue().catch(() => '');
    const detail = `${(loadMs / 1000).toFixed(1)} s · ${selectableDays} días · ${slots.length} horarios el ${firstDate} · ${price.toFixed(2)} €`;
    return { ok: true, slow: loadMs > SLOW_MS, detail, loadMs, days: selectableDays, slots: slots.length, firstDate, price };
  } catch (err) {
    return { ok: false, step: err.step || 'carga', detail: err.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

async function notify(text) {
  console.log(`AVISO: ${text}`);
  if (!process.env.SLACK_WEBHOOK_URL) return;
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  }).catch((e) => console.log(`No se pudo avisar a Slack: ${e.message}`));
}

async function checkWithRetry(browser, landing) {
  // Un reintento antes de darla por caída, para no avisar por un fallo puntual.
  // Si el servidor bloquea al vigilante, se espera un poco antes de reintentar.
  const first = await checkLanding(browser, landing);
  if (first.ok) return first;
  if (first.step === 'bloqueo') await new Promise((r) => setTimeout(r, 20000));
  return checkLanding(browser, landing);
}

function writeSite(checkedAt, results, history, incidents) {
  const landings = LANDINGS.map((landing, i) => {
    const r = results[i];
    return {
      name: landing.name,
      url: landing.url,
      ok: r.ok,
      slow: !!r.slow,
      step: r.step || null,
      detail: r.detail,
      loadMs: r.loadMs ?? null,
      days: r.days ?? null,
      slots: r.slots ?? null,
      firstDate: r.firstDate ?? null,
      price: r.price ?? null,
      downSince: r.ok ? null : (incidents.find((x) => x.url === landing.url && !x.end) || {}).start || checkedAt,
    };
  });
  // «down» son caídas reales; «blocked» son landings que bloquearon al vigilante y no se pudieron comprobar.
  const status = {
    checkedAt,
    // Desde dónde se ha hecho la pasada: «nexus» (normal) o «github» (respaldo).
    source: process.env.VIGILANTE_SOURCE || 'github',
    total: landings.length,
    down: landings.filter((l) => !l.ok && l.step !== 'bloqueo').length,
    blocked: landings.filter((l) => l.step === 'bloqueo').length,
    landings,
  };
  fs.mkdirSync(SITE, { recursive: true });
  fs.writeFileSync(path.join(SITE, 'status.json'), JSON.stringify(status, null, 2));
  fs.writeFileSync(path.join(SITE, 'incidents.json'), JSON.stringify(incidents, null, 2));
  fs.writeFileSync(path.join(SITE, 'history.json'), JSON.stringify(history));
  fs.copyFileSync(path.join(__dirname, 'dashboard.html'), path.join(SITE, 'index.html'));
}

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const state = readJson(STATE, {});
  const incidents = readJson(INCIDENTS, []);
  // Histórico compacto: por pasada, la hora y por landing [ok (1/0), segundos de carga].
  const history = readJson(HISTORY, { urls: [], runs: [] });
  const browser = await chromium.launch();
  const now = new Date().toISOString();

  // Varias landings a la vez para que cada pasada dure menos de un minuto.
  const results = new Array(LANDINGS.length);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < LANDINGS.length) {
      const i = next++;
      results[i] = await checkWithRetry(browser, LANDINGS[i]);
    }
  }));
  await browser.close();

  const down = [];
  let newIncidents = 0;
  for (const [i, landing] of LANDINGS.entries()) {
    const result = results[i];
    const prev = state[landing.url] || { ok: true };
    console.log(`${result.ok ? (result.slow ? 'LENTA' : 'OK   ') : 'KO   '} ${landing.name}: ${result.step ? result.step + ' · ' : ''}${result.detail}`);

    if (!result.ok && prev.ok) {
      if (result.step !== 'bloqueo') newIncidents++;
      incidents.push({ name: landing.name, url: landing.url, start: now, end: null, minutes: null, step: result.step, detail: result.detail });
      // Un bloqueo del cortafuegos al vigilante solo se ve en el dashboard: no es una caída para los clientes.
      if (result.step !== 'bloqueo') await notify(`:red_circle: *${landing.name}* caída (${result.step}): ${result.detail}\n${landing.url}\nRevisar y pausar sus campañas hasta que vuelva.`);
      state[landing.url] = { ok: false, since: now, step: result.step };
    } else if (result.ok && !prev.ok) {
      const mins = Math.round((Date.parse(now) - Date.parse(prev.since)) / 60000);
      const open = incidents.find((x) => x.url === landing.url && !x.end);
      if (open) Object.assign(open, { end: now, minutes: mins });
      if (prev.step !== 'bloqueo') await notify(`:large_green_circle: *${landing.name}* recuperada tras ${mins} min (fallaba en: ${prev.step}).\n${landing.url}`);
      state[landing.url] = { ok: true };
    } else if (result.ok) {
      state[landing.url] = { ok: true };
    }
    if (!result.ok) down.push(result.step === 'bloqueo' ? `${landing.name} (bloqueo)` : landing.name);
  }

  history.urls = LANDINGS.map((l) => l.url);
  // 1 = bien, 0 = caída, 2 = bloqueada al vigilante (sin dato).
  history.runs.push([now, results.map((r) => [r.ok ? 1 : (r.step === 'bloqueo' ? 2 : 0), r.loadMs ? Math.round(r.loadMs / 100) / 10 : null])]);
  const cutoff = Date.parse(now) - HISTORY_DAYS * 86400000;
  history.runs = history.runs.filter(([t]) => Date.parse(t) >= cutoff);

  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  fs.writeFileSync(INCIDENTS, JSON.stringify(incidents, null, 2));
  fs.writeFileSync(HISTORY, JSON.stringify(history));
  writeSite(now, results, history, incidents);
  console.log(`\n${LANDINGS.length - down.length}/${LANDINGS.length} landings bien${down.length ? ` · con fallo: ${down.join(', ')}` : ''}`);
  // Solo una caída nueva pone la ejecución en rojo, y GitHub manda un email: sin repetirlo cada 5 minutos.
  process.exitCode = newIncidents ? 1 : 0;
})();
